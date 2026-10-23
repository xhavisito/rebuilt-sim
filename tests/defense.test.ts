import { describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { DIFFICULTIES, DIFFICULTY } from '../src/ai/difficulty';
import { blocked, defenseGoal, passClear, evadeSpot, pickThreat, victimHeading, type Candidate } from '../src/ai/Defense';
import { assignRoles, type BrainMember, type RobotProfile } from '../src/ai/Scouting';

const opts = { lead: 0, intercept: true, standoff: 0.9, shadow: false };

describe('dificultad de la IA', () => {
  it('cada nivel es más rápido, reacciona antes y tira mejor que el anterior', () => {
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      const a = DIFFICULTY[DIFFICULTIES[i - 1]];
      const b = DIFFICULTY[DIFFICULTIES[i]];
      expect(b.speed).toBeGreaterThan(a.speed);
      expect(b.think).toBeLessThan(a.think);
      expect(b.accuracy).toBeGreaterThan(a.accuracy);
      expect(b.defense.lead).toBeGreaterThanOrEqual(a.defense.lead);
      expect(b.defense.willing).toBeGreaterThanOrEqual(a.defense.willing);
    }
  });

  it('suelta el PIN antes de los 3 s de G418 en todos los niveles', () => {
    for (const d of DIFFICULTIES) expect(DIFFICULTY[d].defense.pinRelease).toBeLessThan(3);
  });

  it('Fácil no juega defensa por su cuenta ni aprende', () => {
    expect(DIFFICULTY.easy.defense.willing).toBe(0);
    expect(DIFFICULTY.easy.memory).toBe(false);
  });
});

describe('defensa', () => {
  it('un rival en la NEUTRAL ZONE va al carril más cercano para cruzar; ya cruzado, a su HUB', () => {
    const blueHub = F.hubCenter('blue');
    const h = victimHeading('blue', { x: 0, z: 1.2 }, false);
    expect(h.crossing).toBe(true);
    expect(h.pt.z).toBeCloseTo(F.BUMP_CENTER_Z);
    expect(h.pt.x).toBeGreaterThan(blueHub.x); // en la boca, del lado de la NEUTRAL ZONE
    const t = victimHeading('blue', { x: 0, z: 3.4 }, true);
    expect(Math.abs(t.pt.z)).toBeGreaterThan(F.TRENCH_INNER_Z); // por el TRENCH si cabe
    const home = victimHeading('blue', { x: -6, z: 0 }, true);
    expect(home.crossing).toBe(false);
    expect(home.pt).toEqual(blueHub);
  });

  it('con anticipación espera al rival en la boca del BUMP antes de que llegue', () => {
    const g = defenseGoal('blue', { x: 1.5, z: 1.4, vx: -2, vz: 0 }, false, opts);
    expect(Math.abs(g.z - F.BUMP_CENTER_Z)).toBeLessThan(0.5);
    expect(g.x).toBeGreaterThan(F.hubCenter('blue').x);
    expect(g.x).toBeLessThan(0); // entre el rival y su zona
  });

  it('en su zona se le pone enfrente, del lado de su HUB, sin meterse al HUB', () => {
    const v = { x: -6.2, z: 0, vx: 0, vz: 0 };
    const g = defenseGoal('blue', v, true, opts);
    expect(g.x).toBeGreaterThan(v.x);
    const hub = F.hubCenter('blue');
    expect(Math.hypot(g.x - hub.x, g.z - hub.z)).toBeGreaterThan(F.HUB_SIZE * 0.62);
    // al soltar un PIN se queda más lejos (sin tocarlo)
    const s = defenseGoal('blue', v, true, { ...opts, shadow: true });
    expect(Math.hypot(s.x - v.x, s.z - v.z)).toBeGreaterThan(Math.hypot(g.x - v.x, g.z - v.z));
  });

  it('marca al rival lleno que anota bien, no a uno vacío ni a uno trepando', () => {
    const c: Candidate[] = [
      { index: 3, pos: { x: 1, z: 0 }, scoring: 0.9, fill: 0, off: false },
      { index: 4, pos: { x: 2, z: 1 }, scoring: 0.7, fill: 0.9 },
      { index: 5, pos: { x: 1, z: 1 }, scoring: 1, fill: 1, off: true },
    ];
    expect(pickThreat(c, { x: 0, z: 0 })).toBe(4);
    // nadie trae FUEL: no vale la pena defender
    expect(pickThreat([{ index: 3, pos: { x: 6, z: 0 }, scoring: 0.5, fill: 0 }], { x: 0, z: 0 })).toBe(-1);
    // el asignado por la estrategia manda
    expect(pickThreat(c, { x: 0, z: 0 }, -1, 3)).toBe(3);
  });

  it('conserva a su víctima salvo que otra sea claramente más peligrosa', () => {
    const c: Candidate[] = [
      { index: 3, pos: { x: 1, z: 0 }, scoring: 0.7, fill: 0.8 },
      { index: 4, pos: { x: 1, z: 0 }, scoring: 0.75, fill: 0.8 },
    ];
    expect(pickThreat(c, { x: 0, z: 0 }, 3)).toBe(3);
  });

  it('el anotador defendido elige un punto de tiro libre', () => {
    const me = { x: -4.8, z: 0 };
    const spots = [{ x: -6.2, z: 0 }, { x: -6.2, z: 2.4 }, { x: -6.2, z: -2.4 }];
    const def = [{ x: -5.6, z: 0 }];
    expect(blocked(me, spots[0], def)).toBe(true);
    const s = evadeSpot(me, spots, def, spots[0]);
    expect(s).not.toBe(spots[0]);
    expect(Math.hypot(s.x - def[0].x, s.z - def[0].z)).toBeGreaterThan(2.2);
  });
});

describe('pases sin G407', () => {
  it('no pasa con su HUB en medio; desde un costado sí', () => {
    const hub = F.hubCenter('blue');
    expect(passClear('blue', { x: -1.5, z: 0 }, { x: -6.5, z: 0.3 })).toBe(false);
    expect(passClear('blue', { x: -1.5, z: 2.8 }, { x: -6.5, z: 2.6 })).toBe(true);
    expect(hub.x).toBeLessThan(-1.5);
  });
});

describe('roles por dificultad', () => {
  const prof = (scoring: number, defense: number): RobotProfile => ({ scoring, collecting: 0.5, defense, passing: 0.4, driving: 0.5, climb: 0.5 });
  const team: BrainMember[] = [
    { index: 0, profile: prof(0.9, 0.3), free: true },
    { index: 1, profile: prof(0.8, 0.3), free: true },
    { index: 2, profile: prof(0.5, 0.38), free: true },
  ];
  const sit = { ownActive: false, oppActive: true, endgame: false, oppThreat: 0.5 };
  it('más dificultad defiende con menos amenaza; Fácil nunca', () => {
    expect([...assignRoles(team, { ...sit, defenseWilling: 1 }).values()]).not.toContain('defender');
    expect(assignRoles(team, { ...sit, defenseWilling: DIFFICULTY.einstein.defense.willing }).get(2)).toBe('defender');
    expect([...assignRoles(team, { ...sit, oppThreat: 1, defenseWilling: 0 }).values()]).not.toContain('defender');
  });
});
