import { describe, expect, it } from 'vitest';
import { newFuelSnap, qPos, ROBOT_MECH, type FuelSnap, type RobotSnap } from '../src/net/protocol';
import { clipReplay, deserializeReplay, FrameReader, highlights, KEY_EVERY, REPLAY_HZ, ReplayRecorder, serializeReplay, type ReplayData } from '../src/replay/Recording';
import type { SessionConfig } from '../src/game/GameSession';

const N = 20;
const cfg = { mode: 'match', robots: [], fuelTotal: N, eventType: 'regional', fouls: true, seed: 1 } as unknown as SessionConfig;
const robot = (x: number): RobotSnap => ({ p: [x, 0.1, -2], q: [0, 0, 0, 1], v: [1, 0], mech: ROBOT_MECH.map(() => 0), flags: 1 });

/** FUEL i en x = i·0.1 + t (se mueve todo cada cuadro); el 3 entra a un robot a los 4 s. */
function fuelAt(t: number, out: FuelSnap): FuelSnap {
  for (let i = 0; i < N; i++) {
    out.state[i] = i === 3 && t >= 4 ? 1 : 0;
    out.owner[i] = i === 3 && t >= 4 ? 2 : 0;
    out.pos[i * 3] = out.state[i] ? 0 : qPos(i * 0.1 + (i % 2 ? t : 0));
    out.pos[i * 3 + 1] = 0;
    out.pos[i * 3 + 2] = 0;
  }
  return out;
}

function record(seconds: number): ReplayData {
  const rec = new ReplayRecorder(cfg, N);
  const fuel = newFuelSnap(N);
  for (let k = 0; k <= seconds * REPLAY_HZ; k++) {
    const t = 10 + k / REPLAY_HZ;
    if (!rec.due(t)) continue;
    rec.frame(t, t - 10, [robot(t)], fuelAt(t, fuel));
    if (k % 7 === 0) rec.slowState(t, { m: null, r: [], door: { red: false, blue: false }, chute: { red: [], blue: [] }, corral: { red: [], blue: [] }, pins: [{ victim: 0, pinner: 1, seconds: Math.floor(t) }] });
    if (k % 3 === 0) rec.event(t, { k: 'score', hub: k % 2 ? 'red' : 'blue', counted: true, x: 0, y: 0, z: 0 });
  }
  return rec.finish({ date: 0, mode: 'match', eventType: 'regional', score: { red: 1, blue: 2 }, teams: { red: [1], blue: [2] } });
}

describe('repeticiones', () => {
  it('graba a 30 Hz con cuadros clave cada 2 s', () => {
    const d = record(10);
    expect(d.frames.length).toBe(10 * REPLAY_HZ + 1);
    expect(d.keys[0]).toBe(0);
    expect(d.keys.length).toBe(Math.floor(10 / KEY_EVERY) + 1);
    expect(d.meta.duration).toBeCloseTo(10, 1);
    // el estado lento solo se guarda cuando cambia
    expect(d.slow.length).toBeLessThanOrEqual(11);
  });

  it('lee cualquier cuadro, hacia adelante, hacia atrás y saltando', () => {
    const d = record(10);
    const rd = new FrameReader(d);
    const check = (i: number) => {
      const s = rd.get(i);
      const t = 10 + i / REPLAY_HZ;
      expect(s.t).toBeCloseTo(t, 3);
      expect(s.robots[0].p[0]).toBeCloseTo(t, 3);
      const ref = fuelAt(t, newFuelSnap(N));
      expect([...s.fuel.state]).toEqual([...ref.state]);
      expect([...s.fuel.pos]).toEqual([...ref.pos]);
    };
    for (const i of [0, 1, 2, 150, 149, 299, 30, 31, 300, 7]) check(i);
    expect(rd.indexAt(15.0)).toBe(150);
    expect(rd.indexAt(0)).toBe(0);
    expect(rd.indexAt(99)).toBe(300);
  });

  it('archivo: ida y vuelta (con y sin gzip)', async () => {
    const d = record(5);
    for (const gz of [false, true]) {
      const bytes = await serializeReplay(d, gz);
      const back = await deserializeReplay(bytes);
      expect(back.frames.length).toBe(d.frames.length);
      expect([...back.frames[40]]).toEqual([...d.frames[40]]);
      expect(back.meta).toEqual(d.meta);
      expect(back.events.length).toBe(d.events.length);
      expect(new FrameReader(back).get(100).robots[0].p[0]).toBeCloseTo(10 + 100 / REPLAY_HZ, 3);
    }
    // gzip comprime (mucha redundancia entre cuadros)
    expect((await serializeReplay(d, true)).length).toBeLessThan((await serializeReplay(d, false)).length);
  });

  it('un archivo que no es repetición se rechaza', async () => {
    await expect(deserializeReplay(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))).rejects.toThrow();
  });

  it('clip: segmento con su propio cuadro clave, estado lento y eventos', () => {
    const d = record(10);
    const c = clipReplay(d, 13.1, 16);
    const rd = new FrameReader(c);
    expect(rd.start).toBeCloseTo(13.1, 1);
    expect(rd.end).toBeCloseTo(16, 1);
    expect(c.keys[0]).toBe(0);
    // el FUEL del primer cuadro (no clave en el original) está completo
    const s = rd.get(0);
    expect([...s.fuel.pos]).toEqual([...fuelAt(s.t, newFuelSnap(N)).pos]);
    // y el estado sigue bien más adelante (el FUEL 3 entra al robot a los 4 s de match = 14 s)
    expect(rd.get(rd.indexAt(15)).fuel.state[3]).toBe(1);
    expect(c.slow[0].t).toBeCloseTo(rd.start, 3);
    expect(c.events.every((e) => e.t > rd.start - 1e-6 && e.t <= rd.end + 1e-6)).toBe(true);
    expect(c.meta.clip).toEqual({ from: 3.1, to: 6 });
  });

  it('momentos destacados: rachas de FUEL sin encimarse', () => {
    const d = record(30);
    const h = highlights(d, 5);
    expect(h.length).toBeGreaterThan(0);
    expect(h.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < h.length; i++) expect(h[i].t - h[i - 1].t).toBeGreaterThanOrEqual(3.99);
    expect(h.every((x) => x.kind === 'score')).toBe(true);
  });
});
