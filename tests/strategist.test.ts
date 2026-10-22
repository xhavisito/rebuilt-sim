import { describe, expect, it } from 'vitest';
import { planMatch, prosCons, type ScoutRobot } from '../src/ai/Strategist';
import { BUILTIN_ROUTINES, routineZones } from '../src/auto/AutoRoutine';
import { CAD_ROBOTS, type RobotSpec } from '../src/config/robots';

const spec = (id: string): RobotSpec => structuredClone(CAD_ROBOTS.find((r) => r.id === id)!);
const sr = (id: string, team: number, extra: Partial<ScoutRobot> = {}): ScoutRobot => ({ team, name: id, spec: spec(id), ...extra });

describe('estratega del match', () => {
  const ours = [sr('cad-3478', 3478, { isPlayer: true }), sr('cad-604', 604), sr('cad-4915', 4915)];
  const theirs = [sr('cad-1678', 1678), sr('cad-971', 971), sr('cad-6328', 6328)];

  it('da órdenes a los 3 robots, con AUTOs que no comparten zona', () => {
    const plan = planMatch(ours, theirs, 'regional');
    expect(plan.orders.length).toBe(3);
    const z = plan.orders.flatMap((o) => routineZones(BUILTIN_ROUTINES.find((r) => r.id === o.auto)!));
    expect(new Set(z).size).toBe(z.length);
    expect(plan.winProb).toBeGreaterThan(0);
    expect(plan.winProb).toBeLessThan(1);
    expect(plan.tips.length).toBeGreaterThan(3);
  });

  it('defiende al mejor anotador rival si conviene (uno solo, nunca el mejor propio)', () => {
    const star = sr('cad-1678', 1678, { stats: { fuel: 320, defense: 0, passes: 0, driving: 80, played: 4 } });
    const weakHeavy = sr('cad-971', 971, { stats: { fuel: 60, defense: 20, passes: 0, driving: 60, played: 4 } });
    const plan = planMatch([sr('cad-3478', 3478, { isPlayer: true, stats: { fuel: 260, defense: 0, passes: 0, driving: 70, played: 4 } }), weakHeavy, sr('cad-604', 604)], [star, sr('cad-6328', 6328), sr('cad-190', 190)], 'regional');
    const defenders = plan.orders.filter((o) => o.role === 'defender');
    expect(defenders.length).toBeLessThanOrEqual(1);
    if (defenders.length) {
      expect(defenders[0].defendTeam).toBe(1678);
      expect(defenders[0].team).not.toBe(3478);
    }
    expect(plan.tips.some((t) => t.key === 'tip_defend' || t.key === 'tip_noDefense')).toBe(true);
  });

  it('pros y contras: turret, hopper, TRENCH y climb', () => {
    const big = prosCons(sr('cad-3478', 3478));
    expect(big.pros.map((p) => p.key)).toContain('pro_turret');
    expect(big.pros.map((p) => p.key)).toContain('pro_bigHopper');
    expect(big.cons.map((p) => p.key)).toContain('con_noTrench');
  });

  it('TRAVERSAL: suma los niveles que vale la pena trepar', () => {
    const plan = planMatch(ours, theirs, 'regional');
    const climbs = plan.orders.reduce((s, o) => s + [0, 10, 20, 30][o.climb], 0) + (plan.orders.some((o) => o.auto === 'climb-l1') ? 15 : 0);
    expect(plan.rp.towerPts).toBe(climbs);
    expect(plan.rp.traversal).toBe(climbs >= 50);
  });
});
