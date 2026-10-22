import { describe, expect, it } from 'vitest';
import { autoConflicts, defaultStartZ, normalizeRow, planTowerPoints, rowsToPlans, suggestedRows, type PhaseRow } from '../src/ai/PhasePlan';
import { planMatch, type ScoutRobot } from '../src/ai/Strategist';
import { planAt } from '../src/ai/Strategy';
import { shiftWindow } from '../src/core/hub';
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
    for (const r of rows) for (const w of r.windows) expect(['stockpile', 'defend', 'feed']).toContain(w.inactive);
    expect(autoConflicts(rows, BUILTIN_ROUTINES).size).toBe(0);
  });

  it('las tareas por fase pasan al plan que siguen la IA y el drive coach', () => {
    const edited: PhaseRow[] = structuredClone(rows);
    // DS2: defiende a 971 solo en el SHIFT inactivo 2; DS3 alimenta todo el match
    edited[1].windows[1] = { active: 'score', inactive: 'defend', defendTeam: 971 };
    edited[2].windows = [{ active: 'feed', inactive: 'feed', defendTeam: null }, { active: 'feed', inactive: 'feed', defendTeam: null }];
    edited[0].startZ = 1.0;
    const plans = rowsToPlans(edited);
    expect(planAt(plans[1], 0).inactive).toBe('stockpile');
    expect(planAt(plans[1], 1)).toMatchObject({ inactive: 'defend', defendTeam: 971 });
    expect(plans[2]).toMatchObject({ role: 'feeder' });
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

describe('tablas por SHIFT', () => {
  it('SHIFT 1–2 son la ventana 1 y SHIFT 3–4 la ventana 2 (gane o pierda el AUTO)', () => {
    expect(['TRANSITION', 'SHIFT1', 'SHIFT2'].map((p) => shiftWindow(p as never))).toEqual([0, 0, 0]);
    expect(['SHIFT3', 'SHIFT4', 'END_GAME'].map((p) => shiftWindow(p as never))).toEqual([1, 1, 1]);
  });
  it('un plan guardado con el formato anterior se pasa a las dos ventanas', () => {
    const old = { team: 1, station: 1, isPlayer: false, startZ: null, auto: 'preload', active: 'feed', inactive: 'defend', defendTeam: 254, climb: 0, maxClimb: 0 } as never;
    const r = normalizeRow(old);
    expect(r.windows).toEqual([
      { active: 'feed', inactive: 'defend', defendTeam: 254 },
      { active: 'feed', inactive: 'defend', defendTeam: 254 },
    ]);
    expect('active' in r).toBe(false);
  });
});
