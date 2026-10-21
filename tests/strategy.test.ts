import { describe, expect, it } from 'vitest';
import { BUILTIN_STRATEGIES, inLane, inNeutral, plan, planFor, routeDistance, strategyById } from '../src/ai/Strategy';
import * as F from '../src/config/field';

describe('estrategias 3 vs 3', () => {
  it('el plan del lado azul se refleja (giro de 180°) para la alianza roja', () => {
    const s = { id: 'x', name: 'x', plans: [plan({ route: [{ x: -5, z: 2 }], shootSpot: { x: -6, z: -1 } }), plan(), plan()] as [ReturnType<typeof plan>, ReturnType<typeof plan>, ReturnType<typeof plan>] };
    expect(planFor(s, 'blue', 1).route[0]).toEqual({ x: -5, z: 2 });
    expect(planFor(s, 'red', 1).route[0]).toEqual({ x: 5, z: -2 });
    expect(planFor(s, 'red', 1).shootSpot).toEqual({ x: 6, z: 1 });
    // no modifica la estrategia original
    expect(s.plans[0].route[0]).toEqual({ x: -5, z: 2 });
  });

  it('los carriles se definen del lado azul y se reflejan para el rojo', () => {
    expect(inLane('top', -3, 'blue')).toBe(true);
    expect(inLane('top', 3, 'blue')).toBe(false);
    expect(inLane('top', 3, 'red')).toBe(true);
    expect(inLane('mid', 0.5, 'red')).toBe(true);
    expect(inLane('bottom', 0, 'blue')).toBe(false);
    expect(inLane('any', 99, 'blue')).toBe(true);
  });

  it('distancia a la línea de recolección (polilínea)', () => {
    const r = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }];
    expect(routeDistance(r, 1, 1)).toBeCloseTo(1);
    expect(routeDistance(r, 3, 1)).toBeCloseTo(1);
    expect(routeDistance(r, -1, 0)).toBeCloseTo(1);
    expect(routeDistance([], 0, 0)).toBe(Infinity);
  });

  it('las estrategias de fábrica tienen 3 planes válidos y el alimentador dibuja en la NEUTRAL ZONE', () => {
    for (const s of BUILTIN_STRATEGIES) {
      expect(s.plans).toHaveLength(3);
      for (const p of s.plans) for (const q of p.route) expect(Math.abs(q.x)).toBeLessThan(F.HALF_L);
    }
    const feeder = strategyById('feeder').plans.find((p) => p.role === 'feeder')!;
    expect(feeder.route.every((q) => inNeutral(q.x))).toBe(true);
    expect(strategyById('no-existe').id).toBe('auto');
  });
});
