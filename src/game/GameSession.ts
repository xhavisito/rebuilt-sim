/**
 * Una sesión de juego (práctica o match): mundo físico, FUEL, robots, controladores,
 * cámaras y (en fases siguientes) reloj, árbitro, IA y HUMAN PLAYERS.
 */
import * as THREE from 'three';
import * as F from '../config/field';
import type { RobotSpec } from '../config/robots';
import type { Settings } from '../config/settings';
import { Rng } from '../core/rng';
import { defaultStart } from '../core/startRules';
import type { Alliance, EventType, StationNumber } from '../core/types';
import type { PlayerInput } from '../input/actions';
import { buildFieldColliders } from '../physics/FieldColliders';
import { FuelSystem } from '../physics/FuelSystem';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { CameraRig, CAMERA_MODES } from '../render/CameraRig';
import type { FieldView } from '../render/FieldView';
import { FuelView } from '../render/FuelView';
import type { Renderer, Viewport } from '../render/Renderer';
import { idleCommand, Robot, type ControlKind, type RobotCommand } from './Robot';

export type SessionMode = 'practice' | 'match' | 'local' | 'tournament';

export interface RobotSlotConfig {
  spec: RobotSpec;
  alliance: Alliance;
  station: StationNumber;
  control: ControlKind;
  /** Desplazamiento lateral de la posición inicial (m). */
  startOffsetZ?: number;
}

export interface SessionConfig {
  mode: SessionMode;
  robots: RobotSlotConfig[];
  fuelTotal: number;
  eventType: EventType;
  fouls: boolean;
  seed: number;
  /** Cámara compartida en multijugador. */
  sharedCamera?: boolean;
}

export class GameSession {
  readonly pw: PhysicsWorld;
  readonly fuel: FuelSystem;
  readonly fuelView: FuelView;
  readonly robots: Robot[] = [];
  readonly rigs: CameraRig[] = [];
  readonly rng: Rng;
  readonly group = new THREE.Group();
  /** Tiempo simulado total (s). */
  simTime = 0;
  paused = false;
  private acc = 0;
  private alpha = 0;
  private stepsLastFrame = 0;

  constructor(
    readonly cfg: SessionConfig,
    private renderer: Renderer,
    readonly field: FieldView,
    protected settings: Settings,
  ) {
    this.rng = new Rng(cfg.seed);
    this.pw = new PhysicsWorld(renderer.preset.physicsHz);
    buildFieldColliders(this.pw);
    // Robots
    cfg.robots.forEach((rc, i) => {
      const halfX = F.inch(rc.spec.lengthIn / 2 + rc.spec.bumperIn);
      const st = defaultStart(rc.alliance, rc.station, halfX);
      const halfZ = F.inch(rc.spec.widthIn / 2 + rc.spec.bumperIn);
      const z = THREE.MathUtils.clamp(st.z + (rc.startOffsetZ ?? 0), -F.HALF_W + halfZ + 0.02, F.HALF_W - halfZ - 0.02);
      const r = new Robot(this.pw, i, rc.spec, rc.alliance, rc.station, rc.control, st.x, z, st.heading);
      r.fieldRelative = settings.drive.fieldRelative;
      this.robots.push(r);
      this.group.add(r.view.group);
    });
    // FUEL
    this.fuel = new FuelSystem(this.pw, cfg.fuelTotal, this.rng);
    this.fuel.stage(this.robots.map((r) => r.spec.preload));
    this.fuelView = new FuelView(this.fuel, renderer.preset.fuelDetail);
    this.fuelView.setShadows(renderer.preset.fuelShadows);
    this.group.add(this.fuelView.mesh);
    for (const a of ['red', 'blue'] as Alliance[])
      field.setTeamNumbers(
        a,
        [1, 2, 3].map((ds) => this.robots.find((r) => r.alliance === a && r.station === ds)?.spec.teamNumber ?? 0),
      );
    // Cámaras: una por jugador (o una compartida)
    const players = this.players();
    const n = cfg.sharedCamera ? 1 : Math.max(1, players.length);
    for (let k = 0; k < n; k++) {
      const rig = new CameraRig(k === 0 ? renderer.renderer.domElement : null);
      const pr = players[k] ?? this.robots[0];
      if (pr) {
        rig.alliance = pr.alliance;
        rig.station = pr.station;
      }
      rig.shakeEnabled = settings.cameraShake;
      rig.setMode(cfg.sharedCamera ? 'broadcast' : n > 1 ? 'chase' : settings.camera);
      this.rigs.push(rig);
    }
    renderer.scene.add(this.group);
    // En práctica ambos HUBS están activos (Fase 2 los controla el reloj del match)
    for (const a of ['red', 'blue'] as Alliance[]) field.setHubLight(a, 'active', 0);
  }

