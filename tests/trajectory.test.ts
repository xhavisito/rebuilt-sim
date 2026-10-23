import { describe, expect, it } from 'vitest';
import { mirrorWaypointZ, sanitizeRoutine, type AutoWaypoint } from '../src/auto/AutoRoutine';
import { bezierSegments, buildTrajectory, constraintsFor, isStop, pathIssues, sampleAt } from '../src/auto/Trajectory';
import * as F from '../src/config/field';

const spec = { maxSpeed: 4.8, maxAccel: 12, traction: 1.1, maxOmega: 8, drivetrain: 'swerve' };
const C = constraintsFor(spec, 0.85);
const start = { x: F.STARTING_LINE_X_BLUE - 0.45, z: 1.5, heading: 0 };
const wp = (x: number, z: number, extra: Partial<AutoWaypoint> = {}): AutoWaypoint => ({ x, z, heading: null, ...extra });

describe('Trajectory', () => {
  it('pasa exactamente por los waypoints y empieza/termina quieto', () => {
    const wps = [wp(-4, 2.5), wp(-2, 1), wp(-3, -1)];
    const tr = buildTrajectory(start, wps, C);
    const S = tr.samples;
    expect(S[0].v).toBe(0);
    expect(S[S.length - 1].v).toBe(0);
    for (const w of wps) expect(Math.min(...S.map((q) => Math.hypot(q.x - w.x, q.z - w.z)))).toBeLessThan(1e-6);
    expect(S[S.length - 1].x).toBeCloseTo(-3);
    expect(tr.duration).toBeGreaterThan(tr.length / C.maxVel);
  });

  it('respeta velocidad, aceleración y curvas', () => {
    const tr = buildTrajectory(start, [wp(-3, 3), wp(-1.5, -2), wp(-4, -2.5)], C);
    const S = tr.samples;
    for (let i = 1; i < S.length; i++) {
      expect(S[i].v).toBeLessThanOrEqual(C.maxVel + 1e-9);
      const ds = S[i].s - S[i - 1].s;
      if (ds > 0) expect(Math.abs(S[i].v ** 2 - S[i - 1].v ** 2)).toBeLessThanOrEqual(2 * C.maxAccel * ds + 1e-6);
    }
  });

  it('se detiene en los waypoints con acción y no en los de paso', () => {
    const wps = [wp(-4, 2.5, { intake: true }), wp(-3, 0, { shoot: true }), wp(-5, -1)];
    expect(isStop(wps[0], false)).toBe(false);
    expect(isStop(wps[1], false)).toBe(true);
    const tr = buildTrajectory(start, wps, C, { dwell: (w) => (w.shoot ? 2 : 0) });
    const at = (w: AutoWaypoint) => tr.samples.find((q) => Math.hypot(q.x - w.x, q.z - w.z) < 1e-6)!;
    expect(at(wps[0]).v).toBeGreaterThan(0.5);
    expect(at(wps[1]).v).toBe(0);
    expect(tr.stops.map((s) => s.wp)).toEqual([1, 2]);
    // la espera de 2 s queda en la línea de tiempo: el robot sigue en el punto
    const st = tr.stops[0];
    const mid = sampleAt(tr, st.t + 1);
    expect(Math.hypot(mid.x - wps[1].x, mid.z - wps[1].z)).toBeLessThan(1e-6);
  });

  it('llega con el rumbo pedido', () => {
    const tr = buildTrajectory(start, [wp(-4, 0, { heading: Math.PI / 2 })], C);
    const end = tr.samples[tr.samples.length - 1];
    expect(Math.cos(end.heading - Math.PI / 2)).toBeCloseTo(1, 5);
  });

  it('las manijas del usuario cambian la curva', () => {
    const a = bezierSegments(start, [wp(-4, 0)]);
    const b = bezierSegments(start, [wp(-4, 0, { hin: { x: 0, z: 1.5 } })]);
    expect(b[0][2]).toEqual({ x: -4, z: 1.5 });
    expect(a[0][2]).not.toEqual(b[0][2]);
  });

  it('frena sobre el BUMP', () => {
    const bx = F.HUB_CENTER_X_BLUE;
    const tr = buildTrajectory({ x: bx - 2.5, z: F.BUMP_CENTER_Z, heading: 0 }, [wp(bx + 2.5, F.BUMP_CENTER_Z)], C);
    const on = tr.samples.filter((q) => Math.abs(q.x - bx) < 0.2);
    expect(Math.max(...on.map((q) => q.v))).toBeLessThanOrEqual(2.4 + 1e-9);
  });

  it('detecta choques con el HUB, las paredes y la CENTER LINE', () => {
    const hub = { x: F.HUB_CENTER_X_BLUE, z: 0 };
    expect(pathIssues([hub], 0.4, true)[0]).toBe('hub');
    expect(pathIssues([{ x: -4, z: F.HALF_W - 0.1 }], 0.4, true)[0]).toBe('wall');
    expect(pathIssues([{ x: 1, z: 0 }], 0.4, true)[0]).toBe('center');
    expect(pathIssues([{ x: -6, z: 0 }], 0.4, true)[0]).toBeNull();
    // carril del TRENCH: solo si el robot no cabe
    const lane = { x: F.HUB_CENTER_X_BLUE, z: F.HALF_W - F.TRENCH_CLEAR_WIDTH / 2 };
    expect(pathIssues([lane], 0.4, true)[0]).toBeNull();
    expect(pathIssues([lane], 0.4, false)[0]).toBe('trench');
  });
});

