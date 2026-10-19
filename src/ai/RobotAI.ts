/**
 * IA de robots (máquina de estados + planificador sencillo) que respeta las SHIFTS:
 * - SCORE: si su HUB contará el FUEL al llegar (activo o en la gracia de 3 s), va a su
 *   ALLIANCE ZONE (G407) y dispara; incluso empieza ~1 s antes de que se active.
 * - COLLECT: junta FUEL del piso (nunca el que acaba de salir de un HUB → G408).
 * - STAGE: con el hopper lleno y su HUB inactivo, espera en posición de tiro.
 * - DEFEND: el "Defensor" estorba al rival con más FUEL cuando su propio HUB está inactivo,
 *   soltando antes de 3 s de PIN (G418).
 * - CLIMB: en END GAME sube a su TOWER si le alcanza el tiempo.
 * Evita G420 (no se acerca a rivales en su TOWER en los últimos 30 s) y G419.
 */
import * as F from '../config/field';
import type { Difficulty } from '../config/settings';
import { T } from '../core/clock';
import { fuelCounts } from '../core/hub';
import type { Match } from '../core/match';
import type { Rng } from '../core/rng';
import { opponent, type Alliance } from '../core/types';
import { climbSlots, type TowerOccupancy } from '../game/Climber';
import { idleCommand, type Robot, type RobotCommand } from '../game/Robot';
import { FLAG_FROM_HUB, FuelState, type FuelSystem } from '../physics/FuelSystem';
import { Navigator, zoneOf, type Pt } from './Navigator';

export interface AiContext {
  robots: Robot[];
  fuel: FuelSystem;
  match: Match | null;
  rng: Rng;
  towerOcc: Record<Alliance, TowerOccupancy>;
  /** Segundos de PIN que lleva este robot como "pinner" (0 si ninguno). */
  pinSeconds(robot: number): number;
}

type State = 'collect' | 'score' | 'stage' | 'defend' | 'climb' | 'idle';

export const DIFFICULTY: Record<Difficulty, { speed: number; think: number; accuracy: number; climbMargin: number; mistakes: number }> = {
  easy: { speed: 0.68, think: 0.9, accuracy: 0.82, climbMargin: 7, mistakes: 0.25 },
  normal: { speed: 0.84, think: 0.5, accuracy: 0.94, climbMargin: 5, mistakes: 0.1 },
  hard: { speed: 0.94, think: 0.3, accuracy: 1.0, climbMargin: 4, mistakes: 0.04 },
  einstein: { speed: 1.0, think: 0.18, accuracy: 1.06, climbMargin: 3, mistakes: 0 },
};

export class RobotAI {
  state: State = 'idle';
  private nav: Navigator;
  private thinkT = 0;
  private targetBall = -1;
  private target: Pt | null = null;
  private retreatT = 0;
  private defendTarget = -1;
  private climbLevel = 0;
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

  private get sgn(): number {
    return F.allianceSign(this.r.alliance);
  }

  /** ¿El HUB propio contará FUEL que llegue dentro de `dt` segundos? */
  private hubCountsIn(dt: number): boolean {
    const m = this.ctx.match;
    if (!m) return true;
    return fuelCounts(m.t + dt, this.r.alliance, m.firstInactive);
  }

