import { describe, expect, it } from 'vitest';
import { assignAutos, BUILTIN_ROUTINES, routineZones, toAlliance } from '../src/auto/AutoRoutine';
import * as F from '../src/config/field';
import { checkStart, defaultStart, separateStarts } from '../src/core/startRules';

describe('AUTO de alianza sin choques', () => {
  const zonesOf = (ids: string[]) => ids.map((id) => routineZones(BUILTIN_ROUTINES.find((r) => r.id === id)!));
  const noShared = (ids: string[]) => {
    const z = zonesOf(ids).flat();
    expect(new Set(z).size, ids.join(',')).toBe(z.length);
  };

  it('tres robots de la computadora no comparten zona', () => {
    for (const canClimb of [true, false]) {
      const ids = assignAutos([1, 2, 3].map((s) => ({ station: s as 1 | 2 | 3, canClimb })), BUILTIN_ROUTINES);
      noShared(ids);
      expect(ids.filter((i) => i === 'climb-l1').length).toBe(canClimb ? 1 : 0);
    }
  });

  it('respeta la rutina del jugador y las demás la evitan', () => {
    const ids = assignAutos([{ station: 1, canClimb: true }, { station: 2, canClimb: true, fixed: 'default-score' }, { station: 3, canClimb: true }], BUILTIN_ROUTINES);
    expect(ids[1]).toBe('default-score');
    noShared(ids);
    expect(ids).not.toContain('neutral-top');
    expect(ids).not.toContain('neutral-bottom');
  });

  it('las rutinas de mitad de NEUTRAL ZONE no pasan la CENTER LINE (G403)', () => {
    for (const id of ['neutral-top', 'neutral-bottom']) {
      const r = BUILTIN_ROUTINES.find((x) => x.id === id)!;
      for (const w of r.waypoints) expect(w.x + 0.5).toBeLessThan(F.CENTER_LINE_X);
      // y la roja es el giro de 180°
      const p = toAlliance('red', r.waypoints[1].x, r.waypoints[1].z, null);
      expect(p.x).toBeGreaterThan(0);
    }
  });
});

describe('posiciones de salida sin encimarse', () => {
  const h = 0.45;
  it('separa robots encimados y los deja legales (G303)', () => {
    const z = separateStarts([{ z: -1.0, halfZ: h }, { z: -0.9, halfZ: h }, { z: 2.0, halfZ: h }]);
    expect(z[1] - z[0]).toBeGreaterThanOrEqual(2 * h);
    for (const zz of z) {
      const st = defaultStart('blue', 1, h);
      expect(checkStart({ alliance: 'blue', x: st.x, z: zz, halfX: h, halfZ: h, heightM: 0.5, perimeterM: 2.5, preload: 8 })).toEqual([]);
    }
  });
  it('los mete al campo; en la ROBOT STARTING LINE no tocan el BUMP (G303 E)', () => {
    const z = separateStarts([{ z: F.BUMP_CENTER_Z, halfZ: h }, { z: -F.HALF_W, halfZ: h }]);
    expect(z[0]).toBe(F.BUMP_CENTER_Z);
    expect(z[1]).toBeGreaterThanOrEqual(-F.HALF_W + h);
    const st = defaultStart('blue', 3, h);
    expect(checkStart({ alliance: 'blue', x: st.x, z: z[0], halfX: h, halfZ: h, heightM: 0.5, perimeterM: 2.5, preload: 8 })).toEqual([]);
  });
  it('no mueve las posiciones de fábrica', () => {
    const def = [1, 2, 3].map((s) => defaultStart('blue', s as 1 | 2 | 3, h).z);
    expect(separateStarts(def.map((z) => ({ z, halfZ: h })))).toEqual(def);
  });
});

describe('AUTO según el orden real de salida', () => {
  it('si DS1 sale abajo, le toca la mitad de abajo', () => {
    const ids = assignAutos(
      [
        { station: 1, canClimb: false, z: 2.5 },
        { station: 2, canClimb: false, z: -1.24 },
        { station: 3, canClimb: false, z: 1.0 },
      ],
      BUILTIN_ROUTINES,
    );
    expect(ids[0]).toBe('neutral-bottom');
    expect(ids[1]).toBe('neutral-top');
  });
});
