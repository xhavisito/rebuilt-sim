/**
 * IA de robots (máquina de estados + planificador sencillo) que respeta las SHIFTS:
 * - SCORE: si su HUB contará el FUEL al llegar (activo o en la gracia de 3 s), va a su
 *   ALLIANCE ZONE (G407) y dispara; incluso empieza ~1 s antes de que se active.
 * - COLLECT: junta FUEL del piso (nunca el que acaba de salir de un HUB → G408).
 * - STAGE: con el hopper lleno y su HUB inactivo, espera en posición de tiro.
 * - DEFEND: el robot defensor de la alianza (lo elige la sesión) estorba al rival con más FUEL
 *   cuando su propio HUB está inactivo,
 *   soltando antes de 3 s de PIN (G418).
 * - CLIMB: en END GAME sube a su TOWER si le alcanza el tiempo.
 * - DESCEND: si quedó colgado desde AUTO, en TELEOP baja para seguir jugando.
 * Evita G420 (no se acerca a rivales en su TOWER en los últimos 30 s) y G419.
 *
 * Criterio propio: con su HUB apagado se llena por completo y llega a su punto de tiro justo
 * cuando se activa (no sale a tirar a medio llenar); al tirar sigue con la intake prendida
 * (tira mientras se mueve y se alimenta); el alimentador pasa hacia el compañero que más lo
 * necesita; el defensor marca al rival más peligroso según el scouting (`Scouting.ts`). La
 * alianza le cambia el rol (anotar / alimentar / defender) según el momento (`AllianceBrain`).
 */
import * as F from '../config/field';
import type { Difficulty } from '../config/settings';
import { isTeleop, T } from '../core/clock';
import { fuelCounts } from '../core/hub';
import type { Match } from '../core/match';
import type { Rng } from '../core/rng';
import { opponent, type Alliance } from '../core/types';
import { climbSlots, type TowerOccupancy } from '../game/Climber';
import { chassisYawFor } from '../game/Mechanisms';
import { idleCommand, type Robot, type RobotCommand } from '../game/Robot';
import { FLAG_FROM_HUB, FuelState, type FuelSystem } from '../physics/FuelSystem';
import { hubFuelNear } from './fuelSense';
import { behindTower, Navigator, zoneOf, type Pt } from './Navigator';
import { inLane, inNeutral, routeDistance, type PathPhase, type PhasePath, type RobotPlan } from './Strategy';
import { passTarget, PASS_LANE_MIN } from '../game/Mechanisms';
import type { AiMemory } from './Memory';
import type { DynRole, RobotProfile } from './Scouting';

export interface AiContext {
  robots: Robot[];
  fuel: FuelSystem;
  match: Match | null;
  rng: Rng;
  towerOcc: Record<Alliance, TowerOccupancy>;
  /** Segundos de PIN que lleva este robot como "pinner" (0 si ninguno). */
  pinSeconds(robot: number): number;
  /** FUEL "apartado" por cada robot de la IA (índice de FUEL → robot): no persiguen el mismo. */
  claims: Map<number, number>;
  /** Ficha de scouting de cada robot (la alianza la aprende en el match). */
  profile?(robot: number): RobotProfile;
  /** Memoria de prueba y error (persistente). */
  memory?: AiMemory;
  /** Táctica actual de cada robot de la IA (para no ir dos a defender a la vez). */
  tactics?: Map<number, Tactic>;
  /** Entrenamiento: explora más tácticas. */
  training?: boolean;
}

/**
 * Tácticas cuando ya está lleno y a su HUB le falta para activarse (en vez de solo esperar):
 * - hold: espera en su punto de tiro.
 * - stockpile: en la NEUTRAL ZONE sigue recogiendo y pasa lo que le sobra a su ALLIANCE ZONE
 *   (sus compañeros recargan más rápido y al rival le queda menos FUEL).
 * - defend: estorba al anotador rival más peligroso mientras su HUB está activo.
 */
export type Tactic = 'hold' | 'stockpile' | 'defend';

interface Episode {
  ctx: string;
  tactic: Tactic;
  opp0: number;
  own1: number | null;
  opp1: number;
}

type State = 'pass' | 'collect' | 'score' | 'stage' | 'defend' | 'stockpile' | 'climb' | 'descend' | 'idle';

export const DIFFICULTY: Record<Difficulty, { speed: number; think: number; accuracy: number; climbMargin: number; mistakes: number }> = {
  easy: { speed: 0.68, think: 0.9, accuracy: 0.82, climbMargin: 7, mistakes: 0.25 },
  normal: { speed: 0.84, think: 0.5, accuracy: 0.94, climbMargin: 5, mistakes: 0.1 },
  hard: { speed: 0.94, think: 0.3, accuracy: 1.0, climbMargin: 4, mistakes: 0.04 },
  einstein: { speed: 1.0, think: 0.18, accuracy: 1.06, climbMargin: 3, mistakes: 0 },
};

/** Centro aproximado de cada TOWER (UPRIGHTS y base). */
const TOWERS = (['red', 'blue'] as const).map((a) => {
  const tw = F.towerInfo(a);
  return { x: tw.uprightX - tw.facing * 0.3, z: tw.cz };
});