describe('Rutinas importadas', () => {
  it('valida y limpia el JSON', () => {
    expect(sanitizeRoutine({ name: 'x' })).toBeNull();
    expect(sanitizeRoutine({ waypoints: [{ x: 'a', z: 0 }] })).toBeNull();
    const r = sanitizeRoutine({ name: 'Mi ruta', builtin: true, waypoints: [{ x: -99, z: 1, heading: 1, shoot: true, evil: 1, hout: { x: 0.5, z: 0 } }] })!;
    expect(r.builtin).toBeUndefined();
    expect(r.spline).toBe(true);
    expect(r.waypoints[0].x).toBe(-F.HALF_L);
    expect(r.waypoints[0]).not.toHaveProperty('evil');
    expect(r.waypoints[0].hout).toEqual({ x: 0.5, z: 0 });
  });

  it('refleja waypoints y manijas en z', () => {
    const m = mirrorWaypointZ(wp(-3, 1, { heading: 0.5, hin: { x: 1, z: 2 } }));
    expect(m.z).toBe(-1);
    expect(m.heading).toBe(-0.5);
    expect(m.hin).toEqual({ x: 1, z: -2 });
  });
});

describe('Ruta suave de ejemplo', () => {
  it('no choca con el campo desde ninguna DRIVER STATION', async () => {
    const { BUILTIN_ROUTINES } = await import('../src/auto/AutoRoutine');
    const { defaultStart } = await import('../src/core/startRules');
    const r = BUILTIN_ROUTINES.find((x) => x.id === 'spline-sweep')!;
    for (const ds of [1, 2, 3] as const) {
      const st = defaultStart('blue', ds, 0.45);
      // como el ejecutor: se refleja si sale del otro lado
      const flip = Math.sign(r.waypoints[0].z) !== Math.sign(st.z) && Math.abs(st.z) > 0.3;
      const wps = flip ? r.waypoints.map(mirrorWaypointZ) : r.waypoints;
      const tr = buildTrajectory(st, wps, C, { dwell: (w) => (w.shoot ? 2 : 0) });
      const bad = pathIssues(tr.samples, 0.4, false, 0.45).filter(Boolean);
      expect(bad, `DS${ds}`).toEqual([]);
      expect(tr.duration + 2).toBeLessThan(20);
    }
  });
});
