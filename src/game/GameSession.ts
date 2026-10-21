/**
 * Una sesión de juego (práctica o match): mundo físico, FUEL, robots, controladores,
 * cámaras, reloj del match y (en fases siguientes) árbitro, IA y HUMAN PLAYERS.
 * No toca el DOM ni el audio: avisa a la App mediante `hooks`.
 */
import * as THREE from 'three';
import * as F from '../config/field';
import type { RobotSpec } from '../config/robots';
import type { Settings } from '../config/settings';
import { formatTimer, robotsEnabled, timerSeconds } from '../core/clock';
import { Match, type MatchEvent } from '../core/match';
import { scoreAutoTower, scoreTeleopTower, type ClimbSnapshot } from '../core/tower';
import { Referee } from '../referee/Referee';
import { RobotAI, type AiContext } from '../ai/RobotAI';
import type { RobotPlan } from '../ai/Strategy';
import { AutoExecutor } from '../auto/AutoExecutor';
import { routineById } from '../auto/AutoRoutine';
import type { Difficulty } from '../config/settings';
import { Rng } from '../core/rng';
import { defaultStart } from '../core/startRules';
import { ALLIANCES, type Alliance, type EventType, type Phase, type StationNumber } from '../core/types';
import type { PlayerInput } from '../input/actions';
import { buildFieldColliders } from '../physics/FieldColliders';
import { FuelSystem } from '../physics/FuelSystem';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { CameraRig, CAMERA_MODES, ROBOT_CAMERAS, type CameraMode } from '../render/CameraRig';
import type { FieldView } from '../render/FieldView';
import { FuelView } from '../render/FuelView';
import type { Renderer, Viewport } from '../render/Renderer';
import { climbSlots, type TowerOccupancy } from './Climber';
import { HumanPlayer, type HpContext } from './HumanPlayer';
import { chassisYawFor, passTarget, plowLoad, predictLaunch, runIntake, runShooter, shoveFuel, type MechContext } from './Mechanisms';
import { AimGuide } from '../render/AimGuide';
import { idleCommand, Robot, type ControlKind, type RobotCommand } from './Robot';

export type SessionMode = 'practice' | 'match' | 'local' | 'tournament';

export interface RobotSlotConfig {
  spec: RobotSpec;
  alliance: Alliance;
  station: StationNumber;
  control: ControlKind;
  /** Desplazamiento lateral de la posición inicial (m). */
  startOffsetZ?: number;
  /** Rutina de AUTO (id). */
  autoRoutine?: string;
  /** Plan de la estrategia de su alianza (IA), ya en el marco real de la alianza. */
  plan?: RobotPlan;
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
  playoff?: boolean;
  /** Quién controla a cada HUMAN PLAYER. */
  humanPlayers?: Partial<Record<Alliance, 'ai' | 'player'>>;
  /** Precisión de la IA (0–1) según dificultad. */
  aiAccuracy?: number;
  aiDifficulty?: Difficulty;
}

/** Notificaciones hacia la App (audio, HUD, efectos). */
export interface SessionHooks {
  matchEvent?(e: MatchEvent): void;
  toast?(key: 'gyroReset' | 'fieldRel' | 'robotRel'): void;
  cameraChange?(mode: string): void;
  /** Un FUEL cruzó el sensor del HUB (counted = dio punto). */
  fuelScored?(hub: Alliance, counted: boolean, x: number, y: number, z: number): void;
  /** Un robot lanzó FUEL (sonido / efectos). */
  launch?(robot: Robot, kind: 'shot' | 'pass' | 'corral', isPlayer: boolean): void;
  /** El HUMAN PLAYER lanzó o abrió la CHUTE. */
  hpAction?(alliance: Alliance, what: 'throw' | 'door'): void;
  /** Golpe fuerte (0–1) con el robot del jugador `slot` involucrado o no (-1). */
  impact?(strength: number, slot: number, x: number, y: number, z: number): void;
}

