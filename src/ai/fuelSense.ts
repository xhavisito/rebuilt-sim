/**
 * Lo que "ve" un piloto del FUEL alrededor de su robot.
 */
import type { Robot } from '../game/Robot';
import { FLAG_FROM_HUB, FuelState, type FuelSystem } from '../physics/FuelSystem';

/**
 * ¿Hay FUEL recién salido del HUB (que no ha tocado nada más) cerca del robot? Con la intake
 * prendida lo agarraría: G408 prohíbe tomar CONTROL de ese FUEL hasta que toque otra cosa. Se
 * cuenta el que rueda hacia el robot desde más lejos (rueda a 2–3.4 m/s).
 */
export function hubFuelNear(fuel: FuelSystem, r: Robot, reach = 1.1): boolean {
  const p = r.phys.curPos;
  const lim = reach + r.phys.outerL;
  for (let i = 0; i < fuel.count; i++) {
    if (!(fuel.flags[i] & FLAG_FROM_HUB) || fuel.state[i] !== FuelState.Field) continue;
    const o = i * 3;
    const dx = fuel.pos[o] - p.x;
    const dz = fuel.pos[o + 2] - p.z;
    const d = Math.hypot(dx, dz);
    if (d < lim) return true;
    // rodando hacia el robot: lo alcanza en menos de ~0.6 s
    if (d < lim + 2.2) {
      const v = fuel.bodies[i].linvel();
      if (-(dx * v.x + dz * v.z) / d > (d - lim) / 0.6) return true;
    }
  }
  return false;
}
