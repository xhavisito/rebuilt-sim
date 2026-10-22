import { describe, expect, it } from 'vitest';
import { Match } from '../src/core/match';
import { Rng } from '../src/core/rng';
import { DriveCoach, type CoachMsg } from '../src/game/DriveCoach';
import type { Robot } from '../src/game/Robot';

/** Robot falso: lo mínimo que lee el drive coach. */
const fake = (index: number, alliance: 'red' | 'blue', team: number): Robot =>
  ({
    index,
    alliance,
    climbing: false,
    spec: { teamNumber: team, hopperCapacity: 50, climb: { maxLevel: 2, timeL1: 3, timeL2: 6, timeL3: 9 } },
    stats: { fuelScored: 0, fuelShot: 0, passes: 0, defenseSec: 0, intaked: 0, distance: 0, towerPts: 0, fouls: 0 },
    phys: { curPos: { x: 0, y: 0, z: 0 }, velocity: () => ({ x: 1, y: 0, z: 0 }) },
  }) as unknown as Robot;

describe('drive coach', () => {
  it('anuncia el plan, avisa 5 s antes del active y cuando se activa, y el plan de END GAME', () => {
    const m = new Match('regional', new Rng(1));
    const robots = [fake(0, 'blue', 3478), fake(1, 'blue', 604), fake(2, 'blue', 4915), fake(3, 'red', 1678), fake(4, 'red', 971), fake(5, 'red', 6328)];
    const msgs: Array<CoachMsg & { t: number }> = [];
    const coach = new DriveCoach(
      { robots, match: m, fuel: { robotCount: () => 10 } as never, ais: new Map(), plans: robots.map(() => undefined), profile: () => ({ scoring: 0.6, collecting: 0.5, defense: 0.5, passing: 0.5, driving: 0.5, climb: 0.3 }), eventType: 'regional' },
      robots[0],
      (x) => msgs.push({ ...x, t: m.t }),
    );
    m.start();
    for (let k = 0; k < 166 * 20; k++) {
      m.tick(0.05);
      coach.update(0.05);
    }
    const keys = msgs.map((x) => x.key);
    expect(keys[0]).toBe('coach_plan');
    expect(keys).toContain('coach_activeNow');
    const soon = msgs.find((x) => x.key === 'coach_activeSoon')!;
    const now = msgs.find((x) => x.key === 'coach_activeNow' && x.t > soon.t)!;
    expect(now.t - soon.t).toBeGreaterThan(3.5);
    expect(now.t - soon.t).toBeLessThan(6);
    expect(keys).toContain('coach_climbPlan');
    expect(keys).toContain('coach_partnersClimb');
    // nada después del final del TELEOP
    expect(msgs.every((x) => x.t <= 160.5)).toBe(true);
  });
});
