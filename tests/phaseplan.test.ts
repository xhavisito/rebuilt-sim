import { describe, expect, it } from 'vitest';
import { autoConflicts, defaultStartZ, planTowerPoints, rowsToPlans, suggestedRows, type PhaseRow } from '../src/ai/PhasePlan';
import { planMatch, type ScoutRobot } from '../src/ai/Strategist';
import { BUILTIN_ROUTINES } from '../src/auto/AutoRoutine';
import { CAD_ROBOTS } from '../src/config/robots';

const sr = (id: string, team: number, isPlayer = false): ScoutRobot => ({ team, name: id, spec: structuredClone(CAD_ROBOTS.find((r) => r.id === id)!), isPlayer });

describe('plan del match por fases (tablas del dashboard)', () => {
  const ours = [sr('cad-3478', 3478, true), sr('cad-604', 604), sr('cad-4915', 4915)];
  const plan = planMatch(ours, [sr('cad-1678', 1678), sr('cad-971', 971), sr('cad-6328', 6328)], 'regional');
  const rows = suggestedRows(plan, ours.map((r) => r.spec.climb.maxLevel as 0 | 1 | 2 | 3));

  it('la sugerencia del drive coach: nadie espera en el inactive, cada quien con su DS', () => {
    expect(rows.map((r) => r.station)).toEqual([1, 2, 3]);
    expect(rows.find((r) => r.isPlayer)?.team).toBe(3478);
    for (const r of rows) expect(['stockpile', 'defend', 'feed']).toContain(r.inactive);
    expect(autoConflicts(rows, BUILTIN_ROUTINES).size).toBe(0);
  });

  it('las tareas por fase pasan al plan que siguen la IA y el drive coach', () => {
    const edited: PhaseRow[] = structuredClone(rows);
    edited[1].inactive = 'defend';
    edited[1].defendTeam = 971;
    edited[2].active = 'feed';
    edited[2].inactive = 'feed';
    edited[0].startZ = 1.0;
    const plans = rowsToPlans(edited);
    expect(plans[1]).toMatchObject({ role: 'defender', inactive: 'defend', defendTeam: 971 });
    expect(plans[2]).toMatchObject({ role: 'feeder', active: 'feed', inactive: 'feed' });
    expect(plans[0].startZ).toBe(1.0);
    expect(defaultStartZ(1)).toBeLessThan(defaultStartZ(3));
  });

  it('avisa si dos rutinas de AUTO comparten zona y suma la TOWER', () => {
    const r2: PhaseRow[] = structuredClone(rows);
    r2[0].auto = 'neutral-top';
    r2[1].auto = 'neutral-top';
    const c = autoConflicts(r2, BUILTIN_ROUTINES);
    expect(c.get(1)).toContain(2);
    expect(c.get(2)).toContain(1);
    r2[2].auto = 'climb-l1';
    r2.forEach((r) => (r.climb = 0));
    r2[2].climb = 2;
    expect(planTowerPoints(r2)).toBe(15 + 20);
  });
});
