/**
 * Ejecuta una rutina de AUTO sin mandos del piloto: dispara la precarga (con turret, mientras ya
 * avanza), recorre los waypoints (insertando cruces de BUMP/TRENCH) y aplica sus acciones al
 * llegar. A prueba de choques:
 * - Cada waypoint tiene un vigilante: si en ~2 s no se acerca (lo estorba un compañero, un rival
 *   o quedó trabado), hace su acción donde está (tirar, si está en su ALLIANCE ZONE) o lo salta.
 * - Al terminar la rutina (o si se queda sin ella) sigue jugando: junta FUEL de su lado y lo
 *   tira, sin cruzar la CENTER LINE (G403) y sin meterse en las zonas de las rutinas de sus
 *   compañeros.
 */
import { hubFuelNear } from '../ai/fuelSense';
import { Navigator } from '../ai/Navigator';
import * as F from '../config/field';
import { FLAG_FROM_HUB, FuelState, type FuelSystem } from '../physics/FuelSystem';
import { chassisYawFor } from '../game/Mechanisms';
import { idleCommand, type Robot, type RobotCommand } from '../game/Robot';
import { pointZone, toAlliance, type AutoRoutine, type AutoWaypoint, type AutoZone } from './AutoRoutine';

type Stage = { kind: 'preload'; t: number } | { kind: 'goto'; i: number } | { kind: 'act'; i: number; t: number } | { kind: 'free' } | { kind: 'done' };

export class AutoExecutor {
  readonly nav: Navigator;
  stage: Stage;
  private intake = false;
  /** Vigilante del waypoint actual: mejor distancia y segundos sin acercarse. */
  private watch = { best: Infinity, t: 0, total: 0 };
  private ball = -1;
  private ballAge = 0;
  /** Waypoints con z reflejada (la rutina se adapta al lado por el que salió el robot). */
  private readonly wps: AutoWaypoint[];

  constructor(
    private r: Robot,
    readonly routine: AutoRoutine,
    /** Zonas de las rutinas de sus compañeros (marco azul): ahí no recoge al terminar. */
    private avoidZones: AutoZone[] = [],
  ) {
    this.nav = new Navigator(r);
    // Rutinas "de cualquier lado": si sale del lado contrario al de su primer waypoint de la
    // NEUTRAL ZONE, se reflejan en z (así no cruza por enfrente de sus compañeros)
    const zb = r.alliance === 'blue' ? r.phys.curPos.z : -r.phys.curPos.z;
    const first = routine.waypoints.find((w) => Math.abs(w.z) > 0.3);
    const flip = !!routine.mirrorToStart && !!first && Math.sign(first.z) !== Math.sign(zb) && Math.abs(zb) > 0.3;
    this.wps = flip ? routine.waypoints.map((w) => ({ ...w, z: -w.z, heading: w.heading === null ? null : -w.heading })) : routine.waypoints;
    const turretShootsMoving = routine.shootPreload && r.spec.shooter.type === 'turret' && routine.waypoints.length > 0;
    this.stage = routine.shootPreload && !turretShootsMoving ? { kind: 'preload', t: 0 } : this.wps.length ? { kind: 'goto', i: 0 } : { kind: 'free' };
  }

  get done(): boolean {
    return this.stage.kind === 'done' || this.stage.kind === 'free';
  }

  /** ¿Dentro de su ALLIANCE ZONE (donde puede tirar, G407)? */
  private inZone(): boolean {
    const r = this.r;
    const p = r.phys.curPos;
    return r.alliance === 'blue' ? p.x - r.phys.outerL < F.STARTING_LINE_X_BLUE - 0.15 : p.x + r.phys.outerL > -F.STARTING_LINE_X_BLUE + 0.15;
  }

