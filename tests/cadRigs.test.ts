import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CAD_ROBOTS } from '../src/config/robots';
import { CAD_RIGS, compose, hopperSlots, openingFor, pose, rot, shownFuel, slotFits, type MechState } from '../src/render/cadRigs';

const meta = JSON.parse(readFileSync('scripts/robots/models-meta.json', 'utf8')) as Record<string, { parts: Record<string, unknown> }>;
const states: MechState[] = [0, 0.25, 0.5, 0.75, 1].map((k) => ({ intake: k, hood: k, turret: (k - 0.5) * 4, climb: k, spin: k * 10 }));

describe('cadRigs', () => {
  it('Rotation3d(roll, pitch, yaw) como WPILib: extrínseca X, Y, Z', () => {
    // pitch +90° lleva +X hacia −Z
    const p = compose(pose([0, 0, 0], rot(0, Math.PI / 2, 0)), pose([1, 0, 0]));
    expect(p.t[0]).toBeCloseTo(0);
    expect(p.t[2]).toBeCloseTo(-1);
    // yaw +90° lleva +X hacia +Y
    const y = compose(pose([0, 0, 0], rot(0, 0, Math.PI / 2)), pose([1, 0, 0]));
    expect(y.t[1]).toBeCloseTo(1);
    // roll luego pitch (extrínsecas): +Y → (roll 90°) +Z → (pitch 90°) +X
    const r = compose(pose([0, 0, 0], rot(Math.PI / 2, Math.PI / 2, 0)), pose([0, 1, 0]));
    expect(r.t[0]).toBeCloseTo(1);
  });

  it('cada robot con CAD tiene rig y una pose finita por componente del GLB', () => {
    for (const spec of CAD_ROBOTS) {
      const file = spec.cad!.file;
      const rig = CAD_RIGS[file];
      expect(rig, file).toBeDefined();
      const comps = Object.keys(meta[file.replace('.glb', '')].parts).filter((k) => k !== 'main').length;
      for (const s of states) {
        const poses = rig.poses(s);
        expect(poses.length, file).toBe(comps);
        for (const p of poses) {
          if (!p) continue;
          for (const v of [...p.t, ...p.q]) expect(Number.isFinite(v), file).toBe(true);
          expect(Math.hypot(...p.q)).toBeCloseTo(1, 5);
        }
      }
    }
  });

  it('la intake se mueve entre guardada y desplegada', () => {
    for (const spec of CAD_ROBOTS) {
      const rig = CAD_RIGS[spec.cad!.file];
      const a = rig.poses({ ...states[0], intake: 0 });
      const b = rig.poses({ ...states[0], intake: 1 });
      const moved = a.some((p, i) => p && b[i] && (Math.hypot(p.t[0] - b[i]!.t[0], p.t[1] - b[i]!.t[1], p.t[2] - b[i]!.t[2]) > 0.01 || Math.abs(p.q[0] * b[i]!.q[0] + p.q[1] * b[i]!.q[1] + p.q[2] * b[i]!.q[2] + p.q[3] * b[i]!.q[3]) < 0.999));
      expect(moved, spec.id).toBe(true);
    }
  });
});

describe('hopper visible', () => {
  it('cada robot con CAD dibuja su FUEL guardado', () => {
    for (const spec of CAD_ROBOTS) {
      const rig = CAD_RIGS[spec.cad!.file];
      expect(rig.hopper?.length, spec.id).toBeGreaterThan(0);
      const slots = hopperSlots(rig.hopper!, Math.min(80, spec.hopperCapacity));
      expect(slots.length, spec.id).toBeGreaterThanOrEqual(7);
      // lleno = todos los lugares; con FUEL, la intake se abre lo necesario para que quepan
      expect(shownFuel(spec.hopperCapacity, slots.length, spec.hopperCapacity)).toBe(Math.min(slots.length, spec.hopperCapacity));
      const e = openingFor(rig.hopper!, slots, slots.length);
      expect(slots.filter((sl) => slotFits(rig.hopper![sl.box], sl, e)).length, spec.id).toBe(slots.length);
    }
  });

  it('el FUEL dibujado crece con el llenado y nunca es cero con FUEL', () => {
    expect(shownFuel(0, 20, 40)).toBe(0);
    expect(shownFuel(1, 20, 40)).toBe(1);
    expect(shownFuel(20, 20, 40)).toBe(10);
    expect(shownFuel(40, 20, 40)).toBe(20);
    expect(shownFuel(8, 30, 10)).toBe(8);
    let last = 0;
    for (let n = 0; n <= 70; n++) {
      const k = shownFuel(n, 28, 70);
      expect(k).toBeGreaterThanOrEqual(last);
      last = k;
    }
  });
});

describe('3478: la intake nunca atraviesa el frente del hopper', () => {
  it('el frente del hopper va por delante de la intake en todo el giro', async () => {
    const { hopperExt3478 } = await import('../src/render/cadRigs');
    // x máximo de la intake (a la altura de la pared) medido en la malla, por ángulo
    const swing: Array<[number, number]> = [[0, 0.335], [40, 0.487], [80, 0.588], [120, 0.665], [140, 0.677]];
    for (const [deg, x] of swing) expect(0.314 + hopperExt3478(deg), `${deg}°`).toBeGreaterThan(x);
    expect(hopperExt3478(0)).toBeCloseTo(0.031, 2);
  });
});
