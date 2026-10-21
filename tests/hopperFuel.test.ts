import { describe, expect, it } from 'vitest';
import { CAD_RIGS, FUEL_D, hopperSlots, type HopperBox } from '../src/render/cadRigs';
import { HopperFuelSim } from '../src/render/hopperFuel';

const inside = (b: HopperBox, p: number[], e = 0) => {
  const hi = b.maxDeployed ? b.max.map((v, k) => v + (b.maxDeployed![k] - v) * e) : b.max;
  if (b.ring) return p[2] >= b.min[2] - 1e-6 && p[2] <= Math.max(b.min[2] + FUEL_D / 2, b.max[2]) + 1e-6;
  return [0, 1, 2].every((k) => p[k] >= b.min[k] - 1e-6 && p[k] <= Math.max(b.min[k] + FUEL_D / 2, hi[k]) + 1e-6);
};
const run = (sim: HopperFuelSim, s: number, ax = 0, ay = 0) => {
  for (let t = 0; t < s; t += 1 / 60) sim.step(1 / 60, ax, ay);
};

describe('FUEL en el hopper (física visual)', () => {
  for (const file of ['6328.glb', '3478.glb', '5000.glb']) {
    const boxes = CAD_RIGS[file].hopper!;
    const slots = hopperSlots(boxes, 60);
    it(`${file}: los que entran caen y se quedan dentro de sus cajas`, () => {
      const sim = new HopperFuelSim(boxes, slots, () => 0.5);
      for (let n = 1; n <= Math.min(20, slots.length); n++) {
        sim.sync(n, 1);
        run(sim, 0.15);
      }
      run(sim, 3);
      expect(sim.balls.length).toBe(Math.min(20, slots.length));
      for (const b of sim.balls) expect(inside(boxes[b.box], b.p, 1), file).toBe(true);
      // ya quieto: se duerme
      run(sim, 3);
      expect(sim.sleeping).toBe(true);
    });
  }

  it('acelerar hacia adelante recorre el FUEL hacia atrás (inercia)', () => {
    const boxes: HopperBox[] = [{ min: [-0.3, -0.3, 0.1], max: [0.3, 0.3, 0.6] }];
    const sim = new HopperFuelSim(boxes, hopperSlots(boxes, 10), () => 0.5);
    sim.sync(6, 0, true);
    run(sim, 1.5);
    const x0 = sim.balls.reduce((a, b) => a + b.p[0], 0) / sim.balls.length;
    run(sim, 0.6, 8, 0);
    const x1 = sim.balls.reduce((a, b) => a + b.p[0], 0) / sim.balls.length;
    expect(x1).toBeLessThan(x0 - 0.02);
  });

  it('al tirar sale el de más abajo', () => {
    const boxes: HopperBox[] = [{ min: [-0.3, -0.3, 0.1], max: [0.3, 0.3, 0.8] }];
    const sim = new HopperFuelSim(boxes, hopperSlots(boxes, 30), () => 0.5);
    sim.sync(12, 0, true);
    run(sim, 1);
    const low = Math.min(...sim.balls.map((b) => b.p[2]));
    sim.sync(11, 0);
    expect(sim.balls.length).toBe(11);
    expect(Math.min(...sim.balls.map((b) => b.p[2]))).toBeGreaterThanOrEqual(low);
  });
});