  /** Punto de tiro propio dentro de la ALLIANCE ZONE, repartido por DRIVER STATION. */
  private shootSpot(): Pt {
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
    switch (this.state) {
      case 'collect': {
        r.intakeOn = true;
        if (this.targetBall >= 0 && f.state[this.targetBall] !== FuelState.Field) this.targetBall = -1;
        if (this.targetBall < 0) this.pickBall();
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
          const near = dd < 1.6;
          const res = this.nav.follow(dt, others, { speed: near ? speed * 0.75 : speed, heading: near ? Math.atan2(-dz, dx) : null, tol: 0.1 });
          cmd.drive = res.cmd;
          if (res.arrived) this.targetBall = -1;
        }
        break;
      }
      case 'score':
      case 'stage': {
        r.intakeOn = n < r.spec.hopperCapacity && this.state === 'stage';
        const spot = this.target ?? this.shootSpot();
        this.nav.plan(spot);
        const hub = F.hubCenter(r.alliance);
        const p = r.phys.curPos;
        const faceHub = r.lastSolution?.yaw ?? Math.atan2(-(hub.z - p.z), hub.x - p.x);
        const inZone = r.alliance === 'blue' ? p.x - r.phys.outerL < F.STARTING_LINE_X_BLUE - 0.15 : p.x + r.phys.outerL > -F.STARTING_LINE_X_BLUE + 0.15;
        const res = this.nav.follow(dt, others, { speed, heading: inZone ? faceHub : null, tol: 0.35 });
        cmd.drive = res.cmd;
        // Dispara (también en movimiento) dentro de su zona y si el HUB contará el FUEL
        const tof = r.lastSolution?.tof ?? 1.0;
        if (this.state === 'score' && inZone && n > 0 && this.hubCountsIn(tof + 0.1)) {
          cmd.shoot = true;
          if (r.spec.shooter.type === 'fixed') cmd.drive.omega = this.nav.omegaTo(faceHub);
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
      case 'idle':
        break;
    }
    cmd.intake = r.intakeOn;
    return cmd;
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
    const enough = n >= Math.min(cap, 10) || (n > 0 && m !== null && m.phase === 'END_GAME');
    if ((countsNow || willCount) && (enough || (countsNow && n > 0 && this.state === 'score'))) {
      this.state = 'score';
      this.target = spot;
      return;
    }
    // Defensor: con su HUB inactivo y el rival activo
    const opp = opponent(r.alliance);
    if (r.spec.id === 'defender' && m && !m.isHubActive(r.alliance) && m.isHubActive(opp) && m.phase !== 'END_GAME') {
      const victims = this.ctx.robots.filter((o) => o.alliance === opp && !o.climbing);
      victims.sort((a, b) => this.ctx.fuel.robotCount(b.index) - this.ctx.fuel.robotCount(a.index));
      if (victims[0]) {
        this.defendTarget = victims[0].index;
        this.state = 'defend';
        return;
      }
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

  /** FUEL más conveniente: cerca, en su lado o en la NEUTRAL ZONE, lejos de las salidas del HUB. */
  private pickBall(): void {
    const f = this.ctx.fuel;
    const r = this.r;
    const p = r.phys.curPos;
    const myZone = zoneOf(p.x);
    const oppZone = r.alliance === 'blue' ? 2 : 0;
    const m = this.ctx.match;
    const endgame = m?.phase === 'END_GAME';
    const allies = this.ctx.robots.filter((o) => o !== r && o.alliance === r.alliance);
    const tall = r.phys.height > F.TRENCH_CLEAR_HEIGHT;
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
      // lejos de las salidas de los HUBS (G408) y de las estructuras
      if (Math.abs(Math.abs(x) - Math.abs(F.HUB_CENTER_X_BLUE)) < 1.0 && Math.abs(z) < 1.0) continue;
      if (Math.abs(Math.abs(x) - Math.abs(F.HUB_CENTER_X_BLUE)) < 0.8) continue;
      if (tall && Math.abs(z) > F.HALF_W - F.TRENCH_CLEAR_WIDTH && Math.abs(Math.abs(x) - Math.abs(F.HUB_CENTER_X_BLUE)) < 0.9) continue;
      if (Math.abs(z) > F.HALF_W - 0.12 || Math.abs(x) > F.HALF_L - 0.12) continue;
      // En END GAME no se acerca a la TOWER rival (G420)
      if (endgame) {
        const tw = F.towerInfo(opponent(r.alliance));
        if (Math.hypot(x - tw.cx, z - tw.cz) < 2.2) continue;
      }
      let c = Math.hypot(x - p.x, z - p.z);
      if (zx !== myZone) c += 2.2;
      for (const a of allies) if (Math.hypot(a.phys.curPos.x - x, a.phys.curPos.z - z) < 1.2) c += 2.5;
      if (c < bestC) {
        bestC = c;
        best = i;
      }
    }
    this.targetBall = best;
  }
}
