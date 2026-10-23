/**
 * Cerebro de alianza: lleva el scouting de los 6 robots (ficha técnica + lo que observa en el
 * match) y cada ~2 s reparte los roles de sus robots de la IA según el momento (anotar,
 * alimentar o defender; ver `assignRoles`). Los robots con rol fijo en la estrategia y los del
 * jugador cuentan en el reparto pero no se mueven.
 */
import type { Match } from '../core/match';
import { ALLIANCES, opponent, type Alliance } from '../core/types';
import type { Robot } from '../game/Robot';
import type { FuelSystem } from '../physics/FuelSystem';
import type { RobotAI } from './RobotAI';
import { assignRoles, learnedProfile, profileFromSpec, type DynRole, type RobotObservation, type RobotProfile } from './Scouting';

export class AllianceBrain {
  private base: RobotProfile[];
  private obs: RobotObservation[];
  private learned: RobotProfile[];
  private t = 0;
  /** Roles actuales (para el HUD de depuración y las pruebas). */
  readonly roles = new Map<number, DynRole>();

  constructor(
    private robots: Robot[],
    private ais: Map<number, RobotAI>,
    private fuel: FuelSystem,
    /** Rol fijo por robot (estrategia o jugador); undefined = libre. */
    private fixed: (robot: Robot) => DynRole | undefined,
    /** Alianzas que reparte (las de solo jugadores no). */
    private alliances: readonly Alliance[] = ALLIANCES,
    /** Ganas de defender de cada alianza (según su dificultad). */
    private defenseWilling: (a: Alliance) => number = () => 1,
  ) {
    this.base = robots.map((r) => profileFromSpec(r.spec));
    this.learned = this.base.map((p) => ({ ...p }));
    this.obs = robots.map(() => ({ scored: 0, shot: 0, intaked: 0, activeSeconds: 0, seconds: 0 }));
  }

  profile(i: number): RobotProfile {
    return this.learned[i];
  }

  update(dt: number, m: Match | null): void {
    if (!m || !m.running) return;
    for (const r of this.robots) {
      const o = this.obs[r.index];
      o.seconds += dt;
      if (m.isHubActive(r.alliance)) o.activeSeconds += dt;
    }
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 2;
    // Aprende de lo observado
    for (const r of this.robots) {
      const o = this.obs[r.index];
      o.scored = r.stats.fuelScored;
      o.shot = r.stats.fuelShot - r.stats.passes; // los pases no son tiros fallados
      o.intaked = r.stats.intaked;
      this.learned[r.index] = learnedProfile(this.base[r.index], o);
    }
    if (m.phase === 'AUTO' || m.phase === 'AUTO_PAUSE') return;
    for (const a of this.alliances) {
      const mine = this.robots.filter((r) => r.alliance === a);
      const opp = this.robots.filter((r) => r.alliance === opponent(a));
      const oppThreat = Math.max(0, ...opp.map((r) => this.learned[r.index].scoring * (0.4 + this.fuel.robotCount(r.index) / r.spec.hopperCapacity)));
      const roles = assignRoles(
        mine.map((r) => ({ index: r.index, profile: this.learned[r.index], free: this.ais.has(r.index), fixed: this.fixed(r) })),
        { ownActive: m.isHubActive(a), oppActive: m.isHubActive(opponent(a)), endgame: m.phase === 'END_GAME', oppThreat, defenseWilling: this.defenseWilling(a) },
      );
      for (const [i, role] of roles) {
        this.roles.set(i, role);
        const ai = this.ais.get(i);
        if (ai) ai.dynRole = role;
      }
    }
  }
}