  /**
   * Mando de este paso. `others` para evitar choques; `autoLeft` = segundos de AUTO que quedan.
   */
  update(dt: number, fuel: FuelSystem, others: Robot[], autoLeft = 20): RobotCommand {
    const r = this.r;
    const cmd = idleCommand();
    const st = this.stage;
    const n = fuel.robotCount(r.index);
    const shootAssist = () => {
      cmd.shoot = true;
      // shooter fijo: girar hacia la solución (sin zona muerta: el tiro necesita ~2°)
      if (r.spec.shooter.type === 'fixed') {
        const hub = F.hubCenter(r.alliance);
        const want = chassisYawFor(r, r.lastSolution?.yaw ?? Math.atan2(-(hub.z - r.phys.curPos.z), hub.x - r.phys.curPos.x));
        cmd.drive.omega = this.nav.omegaTo(want, 0.03);
      }
    };
    switch (st.kind) {
      case 'preload':
        st.t += dt;
        shootAssist();
        if (n === 0 || st.t > 4) this.next();
        break;
      case 'goto': {
        const w = this.wps[st.i];
        const p = toAlliance(r.alliance, w.x, w.z, w.heading);
        this.nav.plan({ x: p.x, z: p.z });
        // Tirar no necesita precisión: llega con más tolerancia; trepar, menos estricto también
        const tol = w.climb ? 0.5 : w.shoot ? 0.45 : 0.25;
        const res = this.nav.follow(dt, others, { speed: 0.9, heading: p.h, tol });
        cmd.drive = res.cmd;
        // Turret: tira la precarga (y lo que junte) mientras avanza, si está en su zona
        if (r.spec.shooter.type === 'turret' && n > 0 && this.inZone()) cmd.shoot = true;
        const cur = r.phys.curPos;
        const dist = Math.hypot(p.x - cur.x, p.z - cur.z);
        if (res.arrived) {
          this.stage = { kind: 'act', i: st.i, t: 0 };
          break;
        }
        // Vigilante: sin acercarse ~2 s (o demasiado tiempo en este waypoint) → actúa aquí o lo salta
        this.watch.total += dt;
        if (dist < this.watch.best - 0.1) {
          this.watch.best = dist;
          this.watch.t = 0;
        } else this.watch.t += dt;
        const budget = 3 + Math.hypot(p.x - cur.x, p.z - cur.z) / Math.max(1, r.spec.maxSpeed * 0.4);
        if ((this.watch.t > 2.0 || this.watch.total > budget + 4) && !w.climb) {
          if (w.shoot || w.intake !== undefined || w.wait) this.stage = { kind: 'act', i: st.i, t: 0 };
          else this.next();
        }
        break;
      }
      case 'act': {
        const w = this.wps[st.i];
        st.t += dt;
        if (w.intake !== undefined) this.intake = w.intake;
        if (w.shoot && n > 0 && st.t < 4 && this.inZone()) {
          shootAssist();
          break;
        }
        if (w.wait && st.t < w.wait) break;
        if (w.climb && r.spec.climb.maxLevel > 0) {
          // sube hasta LEVEL 1 (lo único que cuenta en AUTO) y se queda
          if (!r.climbing || r.climb.level() < 1) cmd.climbUp = true;
          break;
        }
        this.next();
        break;
      }
      case 'free':
        this.freePlay(dt, fuel, others, autoLeft, cmd, shootAssist);
        break;
      case 'done':
        break;
    }
    // G403: pared virtual en la CENTER LINE. El centro del robot no pasa de su lado (con 0.5 s
    // de anticipación): ni a toda velocidad, ni al desatorarse, ni empujado se cruza completo.
    const own = r.alliance === 'blue' ? -1 : 1;
    const xa = r.phys.curPos.x * own; // > 0 = de su lado
    const va = cmd.drive.vx * own;
    if (xa + va * 0.5 < 0.15) cmd.drive.vx = (Math.min(1.5, (0.15 - xa) / 0.5) * own) as number;
    // G408: no agarrar FUEL recién salido del HUB (la intake se apaga mientras pasa)
    const on = this.intake && !hubFuelNear(fuel, r);
    cmd.intake = on;
    r.intakeOn = on;
    return cmd;
  }

