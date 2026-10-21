import { describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { passTarget } from '../src/game/Mechanisms';

describe('pase al ALLIANCE ZONE', () => {
  for (const a of ['red', 'blue'] as const) {
    it(`${a}: cae dentro de su ALLIANCE ZONE y a un lado del HUB, aunque el robot esté centrado`, () => {
      for (const z of [0, 0.01, -0.01, 0.5, -1.2, 2.5, -3.9]) {
        const t = passTarget(a, z);
        // ALLIANCE ZONE: entre la pared propia y la STARTING LINE
        expect(Math.abs(t.x)).toBeGreaterThan(Math.abs(F.STARTING_LINE_X_BLUE));
        expect(Math.sign(t.x)).toBe(F.allianceSign(a));
        // fuera del HUB (en z = 0) con margen, y dentro del campo
        expect(Math.abs(t.z)).toBeGreaterThan(F.HUB_SIZE / 2 + 0.5);
        expect(Math.abs(t.z)).toBeLessThan(F.HALF_W - 0.5);
        // del mismo lado en que va el robot
        if (Math.abs(z) > 0.005) expect(Math.sign(t.z)).toBe(Math.sign(z));
      }
    });
  }
});
