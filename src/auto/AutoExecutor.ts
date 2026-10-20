/**
 * Ejecuta una rutina de AUTO sin mandos del piloto: dispara la precarga, recorre los
 * waypoints (insertando cruces de BUMP/TRENCH) y aplica sus acciones al llegar.
 */
import { Navigator } from '../ai/Navigator';
import * as F from '../config/field';
import type { FuelSystem } from '../physics/FuelSystem';
import { chassisYawFor } from '../game/Mechanisms';
import { idleCommand, type Robot, type RobotCommand } from '../game/Robot';
import { toAlliance, type AutoRoutine } from './AutoRoutine';

type Stage = { kind: 'preload'; t: number } | { kind: 'goto'; i: number } | { kind: 'act'; i: number; t: number } | { kind: 'done' };

export class AutoExecutor {
  private nav: Navigator;
  private stage: Stage;
  private intake = false;

  constructor(
    private r: Robot,
    readonly routine: AutoRoutine,
  ) {
    this.nav = new Navigator(r);
    this.stage = routine.shootPreload ? { kind: 'preload', t: 0 } : routine.waypoints.length ? { kind: 'goto', i: 0 } : { kind: 'done' };
  }

  get done(): boolean {
    return this.stage.kind === 'done';
  }

  /** Mando de este paso. `others` para evitar choques. */
  update(dt: number, fuel: FuelSystem, others: Robot[]): RobotCommand {
    const r = this.r;
    const cmd = idleCommand();
    const st = this.stage;
    const shootAssist = () => {
      cmd.shoot = true;
      // shooter fijo: girar hacia la solución
      if (r.spec.shooter.type === 'fixed') {
        const hub = F.hubCenter(r.alliance);
        const want = chassisYawFor(r, r.lastSolution?.yaw ?? Math.atan2(-(hub.z - r.phys.curPos.z), hub.x - r.phys.curPos.x));
        cmd.drive.omega = this.nav.omegaTo(want);
      }
    };
    switch (st.kind) {
      case 'preload':
        st.t += dt;
        shootAssist();
        if (fuel.robotCount(r.index) === 0 || st.t > 4) this.next();
        break;
      case 'goto': {
        const w = this.routine.waypoints[st.i];
        const p = toAlliance(r.alliance, w.x, w.z, w.heading);
        this.nav.plan({ x: p.x, z: p.z });
        const res = this.nav.follow(dt, others, { speed: 0.9, heading: p.h, tol: w.climb ? 0.5 : 0.2 });
        cmd.drive = res.cmd;
        if (res.arrived) this.stage = { kind: 'act', i: st.i, t: 0 };
        break;
      }
      case 'act': {
        const w = this.routine.waypoints[st.i];
        st.t += dt;
        if (w.intake !== undefined) this.intake = w.intake;
        if (w.shoot && fuel.robotCount(r.index) > 0 && st.t < 4) {
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
      case 'done':
        break;
    }
    cmd.intake = this.intake;
    r.intakeOn = this.intake;
    return cmd;
  }

  private next(): void {
    const st = this.stage;
    const n = this.routine.waypoints.length;
    if (st.kind === 'preload') this.stage = n ? { kind: 'goto', i: 0 } : { kind: 'done' };
    else if (st.kind === 'act' || st.kind === 'goto') this.stage = st.i + 1 < n ? { kind: 'goto', i: st.i + 1 } : { kind: 'done' };
    this.nav.clear();
  }
}