export class RobotAI {
  state: State = 'idle';
  private nav: Navigator;
  private thinkT = 0;
  private targetBall = -1;
  /** Hace cuánto eligió su FUEL objetivo (lo re-evalúa cada ~1.5 s, no en cada decisión). */
  private targetAge = 0;
  private target: Pt | null = null;
  private retreatT = 0;
  /** Pelotas por las que se atoró (índice → momento): las evita unos segundos. */
  private skip = new Map<number, number>();
  private seenEscapes = 0;
  private defendTarget = -1;
  /** Juega defensa cuando su HUB está inactivo y el del rival activo (rol de la estrategia). */
  defender = false;
  /** Rol que le da su alianza en este momento (solo si su plan es automático). */
  dynRole: DynRole | null = null;
  /** Rival (número de equipo) que el drive coach le pidió marcar. */
  coachVictim: number | null = null;
  /** Orden del drive coach para este SHIFT (defender o acaparar) hasta cierto momento del match. */
  coachOrder: { task: 'defend' | 'stockpile'; until: number } | null = null;
  private climbLevel = 0;
  /** Plan de la estrategia de su alianza (rol, carril, línea, punto de tiro, climb). */
  private plan: RobotPlan | null = null;
  /** Siguiente punto de la línea de recolección que recorre cuando no hay FUEL. */
  private routeIdx = 0;
  /** Táctica de esta ventana inactiva y su "episodio" (para medir qué tal le fue). */
  tactic: Tactic | null = null;
  private episode: Episode | null = null;
  private lastEta = 3;
  private hazardEscapes = 0;
  private readonly d: (typeof DIFFICULTY)[Difficulty];

  constructor(
    private r: Robot,
    private ctx: AiContext,
    difficulty: Difficulty,
  ) {
    this.nav = new Navigator(r);
    this.d = DIFFICULTY[difficulty];
    // Nivel de climb al que aspira (los fáciles a veces se quedan abajo)
    this.climbLevel = Math.max(0, r.spec.climb.maxLevel - (difficulty === 'easy' ? 1 : 0));
  }

  /** Aplica el plan de la estrategia (lo asigna la sesión, después de crear la IA). */
  setPlan(p: RobotPlan | null): void {
    this.plan = p;
    if (!p) return;
    if (p.inactive) this.defender = p.inactive === 'defend';
    else if (p.role === 'defender') this.defender = true;
    else if (p.role !== 'auto') this.defender = false;
    if (p.climb !== 'auto') this.climbLevel = Math.min(p.climb, this.r.spec.climb.maxLevel);
  }

  /** ¿Su plan deja que la alianza le cambie el rol? */
  private get roleFree(): boolean {
    return !this.plan || this.plan.role === 'auto';
  }

  /**
   * Alimentador: recoge en la NEUTRAL ZONE y pasa (en END GAME juega normal). Con tareas por fase
   * del plan, según si su HUB está activo o no.
   */
  private get feeding(): boolean {
    if (this.ctx.match?.phase === 'END_GAME') return false;
    const pl = this.plan;
    if (pl?.active || pl?.inactive) return this.hubCountsIn(0) ? pl.active === 'feed' : pl.inactive === 'feed';
    return pl?.role === 'feeder' || (this.roleFree && this.dynRole === 'feeder');
  }

  /** Orden vigente del drive coach (o null). */
  private coachTask(): 'defend' | 'stockpile' | null {
    const m = this.ctx.match;
    return this.coachOrder && m && m.t < this.coachOrder.until ? this.coachOrder.task : null;
  }

  /** ¿Le toca defender (estrategia, orden del drive coach o rol del momento)? */
  private get defending(): boolean {
    const coach = this.coachTask();
    if (coach === 'stockpile') return false;
    return this.defender || coach === 'defend' || (this.roleFree && this.dynRole === 'defender');
  }

  /** Segundos hasta que su HUB vuelve a contar FUEL (0 si ya cuenta; 99 si no vuelve). */
  private timeUntilCounts(): number {
    const m = this.ctx.match;
    if (!m || this.hubCountsIn(0)) return 0;
    for (let dt = 0.25; dt < 60; dt += 0.25) if (this.hubCountsIn(dt)) return dt;
    return 99;
  }

  /** Segundos que le quedan a su HUB contando FUEL (99 si no se apaga). */
  private timeLeftCounting(): number {
    if (!this.ctx.match) return 99;
    for (let dt = 0; dt < 40; dt += 0.25) if (!this.hubCountsIn(dt)) return dt;
    return 99;
  }

  private get sgn(): number {
    return F.allianceSign(this.r.alliance);
  }

  /** ¿El HUB propio contará FUEL que llegue dentro de `dt` segundos? */
  private hubCountsIn(dt: number): boolean {
    const m = this.ctx.match;
    if (!m) return true;
    return fuelCounts(m.t + dt, this.r.alliance, m.firstInactive);
  }

  /** ¿El robot puede tirar al HUB desde donde está? (dentro de su ALLIANCE ZONE, G407) */
  private inShootZone(): boolean {
    const p = this.r.phys.curPos;
    return this.r.alliance === 'blue' ? p.x - this.r.phys.outerL < F.STARTING_LINE_X_BLUE - 0.15 : p.x + this.r.phys.outerL > -F.STARTING_LINE_X_BLUE + 0.15;
  }

  /** ¿(x, z) está en la ALLIANCE ZONE propia, con margen para recoger sin salirse de ella? */
  private inOwnZone(x: number): boolean {
    const line = Math.abs(F.STARTING_LINE_X_BLUE) - 0.3;
    return this.r.alliance === 'blue' ? x < -line : x > line;
  }