  players(): Robot[] {
    return this.robots
      .filter((r) => r.control.type === 'player')
      .sort((a, b) => (a.control as { slot: number }).slot - (b.control as { slot: number }).slot);
  }

  playerRobot(slot = 0): Robot | undefined {
    return this.robots.find((r) => r.control.type === 'player' && r.control.slot === slot);
  }

  updateSettings(s: Settings): void {
    this.settings = s;
    for (const rig of this.rigs) rig.shakeEnabled = s.cameraShake;
  }

  // ------------------------------------------------------------------ control del jugador
  /** Traduce la entrada del jugador a un mando de robot. */
  private playerCommand(r: Robot, inp: PlayerInput, rig: CameraRig): RobotCommand {
    const cmd = idleCommand();
    const s = r.spec;
    const slow = inp.held.slow ? 0.35 : 1;
    const mx = inp.moveX;
    const my = inp.moveY;
    let rot = inp.rotate;
    const h = r.phys.heading();
    let vx: number;
    let vz: number;
    if (r.fieldRelative && s.drivetrain === 'swerve') {
      // Field-relative: base fija "hacia el campo" desde el piloto, o la de la cámara
      // en vistas laterales; el reset de giroscopio rota esa base.
      let b: { fx: number; fz: number; rx: number; rz: number };
      if (rig.mode === 'broadcast' || rig.mode === 'free' || rig.mode === 'top') b = rig.basis();
      else b = { fx: rig.downfield, fz: 0, rx: 0, rz: rig.downfield };
      const c = Math.cos(r.gyroOffset);
      const sn = Math.sin(r.gyroOffset);
      const fx = b.fx * c + b.fz * sn;
      const fz = -b.fx * sn + b.fz * c;
      const rx = -fz;
      const rz = fx;
      vx = (my * fx + mx * rx) * s.maxSpeed * slow;
      vz = (my * fz + mx * rz) * s.maxSpeed * slow;
    } else {
      // Robot-relative (y tank): adelante = frente del robot
      const fx = Math.cos(h);
      const fz = -Math.sin(h);
      // Tank: el eje X del stick izquierdo no traslada; si no hay giro, gira (arcade)
      const lat = s.drivetrain === 'tank' ? 0 : mx;
      if (s.drivetrain === 'tank' && Math.abs(rot) < 0.05) rot = mx;
      vx = (my * fx + lat * Math.sin(h)) * s.maxSpeed * slow;
      vz = (my * fz + lat * Math.cos(h)) * s.maxSpeed * slow;
    }
    cmd.drive = { vx, vz, omega: -rot * s.maxOmega * (inp.held.slow ? 0.4 : 1) };
    cmd.intake = r.intakeOn;
    cmd.shoot = inp.held.shoot;
    cmd.pass = inp.held.pass;
    cmd.climbUp = inp.held.climbUp;
    cmd.climbDown = inp.held.climbDown;
    // Apuntar con el mouse: el robot (o la turret) mira al cursor
    if (inp.mouseNdc) {
      const p = this.groundPoint(inp.mouseNdc, rig.camera);
      if (p) {
        cmd.aim = { x: p.x, z: p.z };
        if (s.shooter.type === 'fixed' && Math.abs(inp.rotate) < 0.05) {
          const want = Math.atan2(-(p.z - r.phys.curPos.z), p.x - r.phys.curPos.x);
          let d = want - h;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          cmd.drive.omega = THREE.MathUtils.clamp(d * 6, -s.maxOmega, s.maxOmega);
        }
      }
    }
    return cmd;
  }

  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  groundPoint(ndc: { x: number; y: number }, cam: THREE.Camera): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.plane, out);
  }

  /** Acciones de flanco (una vez por frame, no por paso). */
  private handlePressed(inputs: PlayerInput[]): void {
    inputs.forEach((inp, slot) => {
      const r = this.playerRobot(slot);
      const rig = this.rigs[Math.min(slot, this.rigs.length - 1)];
      if (inp.pressed.has('cameraNext') && rig && (this.rigs.length === 1 ? slot === 0 : true)) {
        const i = CAMERA_MODES.indexOf(rig.mode);
        let next = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
        if (next === 'free' && this.cfg.mode !== 'practice') next = CAMERA_MODES[0];
        rig.setMode(next);
        this.onCameraChange?.(next);
      }
      if (!r) return;
      if (inp.pressed.has('intake')) r.intakeOn = !r.intakeOn;
      if (inp.pressed.has('resetGyro')) {
        // El rumbo actual pasa a ser "hacia el campo" (lejos del piloto)
        const base = rig.downfield > 0 ? 0 : Math.PI;
        r.gyroOffset = r.phys.heading() - base;
        this.onToast?.('gyroReset');
      }
      if (inp.pressed.has('toggleFieldRelative')) {
        r.fieldRelative = !r.fieldRelative;
        this.onToast?.(r.fieldRelative ? 'fieldRel' : 'robotRel');
      }
    });
  }

  onCameraChange?: (mode: string) => void;
  onToast?: (key: 'gyroReset' | 'fieldRel' | 'robotRel') => void;

  // ------------------------------------------------------------------ bucle
  update(frameDt: number, inputs: PlayerInput[]): void {
    this.handlePressed(inputs);
    if (this.paused) return;
    const dt = this.pw.dt;
    this.acc += Math.min(frameDt, 0.1);
    let steps = 0;
    while (this.acc >= dt && steps < 8) {
      this.step(dt, inputs);
      this.acc -= dt;
      steps++;
    }
    if (steps === 8) this.acc = 0; // evita la espiral de la muerte en equipos lentos
    this.stepsLastFrame = steps;
    this.alpha = this.acc / dt;
  }

  private step(dt: number, inputs: PlayerInput[]): void {
    for (const r of this.robots) {
      r.enabled = true;
      if (r.control.type === 'player') {
        const slot = r.control.slot;
        const rig = this.rigs[Math.min(slot, this.rigs.length - 1)];
        r.cmd = inputs[slot] ? this.playerCommand(r, inputs[slot], rig) : idleCommand();
      } else r.cmd = idleCommand();
      r.phys.drive(r.cmd.drive, dt);
    }
    this.fuel.prePhysics(dt);
    this.pw.step();
    this.pw.events.drainCollisionEvents(() => {});
    this.pw.events.drainContactForceEvents(() => {});
    this.fuel.postPhysics(dt);
    for (const r of this.robots) {
      r.phys.snapshot();
      r.animate(dt);
    }
    this.simTime += dt;
  }

  /** Prepara la escena para dibujar (interpolación) y devuelve los viewports. */
  frame(frameDt: number): Viewport[] {
    for (const r of this.robots) r.syncView(this.alpha, this.simTime, this.fuel.robotCount(r.index));
    this.fuelView.update(this.alpha);
    const players = this.players();
    const views: Viewport[] = [];
    const n = this.rigs.length;
    this.rigs.forEach((rig, k) => {
      const r = players[k] ?? players[0] ?? this.robots[0];
      const t = r
        ? {
            x: r.view.group.position.x,
            y: r.view.group.position.y,
            z: r.view.group.position.z,
            vx: r.phys.velocity().x,
            vz: r.phys.velocity().z,
          }
        : null;
      rig.update(frameDt, t);
      // Layout de pantalla dividida: 2 = lado a lado; 3–4 = cuadrícula 2×2
      if (n === 1) views.push({ camera: rig.camera, x: 0, y: 0, w: 1, h: 1 });
      else if (n === 2) views.push({ camera: rig.camera, x: k * 0.5, y: 0, w: 0.5, h: 1 });
      else views.push({ camera: rig.camera, x: (k % 2) * 0.5, y: k < 2 ? 0.5 : 0, w: 0.5, h: 0.5 });
    });
    return views;
  }

  get physicsSteps(): number {
    return this.stepsLastFrame;
  }

  /** Reinicia FUEL y robots (práctica). */
  resetField(): void {
    this.robots.forEach((r, i) => {
      const rc = this.cfg.robots[i];
      const halfX = F.inch(rc.spec.lengthIn / 2 + rc.spec.bumperIn);
      const st = defaultStart(rc.alliance, rc.station, halfX);
      r.phys.setKinematic(false);
      r.phys.teleport(st.x, st.z + (rc.startOffsetZ ?? 0), st.heading);
      r.intakeOn = false;
      r.climbHeight = 0;
    });
    this.fuel.stage(this.robots.map((r) => r.spec.preload));
  }

  dispose(): void {
    this.renderer.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
    this.pw.free();
  }
}