export class GameSession {
  readonly pw: PhysicsWorld;
  readonly fuel: FuelSystem;
  readonly fuelView: FuelView;
  readonly robots: Robot[] = [];
  readonly rigs: CameraRig[] = [];
  readonly rng: Rng;
  readonly group = new THREE.Group();
  /** null en práctica libre. */
  readonly match: Match | null;
  readonly humanPlayers: Record<Alliance, HumanPlayer>;
  readonly referee: Referee | null;
  readonly towerOcc: Record<Alliance, TowerOccupancy> = {
    red: { front: -1, left: -1, right: -1 },
    blue: { front: -1, left: -1, right: -1 },
  };
  hooks: SessionHooks = {};
  readonly ais = new Map<number, RobotAI>();
  readonly autos = new Map<number, AutoExecutor>();
  /** Tiempo simulado total (s). */
  simTime = 0;
  paused = false;
  /** Escala de tiempo (depuración / pruebas: ?speed=3). */
  timeScale = 1;
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
    this.pw.setIterations(renderer.preset.solverIterations);
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
    this.match = cfg.mode === 'practice' ? null : new Match(cfg.eventType, this.rng, cfg.playoff ?? false);
    this.humanPlayers = {
      red: new HumanPlayer('red', cfg.humanPlayers?.red ?? 'ai'),
      blue: new HumanPlayer('blue', cfg.humanPlayers?.blue ?? 'ai'),
    };
    this.referee = this.match ? new Referee({ robots: this.robots, match: this.match, fuel: this.fuel, pw: this.pw, humanPlayers: this.humanPlayers }) : null;
    if (this.referee) this.referee.enabled = cfg.fouls;
    this.fuel.cb = {
      onHubEnter: (i, hub) => {
        this.referee?.onHubEnter(i, hub);
        this.onHubEnter(i, hub);
      },
      onOut: (i, shot) => this.referee?.onOut(i, shot),
    };
    // FIELD STAFF no deja un FUEL debajo de un robot
    this.fuel.canPlace = (x, z) => this.robots.every((r) => Math.hypot(r.phys.curPos.x - x, r.phys.curPos.z - z) > Math.hypot(r.phys.outerL, r.phys.outerW) + 0.25);
    this.fuelView = new FuelView(this.fuel, renderer.preset.fuelDetail);
    this.fuelView.setShadows(renderer.preset.fuelShadows);
    this.fuelView.hopperPos = (i) => {
      const g = this.robots[i].view.group.position;
      return { x: g.x, y: g.y + this.robots[i].phys.height * 0.55, z: g.z };
    };
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
      // Sin robot propio (espectador): cámara de transmisión
      rig.setMode(cfg.sharedCamera || !players.length ? 'broadcast' : n > 1 ? 'third' : settings.camera);
      this.rigs.push(rig);
    }
    renderer.scene.add(this.group);
    field.setLeds(false);
    // IA para los robots de la computadora
    const aiCtx: AiContext = {
      robots: this.robots,
      fuel: this.fuel,
      match: this.match,
      rng: this.rng,
      towerOcc: this.towerOcc,
      pinSeconds: (i) => this.referee?.activePins().find((p) => p.pinner === i)?.seconds ?? 0,
      claims: new Map(),
    };
    for (const r of this.robots) if (r.control.type === 'ai') this.ais.set(r.index, new RobotAI(r, aiCtx, cfg.aiDifficulty ?? 'normal'));
    // Una alianza de solo IA (fuera de Fácil) pone a defender, en sus SHIFTS inactivos, al robot
    // con el hopper más chico: con el HUB propio apagado, estorbar al rival vale más que anotar.
    if ((cfg.aiDifficulty ?? 'normal') !== 'easy')
      for (const a of ALLIANCES) {
        const mine = this.robots.filter((r) => r.alliance === a);
        if (mine.length < 3 || mine.some((r) => !this.ais.has(r.index))) continue;
        const d = mine.reduce((x, y) => (y.spec.hopperCapacity < x.spec.hopperCapacity ? y : x));
        this.ais.get(d.index)!.defender = true;
      }
    // Estrategia de alianza: el plan de cada DRIVER STATION manda sobre lo automático
    cfg.robots.forEach((rc, i) => {
      if (rc.plan) this.ais.get(i)?.setPlan(rc.plan);
    });
  }

  /** Fase actual del match ('AUTO'… o null en práctica). */
  get phase(): Phase | null {
    return this.match?.phase ?? null;
  }

  /** Arranca el reloj del match (después de la cuenta regresiva de la App). */
  beginMatch(): void {
    if (this.match && !this.match.running) {
      // Rutinas de AUTO: la elegida para el jugador; la IA según su posición y diseño
      this.robots.forEach((r, i) => {
        const rc = this.cfg.robots[i];
        let id = rc.autoRoutine;
        if (!id) id = r.spec.climb.maxLevel > 0 && r.station === 3 ? 'climb-l1' : r.station === 1 ? 'depot' : 'default-score';
        if (r.control.type !== 'none') this.autos.set(i, new AutoExecutor(r, routineById(id)));
      });
      this.match.start();
      this.field.setLeds(true);
    }
  }

  private onHubEnter(i: number, hub: Alliance): void {
    const o = i * 3;
    let counted = true;
    if (this.match) counted = this.match.fuelEntered(hub).counted;
    const shooter = this.fuel.shotBy[i];
    if (counted && shooter >= 0 && this.robots[shooter]?.alliance === hub) this.robots[shooter].stats.fuelScored++;
    this.hooks.fuelScored?.(hub, counted, this.fuel.pos[o], this.fuel.pos[o + 1], this.fuel.pos[o + 2]);
  }

  /** Estado de un robot para los criterios de LEVEL (§6.5.2). */
  private climbSnapshot(r: Robot): ClimbSnapshot {
    const y = r.phys.curPos.y;
    const hanging = r.climbing && r.climb.attached;
    return {
      robot: r.index,
      alliance: r.alliance,
      touchingFloorOrBase: !(hanging && y > 0.03),
      bumperBottom: y + F.BUMPER_ZONE_LOW,
      touchingOwnRungOrUpright: hanging,
      touchingIllegal: false,
      ineligible: this.referee?.g414.has(r.index) ?? false,
      g420Level3: this.referee?.g420Level3.has(r.index) ?? false,
    };
  }

  /** Evalúa la TOWER: AUTO al llegar a 0:00; TELEOP 3 s tras 0:00 o al quedar todos en reposo. */
  evaluateTower(which: 'auto' | 'teleop'): void {
    const m = this.match;
    if (!m) return;
    if (which === 'teleop') {
      if (m.teleopTowerDone) return;
      this.referee?.evaluateG414();
    }
    const snaps = this.robots.map((r) => this.climbSnapshot(r));
    const res = which === 'auto' ? scoreAutoTower(snaps) : scoreTeleopTower(snaps);
    if (which === 'auto') m.setAutoTower(res);
    else m.setTeleopTower(res);
    for (const r of this.robots) {
      const pr = res.perRobot.get(r.index);
      if (!pr) continue;
      r.towerResult[which] = pr.points;
      if (which === 'teleop') r.towerResult.level = pr.level;
      r.stats.towerPts += pr.points;
    }
  }

  /** Climb: engancharse al puesto libre más cercano de la TOWER propia y subir/bajar. */
  private runClimb(r: Robot, dt: number): void {
    if (r.spec.climb.maxLevel === 0) return;
    if (!r.climbing && r.cmd.climbUp) {
      const occ = this.towerOcc[r.alliance];
      const p = r.phys.curPos;
      let best: ReturnType<typeof climbSlots>[number] | null = null;
      let bestD = 1.3;
      for (const sl of climbSlots(r.alliance, r.phys.outerL, r.phys.outerW)) {
        if (occ[sl.id] !== -1 && occ[sl.id] !== r.index) continue;
        const d = Math.hypot(sl.x - p.x, sl.z - p.z);
        if (d < bestD) {
          best = sl;
          bestD = d;
        }
      }
      if (best) r.climb.begin(r, best, occ);
    }
    if (r.climbing) r.climb.update(r, dt, r.cmd.climbUp, r.cmd.climbDown, 3);
  }

  /** Los HUMAN PLAYERS pueden meter FUEL en AUTO (excepción de G402) y en TELEOP. */
  private hpCanAct(): boolean {
    const p = this.match?.phase;
    return !this.match || p === 'AUTO' || (p !== undefined && p !== 'PRE' && p !== 'AUTO_PAUSE' && p !== 'POST' && p !== 'DONE');
  }

  private mechContext(r: Robot): MechContext {
    const isPlayer = r.control.type === 'player';
    return {
      fuel: this.fuel,
      rng: this.rng,
      time: this.match?.t ?? this.simTime,
      autoAim: isPlayer ? this.settings.drive.autoAim : true,
      shootOnMove: isPlayer ? this.settings.drive.shootOnMove : true,
      // Con auto-aim, el jugador también espera a estar alineado (un dumper de 20+ FUEL/s vaciaría
      // el hopper mientras el chasis todavía gira hacia el HUB)
      requireAlign: !isPlayer || this.match?.phase === 'AUTO' || this.settings.drive.autoAim,
      onLaunch: (rb, i, kind) => {
        this.referee?.onLaunch(rb, i, kind);
        this.hooks.launch?.(rb, kind, rb.control.type === 'player');
      },
      onIntake: (rb, i) => this.referee?.onIntake(rb, i),
    };
  }

  hpContext(hp: HumanPlayer): HpContext {
    const a = hp.alliance;
    const o = F.outpostInfo(a);
    const exitX = o.x - F.allianceSign(a) * 0.9;
    const near = this.robots.some(
      (r) =>
        r.alliance === a &&
        Math.hypot(r.phys.curPos.x - exitX, r.phys.curPos.z - o.z) < 1.4 &&
        this.fuel.robotCount(r.index) < r.spec.hopperCapacity,
    );
    const m = this.match;
    const hubWillCount = m ? m.isHubActive(a) && !(m.light(a) === 'pulse' && m.phase !== 'END_GAME') : true;
    return {
      fuel: this.fuel,
      rng: this.rng,
      time: m?.t ?? this.simTime,
      hubWillCount,
      robotNearChute: near,
      accuracy: hp.control === 'player' ? 0.85 : (this.cfg.aiAccuracy ?? 0.8),
    };
  }

  /** Reacciona a eventos del reloj del match. */
  private onMatchEvent(e: MatchEvent): void {
    if (e.type === 'phase' && (e.phase === 'POST' || e.phase === 'DONE')) this.field.setLeds(false);
    if (e.type === 'evalAutoTower') this.evaluateTower('auto');
    if (e.type === 'evalTeleopTower') this.evaluateTower('teleop');
    this.hooks.matchEvent?.(e);
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
      // En las cámaras que giran con el robot el manejo es relativo a la cámara (sin giroscopio).
      const camRel = ROBOT_CAMERAS.has(rig.mode);
      if (camRel || rig.mode === 'broadcast' || rig.mode === 'free' || rig.mode === 'top') b = rig.basis();
      else b = { fx: rig.downfield, fz: 0, rx: 0, rz: rig.downfield };
      const gyro = camRel ? 0 : r.gyroOffset;
      const c = Math.cos(gyro);
      const sn = Math.sin(gyro);
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
    // Auto-aim con shooter fijo: el robot gira solo hacia la solución mientras disparas o pasas
    if ((inp.held.shoot || inp.held.pass) && this.settings.drive.autoAim && s.shooter.type === 'fixed' && Math.abs(rot) < 0.05 && !inp.mouseNdc) {
      const goal = inp.held.pass ? passTarget(r.alliance, r.phys.curPos.z) : F.hubCenter(r.alliance);
      const want = chassisYawFor(r, r.lastSolution?.yaw ?? Math.atan2(-(goal.z - r.phys.curPos.z), goal.x - r.phys.curPos.x));
      const d = Math.atan2(Math.sin(want - h), Math.cos(want - h));
      cmd.drive.omega = THREE.MathUtils.clamp(d * 7, -s.maxOmega, s.maxOmega);
    }
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
          const want = chassisYawFor(r, Math.atan2(-(p.z - r.phys.curPos.z), p.x - r.phys.curPos.x));
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

  /** Siguiente cámara para el jugador `slot` (la libre solo en práctica). */
  cycleCamera(slot = 0): void {
    const rig = this.rigs[Math.min(slot, this.rigs.length - 1)];
    if (!rig) return;
    const i = CAMERA_MODES.indexOf(rig.mode);
    let next = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    if (next === 'free' && this.cfg.mode !== 'practice') next = CAMERA_MODES[0];
    rig.setMode(next);
    this.hooks.cameraChange?.(next);
  }

  /** Elige la cámara del jugador `slot` (menú de pausa). */
  setCamera(mode: CameraMode, slot = 0): void {
    const rig = this.rigs[Math.min(slot, this.rigs.length - 1)];
    if (!rig || rig.mode === mode || (mode === 'free' && this.cfg.mode !== 'practice')) return;
    rig.setMode(mode);
    this.hooks.cameraChange?.(mode);
  }

  /** Acciones de flanco (una vez por frame, no por paso). */
  private handlePressed(inputs: PlayerInput[]): void {
    inputs.forEach((inp, slot) => {
      const r = this.playerRobot(slot);
      const rig = this.rigs[Math.min(slot, this.rigs.length - 1)];
      if (inp.pressed.has('cameraNext') && rig && (this.rigs.length === 1 ? slot === 0 : true)) this.cycleCamera(slot);
      // HUMAN PLAYER controlado por el jugador (su alianza)
      const hpAlliance = r?.alliance ?? this.robots[0]?.alliance;
      const hp = hpAlliance ? this.humanPlayers[hpAlliance] : undefined;
      if (hp && hp.control === 'player' && slot === 0) {
        if (inp.pressed.has('chuteDoor')) {
          hp.toggleDoor();
          this.hooks.hpAction?.(hp.alliance, 'door');
        }
        if (inp.pressed.has('hpThrow') && this.hpCanAct()) {
          const target = inp.mouseNdc ? this.groundPoint(inp.mouseNdc, rig.camera) : null;
          if (hp.throwFuel(this.hpContext(hp), target ? { x: target.x, y: 0.4, z: target.z } : undefined)) this.hooks.hpAction?.(hp.alliance, 'throw');
        }
      }
      if (!r) return;
      if (inp.pressed.has('intake')) r.intakeOn = !r.intakeOn;
      if (inp.pressed.has('resetGyro')) {
        // El rumbo actual pasa a ser "hacia el campo" (lejos del piloto)
        const base = rig.downfield > 0 ? 0 : Math.PI;
        r.gyroOffset = r.phys.heading() - base;
        this.hooks.toast?.('gyroReset');
      }
      if (inp.pressed.has('toggleFieldRelative')) {
        r.fieldRelative = !r.fieldRelative;
        this.hooks.toast?.(r.fieldRelative ? 'fieldRel' : 'robotRel');
      }
    });
  }

  // ------------------------------------------------------------------ bucle
  update(frameDt: number, inputs: PlayerInput[]): void {
    this.handlePressed(inputs);
    if (this.paused) return;
    const dt = this.pw.dt;
    this.acc += Math.min(frameDt, 0.1) * this.timeScale;
    let steps = 0;
    const maxSteps = this.renderer.preset.maxSteps * Math.max(1, Math.ceil(this.timeScale));
    while (this.acc >= dt && steps < maxSteps) {
      this.step(dt, inputs);
      this.acc -= dt;
      steps++;
    }
    if (steps === maxSteps) this.acc = 0; // evita la espiral de la muerte en equipos lentos
    this.stepsLastFrame = steps;
    this.alpha = this.acc / dt;
  }

  private step(dt: number, inputs: PlayerInput[]): void {
    const m = this.match;
    if (m) for (const e of m.tick(dt)) this.onMatchEvent(e);
    const enabled = m ? robotsEnabled(m.phase) : true;
    const auto = m?.phase === 'AUTO';
    for (const r of this.robots) {
      r.enabled = enabled && !r.disabled;
      if (!r.enabled) r.cmd = idleCommand(); // deshabilitado: frena (brake mode)
      else if (auto) r.cmd = this.autos.get(r.index)?.update(dt, this.fuel, this.robots) ?? idleCommand(); // AUTO: sin piloto
      else if (this.ais.has(r.index)) r.cmd = this.ais.get(r.index)!.update(dt);
      else if (r.control.type === 'player') {
        const slot = r.control.slot;
        const rig = this.rigs[Math.min(slot, this.rigs.length - 1)];
        r.cmd = inputs[slot] ? this.playerCommand(r, inputs[slot], rig) : idleCommand();
      } else r.cmd = idleCommand();
      r.phys.setIntakeDeployed(r.intakeOn && r.intakeDeploy > 0.6 && !r.climbing);
      r.phys.setExtended(r.intakeDeploy > 0.5);
      r.phys.plow = plowLoad(r, this.fuel);
      r.phys.drive(r.cmd.drive, dt);
      if (r.enabled) {
        this.runClimb(r, dt);
        const ctx = this.mechContext(r);
        runIntake(r, ctx, dt);
        runShooter(r, ctx, dt);
      } else {
        r.spinUp = Math.max(0, r.spinUp - dt);
        r.burst.length = 0; // los FUEL de la ráfaga siguen en el hopper
      }
    }
    if (this.hpCanAct()) for (const a of ALLIANCES) this.humanPlayers[a].update(dt, this.hpContext(this.humanPlayers[a]));
    this.fuel.returnsEnabled = !m || (m.phase !== 'POST' && m.phase !== 'DONE');
    this.fuel.prePhysics(dt);
    this.pw.step();
    for (const r of this.robots) shoveFuel(r, this.fuel);
    this.pw.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.pw.tagOf(h1);
      const b = this.pw.tagOf(h2);
      // Último robot que tocó cada FUEL (G405)
      const t = this.match?.t ?? this.simTime;
      if (a?.kind === 'robot' && b?.kind === 'fuel') {
        this.fuel.lastTouch[b.index] = a.robot;
        this.fuel.lastTouchTime[b.index] = t;
      } else if (b?.kind === 'robot' && a?.kind === 'fuel') {
        this.fuel.lastTouch[a.index] = b.robot;
        this.fuel.lastTouchTime[a.index] = t;
      }
    });
    this.pw.events.drainContactForceEvents((ev) => this.onContactForce(ev.collider1(), ev.collider2(), ev.maxForceMagnitude()));
    this.fuel.postPhysics(dt);
    this.referee?.step(dt);
    for (const r of this.robots) {
      r.phys.snapshot();
      r.animate(dt);
    }
    // TOWER de TELEOP: también se evalúa en cuanto todos los robots quedan en reposo
    if (m?.phase === 'POST' && !m.teleopTowerDone && this.robots.every((r) => Math.hypot(r.phys.velocity().x, r.phys.velocity().z) < 0.05))
      this.evaluateTower('teleop');
    this.simTime += dt;
  }

  /** Golpes fuertes: sonido, vibración y temblor de cámara. */
  private onContactForce(h1: number, h2: number, force: number): void {
    const a = this.pw.tagOf(h1);
    const b = this.pw.tagOf(h2);
    const ra = a?.kind === 'robot' ? this.robots[a.robot] : undefined;
    const rb = b?.kind === 'robot' ? this.robots[b.robot] : undefined;
    const r = ra ?? rb;
    if (!r || a?.kind === 'fuel' || b?.kind === 'fuel') return;
    if (ra && rb) this.referee?.onRobotForce(ra, rb, force);
    for (const x of [ra, rb]) if (x?.climbing && force > 1500) x.climb.hit(x, Math.min(1, force / 6000), this.rng);
    const strength = Math.min(1, force / 6000);
    if (strength < 0.15) return;
    const slotOf = (x?: Robot) => (x && x.control.type === 'player' ? x.control.slot : -1);
    const slot = Math.max(slotOf(ra), slotOf(rb));
    const p = r.phys.curPos;
    this.hooks.impact?.(strength, slot, p.x, 0.3, p.z);
  }

  /** Prepara la escena para dibujar (interpolación) y devuelve los viewports. */
  frame(frameDt: number): Viewport[] {
    // Luces de los HUBS (Tabla 5-3) y timer de la DRIVER STATION
    const m = this.match;
    for (const a of ALLIANCES) this.field.setHubLight(a, m ? m.light(a) : 'active', this.simTime);
    if (m) this.field.setTimer(formatTimer(m.phase === 'PRE' ? 20 : timerSeconds(m.t)));
    for (const r of this.robots) r.syncView(this.alpha, this.simTime, this.fuel.robotCount(r.index));
    this.fuelView.update(this.alpha);
    this.updateAimGuides(frameDt);
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
            heading: yawOf(r.view.group.quaternion),
            height: r.phys.height,
            halfLength: r.phys.outerL,
          }
        : null;
      rig.update(frameDt, t);
      // A bordo, el robot propio no se dibuja: la cámara quedaría dentro de su hopper y sus
      // paredes de policarbonato taparían la vista (como en un juego en primera persona)
      const hide = rig.mode === 'onboard' && r ? [r.view.group] : undefined;
      // Layout de pantalla dividida: 2 = lado a lado; 3–4 = cuadrícula 2×2
      if (n === 1) views.push({ camera: rig.camera, x: 0, y: 0, w: 1, h: 1, hide });
      else if (n === 2) views.push({ camera: rig.camera, x: k * 0.5, y: 0, w: 0.5, h: 1, hide });
      else views.push({ camera: rig.camera, x: (k % 2) * 0.5, y: k < 2 ? 0.5 : 0, w: 0.5, h: 0.5, hide });
    });
    return views;
  }

  private aimGuides = new Map<number, AimGuide>();

  /** Trayectoria del siguiente tiro de cada jugador (ver AimGuide). */
  private updateAimGuides(dt: number): void {
    for (const r of this.players()) {
      let g = this.aimGuides.get(r.index);
      if (!g) {
        g = new AimGuide();
        this.aimGuides.set(r.index, g);
        this.group.add(g.group);
      }
      const show =
        this.settings.drive.aimGuide && r.enabled && !r.climbing && this.phase !== 'AUTO' && this.fuel.robotCount(r.index) > 0;
      const L = show ? predictLaunch(r, this.settings.drive.autoAim, this.settings.drive.shootOnMove, dt) : null;
      if (!L) {
        g.hide();
        continue;
      }
      const c = F.hubCenter(r.alliance);
      const active = this.match ? this.match.isHubActive(r.alliance) : true;
      g.show(L.from, L.vel, L.spin, L.pass ? null : { x: c.x, z: c.z, active }, r.cmd.shoot || r.cmd.pass);
    }
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
      r.climb.release(r);
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

/** Rumbo (rad) de un cuaternión de vista (adelante = +X local). */
function yawOf(q: THREE.Quaternion): number {
  const fx = 1 - 2 * (q.y * q.y + q.z * q.z);
  const fz = 2 * (q.x * q.z - q.w * q.y);
  return Math.atan2(-fz, fx);
}
