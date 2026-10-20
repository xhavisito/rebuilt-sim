import { describe, expect, it } from 'vitest';
import { FUEL_DIAMETER, inch } from '../src/config/field';
import { Rng } from '../src/core/rng';
import { burstPositions } from '../src/game/Mechanisms';

describe('ráfagas de dumper', () => {
  it('reparte de 1 a `lanes` FUEL a lo ancho sin encimarlos', () => {
    const rng = new Rng(7);
    const seen = new Set<string>();
    for (let t = 0; t < 400; t++) {
      const lanes = 4;
      const n = rng.int(1, lanes);
      const xs = burstPositions(lanes, n, 0, rng);
      expect(xs.length).toBe(n);
      const half = ((lanes - 1) * FUEL_DIAMETER * 1.02 * 1.03) / 2;
      for (const x of xs) expect(Math.abs(x)).toBeLessThanOrEqual(half + 1e-9);
      for (let a = 0; a < xs.length; a++) for (let b = a + 1; b < xs.length; b++) expect(Math.abs(xs[a] - xs[b])).toBeGreaterThanOrEqual(FUEL_DIAMETER);
      seen.add(xs.map((x) => x.toFixed(2)).join(','));
    }
    // no salen siempre en las mismas posiciones (filas)
    expect(seen.size).toBeGreaterThan(100);
  });

  it('turret doble: una por turret', () => {
    const rng = new Rng(3);
    const sp = inch(16.5);
    const xs = burstPositions(2, 2, sp, rng).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-sp / 2);
    expect(xs[1]).toBeCloseTo(sp / 2);
    expect(Math.abs(burstPositions(2, 1, sp, rng)[0])).toBeCloseTo(sp / 2);
  });

  it('un solo chorro sale del centro', () => {
    expect(burstPositions(1, 1, 0, new Rng(1))).toEqual([0]);
  });
});
