/**
 * Robot de juego = especificación + cuerpo físico + vista + estado de mecanismos.
 * El control (jugador, IA o rutina de AUTO) produce un `RobotCommand` cada paso.
 */
import type { RobotSpec } from '../config/robots';
import type { Alliance, StationNumber } from '../core/types';
import type { ShotSolution } from '../physics/ballistics';
import { ClimbState } from './Climber';
import { RobotPhysics, type DriveCommand } from '../physics/RobotPhysics';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { RobotView } from '../render/RobotView';

/** Mando de alto nivel para un paso de simulación. */
export interface RobotCommand {
  drive: DriveCommand;
  intake: boolean;
  shoot: boolean;
  pass: boolean;
  climbUp: boolean;
  climbDown: boolean;
  /** Punto objetivo para apuntar (auto-aim / mouse). null = hacia el frente. */
  aim: { x: number; z: number; y?: number } | null;
}

export const idleCommand = (): RobotCommand => ({
  drive: { vx: 0, vz: 0, omega: 0 },
  intake: false,
  shoot: false,
  pass: false,
  climbUp: false,
  climbDown: false,
  aim: null,
});

export type ControlKind = { type: 'player'; slot: number } | { type: 'ai' } | { type: 'none' };

export class Robot {
  readonly phys: RobotPhysics;
  readonly view: RobotView;
  cmd: RobotCommand = idleCommand();
  /** Field-relative (true) o robot-relative. */
  fieldRelative = true;
  /** Desfase del giroscopio (rad) — "reset gyro" lo fija al rumbo actual. */
  gyroOffset = 0;
  enabled = false;
  disabled = false; // DISABLED por el árbitro o tarjeta roja
  // ---- Estado de mecanismos (se completa en la Fase 3/4)
  intakeOn = false;
  intakeDeploy = 0;
  turretYaw = 0;
  hoodAngle = Math.PI / 3;
  climbHeight = 0;
  /** Climber desplegado (0–1, cosmético para el CAD articulado). */
  climbDeploy = 0;
  wheelYaw = 0;
  wheelSpin = 0;
  intakeSpin = 0;
  flywheelSpin = 0;
  intakeAcc = 0;
  spinUp = 0;
  shootCooldown = 0;
  /** FUEL de la ráfaga en curso que aún no sale (s que faltan, posición lateral en el shooter). */
  burst: Array<{ delay: number; lat: number }> = [];
  burstAim: { kind: 'shot' | 'pass' | 'corral'; yawRel: number; pitch: number; speed: number } = { kind: 'shot', yawRel: 0, pitch: 0, speed: 0 };
  lastSolution: ShotSolution | null = null;
  /** Solución para la guía de tiro cuando no está disparando (se recalcula a 10 Hz). */
  previewSolution: ShotSolution | null = null;
  previewTimer = 0;
  solveTimer = 0;
  corralSide = 1;
  lastKind: 'shot' | 'pass' = 'shot';
  lastShotKind: 'shot' | 'pass' | 'corral' = 'shot';
  /** En la TOWER. */
  climbing = false;
  readonly climb = new ClimbState();
  /** Nivel/puntos de TOWER evaluados (para resultados). */
  towerResult = { auto: 0, teleop: 0, level: 0 };
  /**
   * Estadísticas del match (resultados, ranking por categoría del torneo y estadísticas del
   * jugador). `cycles` = ráfagas de tiro al HUB separadas por más de `CYCLE_GAP` s sin tirar.
   */
  stats = { fuelScored: 0, fuelShot: 0, towerPts: 0, fouls: 0, intaked: 0, passes: 0, distance: 0, defenseSec: 0, cycles: 0 };
  /** Último tiro al HUB (s de simulación), para contar los ciclos. */
  lastShotAt = -Infinity;

  constructor(
    pw: PhysicsWorld,
    readonly index: number,
    readonly spec: RobotSpec,
    readonly alliance: Alliance,
    readonly station: StationNumber,
    /** (cambia si un jugador en línea entra a medio match en lugar de la IA) */
    public control: ControlKind,
    x: number,
    z: number,
    heading: number,
  ) {
    this.phys = new RobotPhysics(pw, spec, index, x, z, heading);
    this.view = new RobotView(spec, alliance);
    this.view.fx = true;
    this.view.marker.visible = control.type === 'player';
  }

  get isPlayer(): boolean {
    return this.control.type === 'player';
  }

  /** Sincroniza la vista con la física (interpolada). */
  syncView(alpha: number, time: number, hopper: number): void {
    const p = this.phys;
    const g = this.view.group;
    g.position.set(
      p.prevPos.x + (p.curPos.x - p.prevPos.x) * alpha,
      p.prevPos.y + (p.curPos.y - p.prevPos.y) * alpha,
      p.prevPos.z + (p.curPos.z - p.prevPos.z) * alpha,
    );
    const a = p.prevRot;
    const b = p.curRot;
    // nlerp (suficiente para pasos de 1/120 s)
    const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    const s = dot < 0 ? -1 : 1;
    const x = a.x + (s * b.x - a.x) * alpha;
    const y = a.y + (s * b.y - a.y) * alpha;
    const z = a.z + (s * b.z - a.z) * alpha;
    const w = a.w + (s * b.w - a.w) * alpha;
    const n = Math.hypot(x, y, z, w) || 1;
    g.quaternion.set(x / n, y / n, z / n, w / n);
    this.view.update(
      {
        intakeDeploy: this.intakeDeploy,
        turretYaw: this.turretYaw,
        hoodAngle: this.hoodAngle,
        climbHeight: this.climbHeight,
        climb: this.climbDeploy,
        hopper,
        enabled: this.enabled,
        wheelYaw: this.wheelYaw,
        wheelSpin: this.wheelSpin,
        intakeSpin: this.intakeSpin,
        flywheelSpin: this.flywheelSpin,
      },
      time,
    );
  }

  /** Animaciones cosméticas de ruedas/rodillos según el movimiento. */
  animate(dt: number): void {
    const v = this.phys.velocity();
    const h = this.phys.heading();
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0.05) {
      // ángulo de la velocidad relativo al robot (módulos swerve)
      const lx = v.x * Math.cos(h) - v.z * Math.sin(h);
      const lz = v.x * Math.sin(h) + v.z * Math.cos(h);
      const target = Math.atan2(-lz, lx);
      let d = target - this.wheelYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      // swerve: el módulo puede invertir el sentido en lugar de girar 180°
      if (Math.abs(d) > Math.PI / 2) d -= Math.sign(d) * Math.PI;
      this.wheelYaw += d * Math.min(1, dt * 18);
    }
    this.wheelSpin += (sp / 0.0508) * dt;
    this.intakeSpin += (this.intakeOn ? 40 : 0) * dt;
    const target = this.intakeOn ? 1 : 0;
    this.intakeDeploy += Math.sign(target - this.intakeDeploy) * Math.min(Math.abs(target - this.intakeDeploy), dt * 4);
    const climbT = this.climbing ? 1 : 0;
    this.climbDeploy += Math.sign(climbT - this.climbDeploy) * Math.min(Math.abs(climbT - this.climbDeploy), dt * 2.5);
  }
}
