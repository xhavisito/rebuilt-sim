import { describe, expect, it } from 'vitest';
import { assignRoles, learnedProfile, profileFromSpec, type BrainMember, type RobotProfile } from '../src/ai/Scouting';
import { CAD_ROBOTS, ROBOT_PRESETS } from '../src/config/robots';

const prof = (o: Partial<RobotProfile>): RobotProfile => ({ scoring: 0.7, collecting: 0.6, defense: 0.4, passing: 0.5, driving: 0.6, climb: 0, ...o });
const m = (index: number, o: Partial<RobotProfile>, extra: Partial<BrainMember> = {}): BrainMember => ({ index, profile: prof(o), free: true, ...extra });

describe('scouting de robots', () => {
  it('las fichas de todos los robots quedan entre 0 y 1', () => {
    for (const s of [...ROBOT_PRESETS, ...CAD_ROBOTS]) for (const v of Object.values(profileFromSpec(s))) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
  });
  it('aprende de lo que ve: un robot que falla mucho baja su calificación de anotar', () => {
    const base = prof({ scoring: 0.8 });
    const bad = learnedProfile(base, { scored: 10, shot: 60, intaked: 60, activeSeconds: 60, seconds: 120 });
    const good = learnedProfile(base, { scored: 90, shot: 95, intaked: 95, activeSeconds: 60, seconds: 120 });
    expect(bad.scoring).toBeLessThan(0.6);
    expect(good.scoring).toBeGreaterThan(bad.scoring);
    // sin ver nada, la ficha técnica
    expect(learnedProfile(base, { scored: 0, shot: 0, intaked: 0, activeSeconds: 0, seconds: 0 })).toEqual(base);
  });
});

describe('reparto de roles de la alianza', () => {
  const team = [m(0, { scoring: 0.9 }), m(1, { scoring: 0.85 }), m(2, { scoring: 0.35, defense: 0.8, passing: 0.3 })];
  it('con el HUB propio activo todos anotan', () => {
    const r = assignRoles(team, { ownActive: true, oppActive: false, endgame: false, oppThreat: 0.9 });
    expect([...r.values()].every((x) => x === 'scorer')).toBe(true);
  });
  it('con el propio apagado, el que menos anota y mejor empuja defiende al rival peligroso', () => {
    const r = assignRoles(team, { ownActive: false, oppActive: true, endgame: false, oppThreat: 0.9 });
    expect(r.get(2)).toBe('defender');
    expect(r.get(0)).toBe('scorer');
    // contra un rival flojo no vale la pena
    expect(assignRoles(team, { ownActive: false, oppActive: true, endgame: false, oppThreat: 0.1 }).get(2)).not.toBe('defender');
  });
  it('el que anota poco pero pasa bien alimenta', () => {
    const t2 = [m(0, { scoring: 0.9 }), m(1, { scoring: 0.8 }), m(2, { scoring: 0.4, passing: 0.8, defense: 0.2 })];
    expect(assignRoles(t2, { ownActive: true, oppActive: false, endgame: false, oppThreat: 0.5 }).get(2)).toBe('feeder');
  });
  it('en END GAME todos anotan y los roles fijos se respetan', () => {
    expect([...assignRoles(team, { ownActive: false, oppActive: true, endgame: true, oppThreat: 1 }).values()].every((x) => x === 'scorer')).toBe(true);
    const fixed = [m(0, { scoring: 0.9 }, { fixed: 'defender' }), ...team.slice(1)];
    const r = assignRoles(fixed, { ownActive: false, oppActive: true, endgame: false, oppThreat: 1 });
    expect(r.get(0)).toBe('defender');
    expect([...r.values()].filter((x) => x === 'defender').length).toBe(1);
  });
});