  /**
   * Ciclo continuo (robots con turret): con su HUB activo y FUEL suelto en su ALLIANCE ZONE no
   * se para a tirar: recoge en su zona y la turret dispara en movimiento mientras se alimenta.
   */
  private continuousCycle(): boolean {
    if (this.r.spec.shooter.type !== 'turret' || !this.hubCountsIn(1.0)) return false;
    const f = this.ctx.fuel;
    let k = 0;
    for (let i = 0; i < f.count && k < 3; i++) {
      if (f.state[i] !== FuelState.Field || f.flags[i] & FLAG_FROM_HUB || f.pos[i * 3 + 1] > 0.2) continue;
      if (this.inOwnZone(f.pos[i * 3]) && !behindTower(f.pos[i * 3], f.pos[i * 3 + 2], 0.5, 0.35)) k++;
    }
    return k >= 3;
  }

  /** Fase del plan en la que está (su HUB activo, inactivo o END GAME). */
  private get pathPhase(): PathPhase {
    return this.ctx.match?.phase === 'END_GAME' ? 'endgame' : this.hubCountsIn(0) ? 'active' : 'inactive';
  }

  /** Ruta y punto que marca el plan para esta fase (mapa del dashboard), si los hay. */
  private get phasePath(): PhasePath | null {
    return this.plan?.phases?.[this.pathPhase] ?? null;
  }

  /** Línea de recolección vigente: la de la fase o, si no, la general de la estrategia. */
  private get route(): Pt[] {
    return this.phasePath?.route ?? this.plan?.route ?? [];
  }

  /** Punto de pase del plan en esta fase (si alimenta o acapara y el plan lo marca). */
  private planPassSpot(): Pt | null {
    const k = this.pathPhase;
    const task = k === 'active' ? this.plan?.active : k === 'inactive' ? this.plan?.inactive : null;
    return task === 'feed' || task === 'stockpile' ? (this.plan?.phases?.[k]?.spot ?? null) : null;
  }

  /** Punto de tiro propio dentro de la ALLIANCE ZONE, repartido por DRIVER STATION. */
  private shootSpot(): Pt {
    // el del plan: el de END GAME en END GAME; si no, el de su SHIFT activo (donde anota)
    const ph = this.plan?.phases;
    const planned = this.ctx.match?.phase === 'END_GAME' ? ph?.endgame?.spot : this.plan?.active !== 'feed' ? ph?.active?.spot : null;
    if (planned) return planned;
    if (this.plan?.shootSpot) return this.plan.shootSpot;
    const hub = F.hubCenter(this.r.alliance);
    const lanes = { 1: -2.0, 2: 0.0, 3: 2.0 } as const;
    const lane = lanes[this.r.station] * (this.r.alliance === 'blue' ? -1 : 1);
    return { x: hub.x + this.sgn * 2.55, z: lane };
  }

  private canClimbNow(): boolean {
    const m = this.ctx.match;
    if (!m || this.climbLevel === 0) return false;
    if (m.phase !== 'END_GAME' && m.phase !== 'SHIFT4') return false;
    const c = this.r.spec.climb;
    const need = [0, c.timeL1, c.timeL2, c.timeL3][this.climbLevel];
    const tw = F.towerInfo(this.r.alliance);
    const dist = Math.hypot(this.r.phys.curPos.x - tw.uprightX, this.r.phys.curPos.z - tw.cz) + (zoneOf(this.r.phys.curPos.x) !== zoneOf(tw.uprightX) ? 2 : 0);
    const travel = dist / (this.r.spec.maxSpeed * this.d.speed * 0.6);
    // ¿Vale más trepar o seguir anotando? Con su ritmo real (memoria): si en lo que tarda en
    // trepar anota claramente más que los puntos del nivel, se queda anotando
    const rate = this.ctx.memory?.rate(this.r.spec.id);
    const pts = [0, 10, 20, 30][this.climbLevel];
    if (rate && rate * (need + travel) > pts * 1.5) return false;
    return T.teleopEnd - m.t <= need + travel + this.d.climbMargin;
  }

