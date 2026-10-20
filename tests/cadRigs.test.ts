import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CAD_ROBOTS } from '../src/config/robots';
import { CAD_RIGS, compose, pose, rot, type MechState } from '../src/render/cadRigs';

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