  /**
   * Juego libre al terminar la rutina: con FUEL y en su zona tira; si junta suficiente (o se
   * acaba el AUTO) va a tirar; si no, recoge el FUEL más cercano de su lado (lejos de la CENTER
   * LINE, de las salidas del HUB y de las zonas de sus compañeros).
   */
  private freePlay(dt: number, fuel: FuelSystem, others: Robot[], autoLeft: number, cmd: RobotCommand, shootAssist: () => void): void {
    const r = this.r;
    const p = r.phys.curPos;
    const n = fuel.robotCount(r.index);
    const blue = r.alliance === 'blue';
    if (r.climbing) return;
    if (n > 0 && this.inZone()) {
      // tira en su zona (con turret, sigue recogiendo mientras)
      shootAssist();
      if (r.spec.shooter.type !== 'turret') return;
    }
    this.ballAge += dt;
    if (this.ball >= 0 && fuel.state[this.ball] !== FuelState.Field) this.ball = -1;
    if (this.ball < 0 || this.ballAge > 1.5) this.pickBall(fuel, others);
    const goShoot = n > 0 && (n >= Math.min(8, r.spec.hopperCapacity) || autoLeft < 4 || this.ball < 0);
    if (goShoot && !this.inZone()) {
      const spot = toAlliance(r.alliance, F.STARTING_LINE_X_BLUE - 1.4, Math.max(-2.6, Math.min(2.6, blue ? p.z : -p.z)), null);
      this.nav.plan({ x: spot.x, z: spot.z });
      cmd.drive = this.nav.follow(dt, others, { speed: 0.9, heading: null, tol: 0.4 }).cmd;
      this.intake = n < r.spec.hopperCapacity;
      return;
    }
    if (this.ball >= 0) {
      const o = this.ball * 3;
      const bx = fuel.pos[o];
      const bz = fuel.pos[o + 2];
      const dx = bx - p.x;
      const dz = bz - p.z;
      const dd = Math.hypot(dx, dz) || 1;
      this.nav.plan({ x: bx + (dx / dd) * 0.25, z: bz + (dz / dd) * 0.25 });
      const res = this.nav.follow(dt, others, { speed: dd < 1.6 ? 0.75 : 0.9, heading: null, tol: 0.1 });
      if (!cmd.shoot || r.spec.shooter.type === 'turret') cmd.drive = { ...res.cmd, omega: cmd.drive.omega || res.cmd.omega };
      if (res.arrived) this.ball = -1;
      this.intake = true;
    }
  }

  /** FUEL más cercano que puede recoger en AUTO sin cruzar la CENTER LINE ni estorbar. */
  private pickBall(fuel: FuelSystem, robots: Robot[]): void {
    this.ballAge = 0;
    const r = this.r;
    const p = r.phys.curPos;
    const own = r.alliance === 'blue' ? -1 : 1;
    const h0 = r.phys.heading();
    const mates = robots.filter((o) => o !== r && o.alliance === r.alliance);
    let best = -1;
    let bestC = Infinity;
    for (let i = 0; i < fuel.count; i++) {
      if (fuel.state[i] !== FuelState.Field || fuel.flags[i] & FLAG_FROM_HUB) continue;
      const o = i * 3;
      const x = fuel.pos[o];
      const y = fuel.pos[o + 1];
      const z = fuel.pos[o + 2];
      if (y > 0.2) continue;
      // de su lado, con el robot entero antes de la CENTER LINE (G403)
      if (x * own < r.phys.outerL + 0.15) continue;
      // salidas del HUB, paredes y TOWERS
      if (Math.abs(Math.abs(x) - Math.abs(F.HUB_CENTER_X_BLUE)) < 0.9) continue;
      if (Math.abs(z) > F.HALF_W - 0.2 || Math.abs(x) > F.HALF_L - 0.35) continue;
      const tw = F.towerInfo(r.alliance);
      if (Math.hypot(x - tw.uprightX, z - tw.cz) < 1.3) continue;
      // zonas de las rutinas de sus compañeros (marco azul)
      if (this.avoidZones.length && this.avoidZones.includes(pointZone(own === -1 ? x : -x, own === -1 ? z : -z))) continue;
      const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(-(z - p.z), x - p.x) - h0), Math.cos(Math.atan2(-(z - p.z), x - p.x) - h0)));
      let c = Math.hypot(x - p.x, z - p.z) + turn * 0.4;
      if (i === this.ball) c -= 0.6;
      // más cerca de un compañero que de él: que lo tome el compañero
      const mine = Math.hypot(x - p.x, z - p.z);
      if (mates.some((m) => Math.hypot(m.phys.curPos.x - x, m.phys.curPos.z - z) < mine - 0.4)) c += 2;
      if (c < bestC) {
        bestC = c;
        best = i;
      }
    }
    this.ball = best;
  }

  private next(): void {
    const st = this.stage;
    const n = this.wps.length;
    if (st.kind === 'preload') this.stage = n ? { kind: 'goto', i: 0 } : { kind: 'free' };
    else if (st.kind === 'act' || st.kind === 'goto') this.stage = st.i + 1 < n ? { kind: 'goto', i: st.i + 1 } : { kind: 'free' };
    this.watch = { best: Infinity, t: 0, total: 0 };
    this.nav.clear();
  }
}