  update(dt: number): RobotCommand {
    const r = this.r;
    const f = this.ctx.fuel;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = this.d.think * (0.8 + 0.4 * this.ctx.rng.next());
      this.decide();
    }
    const cmd = idleCommand();
    const others = this.ctx.robots;
    const speed = this.d.speed;
    const n = f.robotCount(r.index);
    // Aprende de sus errores: donde se tuvo que desatorar queda marcado como peligro (si no lo
    // estaba empujando otro robot: eso no es culpa del lugar)
    if (this.nav.escapes !== this.hazardEscapes) {
      this.hazardEscapes = this.nav.escapes;
      const p = r.phys.curPos;
      const pushed = others.some((o) => o !== r && Math.hypot(o.phys.curPos.x - p.x, o.phys.curPos.z - p.z) < o.phys.outerW + r.phys.outerW + 0.3);
      if (!pushed) this.ctx.memory?.addHazard(r.spec.id, p.x, p.z);
    }
    switch (this.state) {
      case 'collect': {
        r.intakeOn = true;
        this.targetAge += dt;
        if (this.targetBall >= 0 && f.state[this.targetBall] !== FuelState.Field) this.targetBall = -1;
        // Se atoró yendo por esta pelota (pegada a una pared o estructura): otra por un rato
        if (this.nav.escapes !== this.seenEscapes) {
          this.seenEscapes = this.nav.escapes;
          if (this.targetBall >= 0) this.skip.set(this.targetBall, this.ctx.match?.t ?? 0);
          this.targetBall = -1;
        }
        if (this.targetBall < 0 || this.targetAge > 1.5) this.pickBall();
        const route = this.route;
        if (this.targetBall < 0 && route.length) {
          // sin FUEL a la vista: recorre su línea de recolección
          const q = route[this.routeIdx % route.length];
          const p = r.phys.curPos;
          if (Math.hypot(q.x - p.x, q.z - p.z) < 0.5) this.routeIdx = (this.routeIdx + 1) % route.length;
          this.nav.plan(q);
          cmd.drive = this.nav.follow(dt, others, { speed: speed * 0.8, heading: null, tol: 0.3 }).cmd;
        }
        if (this.targetBall >= 0) {
          const o = this.targetBall * 3;
          // apunta un poco más allá de la pelota para que entre en la intake
          const bx = f.pos[o];
          const bz = f.pos[o + 2];
          const p = r.phys.curPos;
          const dx = bx - p.x;
          const dz = bz - p.z;
          const dd = Math.hypot(dx, dz) || 1;
          this.nav.plan({ x: bx + (dx / dd) * 0.25, z: bz + (dz / dd) * 0.25 });
          // La intake va al frente, hacia donde avanza (al final del acercamiento = hacia la pelota)
          const near = dd < 1.6;
          const res = this.nav.follow(dt, others, { speed: near ? speed * 0.8 : speed, heading: null, tol: 0.1 });
          cmd.drive = res.cmd;
          if (res.arrived) this.targetBall = -1;
        }
        // Turret: dispara mientras se mueve y se alimenta, si está en su zona y el HUB contará
        if (r.spec.shooter.type === 'turret' && n > 0 && this.inShootZone() && this.hubCountsIn((r.lastSolution?.tof ?? 1.0) + 0.1)) cmd.shoot = true;
        break;
      }
      case 'pass': {
        // Alimentador: pasa a su ALLIANCE ZONE desde la NEUTRAL ZONE (sigue recogiendo)
        r.intakeOn = n < r.spec.hopperCapacity;
        const p = r.phys.curPos;
        const goal = this.passGoal();
        if (!inNeutral(p.x)) {
          this.nav.plan({ x: -this.sgn * 0.5, z: p.z });
          cmd.drive = this.nav.follow(dt, others, { speed, heading: null, tol: 0.4 }).cmd;
        } else if (r.spec.shooter.type === 'turret') {
          // Con turret pasa mientras sigue recogiendo en la NEUTRAL ZONE
          if (this.targetBall < 0 || this.targetAge > 1.5 || f.state[this.targetBall] !== FuelState.Field) this.pickBall();
          this.targetAge += dt;
          if (this.targetBall >= 0) {
            const o = this.targetBall * 3;
            this.nav.plan({ x: f.pos[o], z: f.pos[o + 2] });
            cmd.drive = this.nav.follow(dt, others, { speed: speed * 0.8, heading: null, tol: 0.1 }).cmd;
          }
        }
        cmd.pass = n > 0;
        cmd.aim = { x: goal.x, z: goal.z };
        if (r.spec.shooter.type === 'fixed') cmd.drive.omega = this.nav.omegaTo(chassisYawFor(r, r.lastSolution?.yaw ?? Math.atan2(-(goal.z - p.z), goal.x - p.x)), 0.03);
        break;
      }
      case 'stockpile': {
        // Acaparar: en la NEUTRAL ZONE sigue recogiendo y pasa el excedente a su ALLIANCE ZONE
        // (se queda casi lleno); deja de pasar a tiempo para llegar lleno cuando se active
        r.intakeOn = n < r.spec.hopperCapacity;
        this.targetAge += dt;
        if (this.targetBall >= 0 && f.state[this.targetBall] !== FuelState.Field) this.targetBall = -1;
        if (this.targetBall < 0 || this.targetAge > 1.5) this.pickBall();
        const p = r.phys.curPos;
        const goal = this.passGoal();
        const passing = n >= r.spec.hopperCapacity - 2 && inNeutral(p.x) && this.timeUntilCounts() > this.lastEta + 4;
        // chasis hacia el pase si el shooter es fijo (swerve: se traslada igual)
        const passYaw = chassisYawFor(r, r.lastSolution?.yaw ?? Math.atan2(-(goal.z - p.z), goal.x - p.x));
        const heading = passing && r.spec.shooter.type === 'fixed' ? passYaw : null;
        if (this.targetBall >= 0) {
          const o = this.targetBall * 3;
          this.nav.plan({ x: f.pos[o], z: f.pos[o + 2] });
        } else this.nav.plan({ x: this.sgn * 1.6, z: p.z > 0 ? 1.8 : -1.8 }); // su mitad de la NEUTRAL ZONE
        const res = this.nav.follow(dt, others, { speed: speed * (passing && r.spec.shooter.type === 'fixed' ? 0.5 : 0.85), heading, tol: 0.15 });
        cmd.drive = res.cmd;
        if (res.arrived) this.targetBall = -1;
        cmd.pass = passing;
        cmd.aim = { x: goal.x, z: goal.z };
        if (passing && r.spec.shooter.type === 'fixed') cmd.drive.omega = this.nav.omegaTo(passYaw, 0.03);
        break;
      }
      case 'score':
      case 'stage': {
        // La intake sigue prendida: recoge lo que encuentra en el camino mientras tira
        r.intakeOn = n < r.spec.hopperCapacity;
        const spot = this.target ?? this.shootSpot();
        this.nav.plan(spot);
        const hub = F.hubCenter(r.alliance);
        const p = r.phys.curPos;
        // Rumbo del chasis para que el shooter (fijo, quizá hacia atrás) apunte al HUB
        const faceHub = chassisYawFor(r, r.lastSolution?.yaw ?? Math.atan2(-(hub.z - p.z), hub.x - p.x));
        const inZone = r.alliance === 'blue' ? p.x - r.phys.outerL < F.STARTING_LINE_X_BLUE - 0.15 : p.x + r.phys.outerL > -F.STARTING_LINE_X_BLUE + 0.15;
        // Shooter fijo: el chasis apunta al HUB; con turret el chasis conserva su rumbo
        const turret = r.spec.shooter.type === 'turret';
        const res = this.nav.follow(dt, others, { speed, heading: turret ? (inZone ? 'keep' : null) : inZone ? faceHub : null, tol: 0.35 });
        cmd.drive = res.cmd;
        // Dispara (también en movimiento) dentro de su zona y si el HUB contará el FUEL
        const tof = r.lastSolution?.tof ?? 1.0;
        if (this.state === 'score' && inZone && n > 0 && this.hubCountsIn(tof + 0.1)) {
          cmd.shoot = true;
          // Zona muerta (0.03 rad) menor que la tolerancia de tiro del shooter fijo (6°): con la
          // de 0.1 rad se quedaba quieto entre 0.09 y 0.1, sin girar ni disparar
          if (r.spec.shooter.type === 'fixed') cmd.drive.omega = this.nav.omegaTo(faceHub, 0.03);
        }
        break;
      }
      case 'defend': {
        r.intakeOn = false;
        const v = this.ctx.robots[this.defendTarget];
        if (!v) break;
        // Se interpone entre el rival y su HUB; suelta si va a cumplirse el conteo de PIN
        if (this.ctx.pinSeconds(r.index) > 2.0) this.retreatT = 3.2;
        const hub = F.hubCenter(v.alliance);
        const vp = v.phys.curPos;
        const dx = hub.x - vp.x;
        const dz = hub.z - vp.z;
        const dd = Math.hypot(dx, dz) || 1;
        let goal = { x: vp.x + (dx / dd) * 1.0, z: vp.z + (dz / dd) * 1.0 };
        if (this.retreatT > 0) {
          this.retreatT -= dt;
          goal = { x: vp.x + (dx / dd) * 2.8, z: vp.z + (dz / dd) * 2.8 + 1.5 };
        }
        this.nav.plan(goal);
        const res = this.nav.follow(dt, others.filter((o) => o !== v), { speed, heading: null, tol: 0.2, avoidRobots: this.retreatT > 0 });
        cmd.drive = res.cmd;
        break;
      }
      case 'climb': {
        r.intakeOn = false;
        if (r.climbing) {
          cmd.climbUp = r.climb.level() < this.climbLevel || !r.climb.attached;
          break;
        }
        const slot = this.freeSlot();
        if (!slot) {
          this.state = 'stage';
          break;
        }
        this.nav.plan({ x: slot.x, z: slot.z });
        const res = this.nav.follow(dt, others, { speed: speed * 0.9, heading: slot.heading, tol: 0.35 });
        cmd.drive = res.cmd;
        const p = r.phys.curPos;
        if (Math.hypot(slot.x - p.x, slot.z - p.z) < 1.0) cmd.climbUp = true;
        break;
      }
      case 'descend': {
        // Bajó de la TOWER de AUTO (ya se evaluaron sus puntos): suelta el RUNG y sigue jugando
        r.intakeOn = false;
        if (r.climbing) cmd.climbDown = true;
        else this.state = 'collect';
        break;
      }
      case 'idle':
        break;
    }
    // G408: no agarrar FUEL recién salido del HUB (la intake se apaga mientras pasa)
    if (r.intakeOn && hubFuelNear(f, r)) r.intakeOn = false;
    cmd.intake = r.intakeOn;
    return cmd;
  }

  /**
   * Dónde caen sus pases: cerca del compañero que más FUEL necesita (el menos lleno que anda en
   * su ALLIANCE ZONE o va para allá), en un carril a un lado del HUB (no derecho a la red), a
   * 2–3.5 m de la pared. Sin compañeros, el punto de siempre.
   */
  private passGoal(): { x: number; z: number } {
    const planned = this.planPassSpot();
    if (planned) return planned;
    const r = this.r;
    const f = this.ctx.fuel;
    const mates = this.ctx.robots.filter((o) => o !== r && o.alliance === r.alliance && !o.climbing);
    let best: Robot | null = null;
    let need = -1;
    for (const o of mates) {
      const fill = f.robotCount(o.index) / o.spec.hopperCapacity;
      const sc = this.ctx.profile?.(o.index).scoring ?? 0.5;
      const v = (1 - fill) * (0.5 + sc);
      if (v > need) {
        need = v;
        best = o;
      }
    }
    if (!best) return passTarget(r.alliance, r.phys.curPos.z);
    const q = best.phys.curPos;
    const wall = F.allianceSign(r.alliance) * F.HALF_L;
    const depth = Math.min(3.5, Math.max(2.0, Math.abs(wall - q.x)));
    const side = Math.sign(q.z) || (r.phys.curPos.z >= 0 ? 1 : -1);
    const z = side * Math.min(F.HALF_W - 0.8, Math.max(PASS_LANE_MIN, Math.abs(q.z)));
    return { x: wall - F.allianceSign(r.alliance) * depth, z };
  }

  /**
   * Rival a defender: el más peligroso según el scouting (qué tan bien anota por qué tan lleno
   * viene), solo si su HUB está activo. false si no hay a quién.
   */
  private pickVictim(): boolean {
    const m = this.ctx.match;
    const opp = opponent(this.r.alliance);
    if (!m || !m.isHubActive(opp)) return false;
    const threat = (o: Robot) => (this.ctx.profile?.(o.index).scoring ?? 0.5) * (0.3 + this.ctx.fuel.robotCount(o.index) / o.spec.hopperCapacity);
    const victims = this.ctx.robots.filter((o) => o.alliance === opp && !o.climbing);
    victims.sort((a, b) => threat(b) - threat(a));
    // el rival que le asignó la estrategia (o el drive coach), si está en la cancha
    const assigned = this.coachVictim ?? this.plan?.defendTeam ?? null;
    const marked = assigned !== null ? victims.find((o) => o.spec.teamNumber === assigned) : undefined;
    if (marked) victims.unshift(marked);
    if (!victims[0]) return false;
    this.defendTarget = victims[0].index;
    return true;
  }

  /** Duración (s) de la ventana activa que empieza en `until` segundos. */
  private windowAfter(until: number): number {
    let t = until;
    while (t < until + 70 && this.hubCountsIn(t)) t += 0.5;
    return t - until;
  }

  /**
   * Elige la táctica para esta ventana inactiva (prueba y error con memoria; ver `AiMemory`).
   * Criterio experto de arranque: acaparar vale más antes de una ventana larga (SHIFT 4 + END
   * GAME = 55 s seguidos para quien ganó el AUTO); defender, si empuja bien y nadie más defiende.
   */
  private chooseTactic(until: number): Tactic {
    const m = this.ctx.match!;
    const r = this.r;
    const long = this.windowAfter(until) >= 45;
    const ctxKey = `inactive-${long ? 'L' : 'S'}`;
    // esperar solo es opción si la espera es corta (si no, se pierde un robot todo el SHIFT)
    const options: Tactic[] = until - this.lastEta <= 8 ? ['hold', 'stockpile'] : ['stockpile'];
    const mates = this.ctx.robots.filter((o) => o !== r && o.alliance === r.alliance);
    const someoneDefends = mates.some((o) => this.ctx.tactics?.get(o.index) === 'defend');
    if (!someoneDefends && m.isHubActive(opponent(r.alliance))) options.push('defend');
    const prof = this.ctx.profile?.(r.index);
    const heuristic: Record<string, number> = {
      hold: 0,
      stockpile: 3 + (long ? 3 : 0) + ((prof?.passing ?? 0.5) - 0.5) * 6,
      defend: 1 + ((prof?.defense ?? 0.5) - 0.5) * 12,
    };
    const mem = this.ctx.memory;
    let t: Tactic;
    if (mem) t = mem.choose(r.spec.id, ctxKey, options, this.ctx.rng, heuristic, this.ctx.training ? 0.3 : 0.05) as Tactic;
    else t = options.reduce((a, b) => (heuristic[b] > heuristic[a] ? b : a));
    this.startEpisode(t, until, ctxKey);
    return t;
  }

  /** Empieza a medir cómo le va a la táctica de esta ventana inactiva. */
  private startEpisode(t: Tactic, until: number, ctxKey = `inactive-${this.windowAfter(until) >= 45 ? 'L' : 'S'}`): void {
    const m = this.ctx.match!;
    const opp = opponent(this.r.alliance);
    this.tactic = t;
    this.episode = { ctx: ctxKey, tactic: t, opp0: m.score(opp), own1: null, opp1: m.score(opp) };
  }

  /**
   * Lleva la cuenta del episodio de la táctica: lo que anotó el rival mientras su HUB estaba
   * apagado y lo que anotó su alianza en la ventana activa siguiente. Recompensa (por robot) =
   * (propios − rivales) / 3.
   */
  private trackEpisode(final = false): void {
    const m = this.ctx.match;
    const ep = this.episode;
    if (!m || !ep) return;
    const own = this.r.alliance;
    const opp = opponent(own);
    const counting = this.hubCountsIn(0);
    if (ep.own1 === null) {
      if (counting) {
        ep.own1 = m.score(own);
        ep.opp1 = m.score(opp);
      } else if (final) this.episode = null;
      return;
    }
    if (!counting || final) {
      const reward = (m.score(own) - ep.own1) / 3 - (ep.opp1 - ep.opp0) / 3;
      this.ctx.memory?.record(this.r.spec.id, ep.ctx, ep.tactic, reward);
      this.episode = null;
    }
  }

  /** Fin del match: cierra el episodio pendiente y guarda lo aprendido. */
  finishMatch(activeSeconds: number): void {
    this.trackEpisode(true);
    const mem = this.ctx.memory;
    if (!mem) return;
    mem.endMatch(this.r.spec.id, activeSeconds > 20 ? this.r.stats.fuelScored / activeSeconds : null);
  }

  private freeSlot() {
    const occ = this.ctx.towerOcc[this.r.alliance];
    const p = this.r.phys.curPos;
    let best = null;
    let bd = Infinity;
    for (const s of climbSlots(this.r.alliance, this.r.phys.outerL, this.r.phys.outerW)) {
      if (occ[s.id] !== -1 && occ[s.id] !== this.r.index) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** Elige el estado según el tiempo del match, el hopper y el estado del HUB. */
  private decide(): void {
    const r = this.r;
    const n = this.ctx.fuel.robotCount(r.index);
    const cap = r.spec.hopperCapacity;
    const m = this.ctx.match;
    // Colgado desde AUTO (§6.5-C: esa TOWER se evalúa al llegar a 0:00): en TELEOP baja a jugar y
    // vuelve a subir en END GAME. Si la IA misma decidió subir (estado 'climb'), se queda.
    if (r.climbing && this.state !== 'climb' && m && isTeleop(m.phase) && m.phase !== 'END_GAME' && !this.canClimbNow()) {
      this.state = 'descend';
      return;
    }
    if (this.state === 'descend' && r.climbing) return;
    if (r.climbing || this.state === 'climb' || this.canClimbNow()) {
      this.state = 'climb';
      return;
    }
    // Tiempo aproximado para llegar a tirar
    const spot = this.shootSpot();
    const dist = Math.hypot(spot.x - r.phys.curPos.x, spot.z - r.phys.curPos.z) + (zoneOf(r.phys.curPos.x) !== zoneOf(spot.x) ? 1.5 : 0);
    const eta = dist / (r.spec.maxSpeed * this.d.speed * 0.75);
    const willCount = this.hubCountsIn(eta + 1.0);
    const countsNow = this.hubCountsIn(1.0);
    const full = n >= cap - 1;
    if (this.feeding) {
      // junta unos cuantos y los pasa; sigue pasando hasta vaciarse
      const batch = Math.min(cap, 6);
      if (n >= batch || (this.state === 'pass' && n > 0)) this.state = 'pass';
      else {
        if (this.state !== 'collect') this.targetBall = -1;
        this.state = 'collect';
      }
      return;
    }
    if (!full && this.continuousCycle()) {
      if (this.state !== 'collect') this.targetBall = -1;
      this.state = 'collect';
      return;
    }
    const endgame = m !== null && m.phase === 'END_GAME';
    this.lastEta = eta;
    this.trackEpisode();
    if (this.hubCountsIn(0)) this.tactic = null; // la táctica dura una ventana inactiva
    this.ctx.tactics?.set(r.index, this.state === 'defend' ? 'defend' : (this.tactic ?? 'hold'));
    if (countsNow) {
      // HUB activo: tira lo que trae si alcanza a llegar antes de que se apague; si no, junta
      // para el siguiente
      // Viajes con carga grande (cada viaje cuesta ~7 s ida y vuelta): junta casi lleno y sale
      // cuando el tiempo de la ventana alcanza justo para llegar y vaciar el hopper
      const left = this.timeLeftCounting();
      const tof = r.lastSolution?.tof ?? 1.0;
      const worth = left > eta + tof + 0.3;
      const empty = n / Math.max(1, r.spec.shooter.rate * (r.spec.shooter.lanes ?? 1));
      const mustGo = left <= eta + empty + tof + 2.0;
      const load = Math.min(cap - 1, Math.max(8, Math.round(cap * 0.85)));
      const nothingNear = this.state === 'collect' && this.targetBall < 0 && !this.route.length;
      if (n > 0 && worth && (n >= load || mustGo || nothingNear || this.state === 'score' || this.inShootZone())) {
        this.state = 'score';
        this.target = spot;
        return;
      }
    } else if (willCount || n > 0) {
      // HUB apagado: se llena por completo y sale a su punto de tiro justo a tiempo para estar
      // ahí cuando se active (no a medio llenar)
      const until = this.timeUntilCounts();
      if (n > 0 && until <= eta + 1.2) {
        this.state = 'score';
        this.target = spot;
        return;
      }
      // Con tiempo de sobra nunca se queda esperando todo el SHIFT en su zona: el defensor
      // defiende (aunque ya esté lleno) y los demás, ya llenos o por orden del drive coach,
      // acaparan (pasan FUEL a su ALLIANCE ZONE) o defienden. Esperar solo si falta poco.
      const slack = until - eta;
      if (!endgame && slack > 4 && !this.feeding) {
        if (this.defending && this.pickVictim()) {
          this.state = 'defend';
          return;
        }
        // la orden del coach o la tarea del plan para el SHIFT inactivo
        const coach = this.coachTask() ?? (this.plan?.inactive === 'stockpile' ? 'stockpile' : null);
        if (coach === 'stockpile' || n >= cap - 2 || this.tactic) {
          let t: Tactic;
          if (coach === 'stockpile') {
            if (this.tactic !== 'stockpile') this.startEpisode('stockpile', until);
            t = 'stockpile';
          } else t = this.tactic ?? this.chooseTactic(until);
          if (t === 'defend' && !this.pickVictim()) t = 'stockpile';
          if (t === 'hold' && slack > 8) t = 'stockpile';
          this.tactic = t;
          if (t === 'defend') {
            this.state = 'defend';
            return;
          }
          if (t === 'stockpile') {
            if (this.state !== 'stockpile') this.targetBall = -1;
            this.state = 'stockpile';
            return;
          }
        }
      }
      if (n > 0 && full) {
        this.state = 'stage';
        this.target = spot;
        return;
      }
    }
    // Defensor: con su HUB inactivo y el rival activo; marca al rival más peligroso (scouting:
    // qué tan bien anota por qué tan lleno viene)
    const opp = opponent(r.alliance);
    if (this.defending && m && !m.isHubActive(r.alliance) && m.isHubActive(opp) && !endgame && this.pickVictim()) {
      this.state = 'defend';
      return;
    }
    if (full) {
      this.state = 'stage';
      this.target = spot;
      return;
    }
    if (this.state !== 'collect') this.targetBall = -1;
    this.state = 'collect';
    // errores ocasionales según la dificultad: cambia de objetivo sin razón
    if (this.ctx.rng.next() < this.d.mistakes * 0.3) this.targetBall = -1;
  }

  /**
   * FUEL más conveniente: cerca, de preferencia enfrente (no gira de más), en su lado o en la
   * NEUTRAL ZONE, lejos de las salidas del HUB. Conserva el objetivo actual salvo que otro
   * sea claramente mejor (un piloto no cambia de pelota a cada rato).
   */
  private pickBall(): void {
    this.targetAge = 0;
    const prev = this.targetBall;
    const claims = this.ctx.claims;
    if (prev >= 0 && claims.get(prev) === this.r.index) claims.delete(prev);
    const h0 = this.r.phys.heading();
    const f = this.ctx.fuel;
    const r = this.r;
    const p = r.phys.curPos;
    const myZone = zoneOf(p.x);
    const oppZone = r.alliance === 'blue' ? 2 : 0;
    const m = this.ctx.match;
    const endgame = m?.phase === 'END_GAME';
    const allies = this.ctx.robots.filter((o) => o !== r && o.alliance === r.alliance);
    const tall = r.phys.height > F.TRENCH_CLEAR_HEIGHT;
    const cycling = r.spec.shooter.type === 'turret' && this.hubCountsIn(1.0);
    // Montones: celdas de 0.6 m con varios FUEL valen más (la intake se lleva varios de una pasada)
    const dens = new Map<number, number>();
    const cellOf = (x: number, z: number) => Math.floor(x / 0.6) * 1000 + Math.floor(z / 0.6);
    for (let i = 0; i < f.count; i++) {
      if (f.state[i] !== FuelState.Field || f.pos[i * 3 + 1] > 0.2) continue;
      const k = cellOf(f.pos[i * 3], f.pos[i * 3 + 2]);
      dens.set(k, (dens.get(k) ?? 0) + 1);
    }
    const mem = this.ctx.memory;
    const route = this.route;
    // Poco antes de que se active su HUB: el FUEL camino a su punto de tiro vale más
    const until = this.timeUntilCounts();
    const spot = until > 0 && until < 10 && !this.feeding ? this.shootSpot() : null;
    let best = -1;
    let bestC = Infinity;
    for (let i = 0; i < f.count; i++) {
      if (f.state[i] !== FuelState.Field || f.flags[i] & FLAG_FROM_HUB) continue;
      const o = i * 3;
      const x = f.pos[o];
      const y = f.pos[o + 1];
      const z = f.pos[o + 2];
      if (y > 0.2) continue;
      const zx = zoneOf(x);
      if (zx === oppZone) continue;
      const owner = claims.get(i);
      if (owner !== undefined && owner !== r.index) continue;
      const sk = this.skip.get(i);
      if (sk !== undefined && (m?.t ?? 0) - sk < 8) continue;
      // lejos de las salidas de los HUBS (G408) y de las estructuras
      if (Math.abs(Math.abs(x) - Math.abs(F.HUB_CENTER_X_BLUE)) < 1.0 && Math.abs(z) < 1.0) continue;
      if (Math.abs(Math.abs(x) - Math.abs(F.HUB_CENTER_X_BLUE)) < 0.8) continue;
      if (tall && Math.abs(z) > F.HALF_W - F.TRENCH_CLEAR_WIDTH && Math.abs(Math.abs(x) - Math.abs(F.HUB_CENTER_X_BLUE)) < 0.9) continue;
      // pegadas a la pared o a la TOWER: la intake (sólida) toca la estructura antes que la pelota
      if (Math.abs(z) > F.HALF_W - 0.17 || Math.abs(x) > F.HALF_L - 0.3) continue;
      if (TOWERS.some((tw) => Math.hypot(x - tw.x, z - tw.z) < 1.05)) continue;
      if (behindTower(x, z, 0.5, 0.35)) continue; // y en la esquina junto a ella
      // En END GAME no se acerca a la TOWER rival (G420)
      if (endgame) {
        const tw = F.towerInfo(opponent(r.alliance));
        if (Math.hypot(x - tw.cx, z - tw.cz) < 2.2) continue;
      }
      if ((this.feeding || this.state === 'stockpile') && !inNeutral(x)) continue;
      let c = Math.hypot(x - p.x, z - p.z);
      c -= Math.min(1.2, 0.3 * ((dens.get(cellOf(x, z)) ?? 1) - 1));
      if (mem) c += mem.hazardCost(r.spec.id, x, z);
      // Plan: su carril y su línea de recolección
      if (this.plan) {
        if (!inLane(this.plan.lane, z, r.alliance)) c += 3;
        if (route.length) c += Math.min(4, routeDistance(route, x, z)) * 0.8;
      }
      // Ciclo continuo: se queda recogiendo en su ALLIANCE ZONE, donde puede seguir tirando
      if (cycling) c += this.inOwnZone(x) ? -1.5 : 3;
      if (spot) c += Math.hypot(x - spot.x, z - spot.z) * 0.35;
      // girar cuesta: ~0.5 m por cada radián de giro hacia la pelota
      const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(-(z - p.z), x - p.x) - h0), Math.cos(Math.atan2(-(z - p.z), x - p.x) - h0)));
      c += turn * 0.5;
      if (i === prev) c -= 0.8; // histéresis
      if (zx !== myZone) c += 2.2;
      // FUEL más cerca de un compañero que de mí: que lo tome él (se reparten el campo)
      for (const a of allies) {
        const da = Math.hypot(a.phys.curPos.x - x, a.phys.curPos.z - z);
        if (da < 1.2) c += 2.5;
        else if (da < Math.hypot(x - p.x, z - p.z) - 0.5) c += 1.2;
      }
      if (c < bestC) {
        bestC = c;
        best = i;
      }
    }
    this.targetBall = best;
    if (best >= 0) claims.set(best, r.index);
  }
}
