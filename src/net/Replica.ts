/**
 * Estado del campo entre host y clientes del modo en línea.
 * - Host: `captureRobots` / `captureFuel` / `captureSlow` leen la sesión que simula.
 * - Cliente: `Replica` guarda los estados que llegan y dibuja ~100 ms en el pasado, interpolando
 *   entre los dos que rodean ese instante (como la interpolación de paso fijo, pero con la red).
 *   El robot propio no: va en el presente, predicho con los controles (`OwnPrediction`).
 */
import { NET } from '../config/net';
import { isTeleop } from '../core/clock';
import type { FoulRecord, CardRecord } from '../core/fouls';
import { ALLIANCES, type Phase } from '../core/types';
import type { ClimbSlot } from '../game/Climber';
import type { GameSession, SessionReplica } from '../game/GameSession';
import type { PlayerInput } from '../input/actions';
import { FuelState, type FuelSystem } from '../physics/FuelSystem';
import { DrivePredictor, PREDICT, driveModel, type Pose2 } from './prediction';
import { decodeSnapshot, newFuelSnap, qPos, RF, ROBOT_MECH, type FuelSnap, type RobotSnap, type SlowState, type Snapshot } from './protocol';

// ------------------------------------------------------------------ host
export function captureRobots(s: GameSession): RobotSnap[] {
  return s.robots.map((r) => {
    const p = r.phys.curPos;
    const q = r.phys.curRot;
    const v = r.phys.velocity();
    const flags =
      (r.enabled ? RF.enabled : 0) |
      (r.disabled ? RF.disabled : 0) |
      (r.intakeOn ? RF.intakeOn : 0) |
      (r.climbing ? RF.climbing : 0) |
      (r.fieldRelative ? RF.fieldRelative : 0) |
      (r.climb.attached ? RF.attached : 0);
    return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], v: [v.x, v.z], mech: ROBOT_MECH.map((k) => r[k]), flags };
  });
}

export function captureFuel(f: FuelSystem, out: FuelSnap): void {
  for (let i = 0; i < f.count; i++) {
    out.state[i] = f.state[i];
    out.owner[i] = f.owner[i];
    out.flags[i] = f.flags[i];
    const o = i * 3;
    // en reposo o guardado, la posición no importa: así no se reenvía
    const show = f.state[i] === FuelState.Field;
    out.pos[o] = show ? qPos(f.pos[o]) : 0;
    out.pos[o + 1] = show ? qPos(f.pos[o + 1]) : 0;
    out.pos[o + 2] = show ? qPos(f.pos[o + 2]) : 0;
  }
}

export function captureSlow(s: GameSession): SlowState {
  const m = s.match;
  return {
    m: m && {
      running: m.running,
      phase: m.phase,
      firstInactive: m.firstInactive,
      firstInactiveRandom: m.firstInactiveRandom,
      fuel: m.fuel,
      tower: m.tower,
      fouls: m.fouls,
      cards: m.cards,
      disq: [...m.disqualified],
      history: m.history,
      autoTowerDone: m.autoTowerDone,
      teleopTowerDone: m.teleopTowerDone,
    },
    r: s.robots.map((r) => ({ stats: r.stats, tower: r.towerResult, climb: r.climb.progress })),
    door: { red: s.humanPlayers.red.doorOpen, blue: s.humanPlayers.blue.doorOpen },
    chute: s.fuel.chute,
    corral: s.fuel.corral,
    pins: s.pins(),
  };
}

// ------------------------------------------------------------------ cliente
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const ANGLES = new Set<string>(['turretYaw', 'wheelYaw']);
/** Puesto de TOWER ficticio: el HUD del cliente solo pregunta si está enganchado. */
const ATTACHED = {} as ClimbSlot;

/** Pone en la sesión el estado lento (marcador, faltas, estadísticas, OUTPOST, PINS). */
export function applySlowState(s: GameSession, st: SlowState): void {
  const m = s.match;
  if (m && st.m) {
    m.running = st.m.running;
    m.phase = st.m.phase as Phase;
    m.firstInactive = st.m.firstInactive;
    m.firstInactiveRandom = st.m.firstInactiveRandom;
    Object.assign(m.fuel.red, (st.m.fuel as typeof m.fuel).red);
    Object.assign(m.fuel.blue, (st.m.fuel as typeof m.fuel).blue);
    Object.assign(m.tower.red, (st.m.tower as typeof m.tower).red);
    Object.assign(m.tower.blue, (st.m.tower as typeof m.tower).blue);
    m.fouls.splice(0, m.fouls.length, ...(st.m.fouls as FoulRecord[]));
    m.cards.splice(0, m.cards.length, ...(st.m.cards as CardRecord[]));
    m.disqualified.clear();
    for (const i of st.m.disq) m.disqualified.add(i);
    m.history.splice(0, m.history.length, ...(st.m.history as typeof m.history));
    m.autoTowerDone = st.m.autoTowerDone;
    m.teleopTowerDone = st.m.teleopTowerDone;
  }
  st.r.forEach((x, i) => {
    const r = s.robots[i];
    if (!r) return;
    Object.assign(r.stats, x.stats);
    Object.assign(r.towerResult, x.tower);
    r.climb.progress = x.climb;
  });
  for (const a of ALLIANCES) {
    s.humanPlayers[a].doorOpen = !!st.door[a];
    s.fuel.chute[a].splice(0, s.fuel.chute[a].length, ...st.chute[a]);
    s.fuel.corral[a].splice(0, s.fuel.corral[a].length, ...st.corral[a]);
  }
  s.netPins = st.pins;
}

/**
 * Dibuja el estado entre dos snapshots (`k` = 0…1): robots, mecanismos y FUEL. Lo usan el cliente
 * en línea y el reproductor de repeticiones.
 */
export class SnapshotApplier {
  private prevState: Uint8Array;

  constructor(private s: GameSession) {
    this.prevState = new Uint8Array(s.fuel.count).fill(FuelState.Out);
  }

  /** Tras un salto (repeticiones): el FUEL no se "absorbe" desde donde estaba antes del salto. */
  reset(): void {
    this.prevState.fill(FuelState.Out);
  }

  apply(A: Snapshot, B: Snapshot, k: number, time: number): void {
    this.applyRobots(A, B, k);
    this.applyFuel(A, B);
    const s = this.s;
    if (s.match) s.match.t = lerp(A.mt, B.mt, k);
    s.simTime = time;
    s.fuel.time = time;
    s.setInterp(k);
  }

  private applyRobots(A: Snapshot, B: Snapshot, k: number): void {
    this.s.robots.forEach((r, j) => {
      const a = A.robots[j];
      const b = B.robots[j];
      if (!a || !b) return;
      const ph = r.phys;
      ph.prevPos = { x: a.p[0], y: a.p[1], z: a.p[2] };
      ph.curPos = { x: b.p[0], y: b.p[1], z: b.p[2] };
      ph.prevRot = { x: a.q[0], y: a.q[1], z: a.q[2], w: a.q[3] };
      ph.curRot = { x: b.q[0], y: b.q[1], z: b.q[2], w: b.q[3] };
      // el cuerpo no se simula, pero rumbo y velocidad (cámara, HUD) se leen de él
      ph.body.setTranslation(ph.curPos, false);
      ph.body.setRotation(ph.curRot, false);
      ph.body.setLinvel({ x: lerp(a.v[0], b.v[0], k), y: 0, z: lerp(a.v[1], b.v[1], k) }, false);
      ROBOT_MECH.forEach((key, n) => {
        r[key] = ANGLES.has(key) ? lerpAngle(a.mech[n], b.mech[n], k) : lerp(a.mech[n], b.mech[n], k);
      });
      const f = b.flags;
      r.enabled = !!(f & RF.enabled);
      r.disabled = !!(f & RF.disabled);
      r.intakeOn = !!(f & RF.intakeOn);
      r.climbing = !!(f & RF.climbing);
      r.fieldRelative = !!(f & RF.fieldRelative);
      r.climb.slot = f & RF.attached ? ATTACHED : null;
      r.climb.dock = 1;
    });
  }

  private applyFuel(A: Snapshot, B: Snapshot): void {
    const f = this.s.fuel;
    const a = A.fuel;
    const b = B.fuel;
    for (const list of f.robotStore.values()) list.length = 0;
    const n = Math.min(f.count, b.state.length);
    for (let i = 0; i < n; i++) {
      const st = b.state[i] === 255 ? FuelState.Out : (b.state[i] as FuelState);
      const o = i * 3;
      // recién recogido: la animación de absorción sale de donde se veía
      if (st === FuelState.Robot && this.prevState[i] === FuelState.Field) {
        f.capturedAt[i] = f.time;
        f.capturePos.set(f.pos.subarray(o, o + 3), o);
      }
      this.prevState[i] = st;
      f.state[i] = st;
      f.owner[i] = b.owner[i];
      f.flags[i] = b.flags[i];
      if (st === FuelState.Robot) {
        let list = f.robotStore.get(b.owner[i]);
        if (!list) f.robotStore.set(b.owner[i], (list = []));
        list.push(i);
      }
      if (st !== FuelState.Field) continue;
      const from = a.state[i] === FuelState.Field ? a.pos : b.pos;
      for (let c = 0; c < 3; c++) {
        f.prev[o + c] = from[o + c] / 1000;
        f.pos[o + c] = b.pos[o + c] / 1000;
      }
    }
  }
}

export class Replica implements SessionReplica {
  private buf: Snapshot[] = [];
  private base: FuelSnap;
  private renderT = -1;
  private applier: SnapshotApplier;
  /** Último estado recibido (s del host) y cuándo llegó (para detectar al host congelado). */
  lastRecv = 0;
  /** Tiempo del host del último estado recibido. */
  hostTime = 0;
  /** Grabación de la repetición: cada estado y cada estado lento que llega. */
  onSnapshot: ((snap: Snapshot) => void) | null = null;
  onSlow: ((st: SlowState) => void) | null = null;
  /** Ida y vuelta al host (s), medida por el cliente. */
  rtt = 0.1;
  /** Predicción del robot propio (null: espectador, o `?predict=0`). */
  prediction: OwnPrediction | null = null;

  constructor(
    private s: GameSession,
    own = -1,
  ) {
    this.base = newFuelSnap(s.fuel.count);
    this.applier = new SnapshotApplier(s);
    if (own >= 0 && s.robots[own] && new URLSearchParams(location.search).get('predict') !== '0') this.prediction = new OwnPrediction(s, own);
  }

  push(buf: ArrayBuffer): void {
    const snap = decodeSnapshot(buf, this.base);
    if (!snap) return;
    this.base = snap.fuel;
    this.buf.push(snap);
    if (this.buf.length > 30) this.buf.shift();
    this.lastRecv = performance.now();
    this.hostTime = snap.t;
    this.onSnapshot?.(snap);
  }

  applySlow(st: SlowState): void {
    applySlowState(this.s, st);
    this.onSlow?.(st);
  }

  /** Segundos desde el último estado del host. */
  get silence(): number {
    return this.lastRecv ? (performance.now() - this.lastRecv) / 1000 : 0;
  }

  update(frameDt: number, input?: PlayerInput): void {
    const b = this.buf;
    if (!b.length) return;
    const latest = b[b.length - 1].t;
    const target = latest - NET.interpDelay;
    if (this.renderT < 0 || Math.abs(this.renderT - target) > 0.5) this.renderT = target;
    else this.renderT += frameDt + (target - this.renderT) * Math.min(1, frameDt * 2);
    this.renderT = Math.min(this.renderT, latest);
    // los dos estados que rodean el instante a dibujar
    let i = 0;
    while (i < b.length - 2 && b[i + 1].t <= this.renderT) i++;
    const A = b[i];
    const B = b[Math.min(i + 1, b.length - 1)];
    const k = B.t > A.t ? Math.max(0, Math.min(1, (this.renderT - A.t) / (B.t - A.t))) : 1;
    if (i > 0) b.splice(0, i);
    this.applier.apply(A, B, k, this.renderT);
    // el host va atrás lo que tardan los controles en llegarle más lo que tardó su último estado
    if (this.prediction) this.prediction.update(frameDt, input, b[b.length - 1], k, this.silence, this.rtt + 1 / 60);
  }
}

const yawQuat = (h: number) => ({ x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) });
/** Producto de cuaterniones a·b. */
const qmul = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
type Quat = { x: number; y: number; z: number; w: number };
const headingOf = (q: Quat) => Math.atan2(-2 * (q.x * q.z - q.w * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));

/**
 * Robot propio del cliente en el presente (ver net/prediction): solo en TELEOP y manejando (en
 * AUTO lo mueve su rutina, trepando o deshabilitado lo manda el host); al entrar y salir de la
 * predicción se mezcla con la pose interpolada en ~0.25 s para que no brinque.
 */
export class OwnPrediction {
  readonly pred: DrivePredictor;
  /** Peso de la predicción (0 = la pose interpolada del host, 1 = la predicha). */
  weight = 0;
  /** Último error contra el host (m), para pruebas y depuración. */
  error = 0;

  constructor(
    private s: GameSession,
    readonly robot: number,
  ) {
    const r = s.robots[robot];
    this.pred = new DrivePredictor(driveModel(r.spec, r.phys.halfL, r.phys.halfW));
  }

  /**
   * `silence`: s desde el último estado del host; `lag`: lo que tardan los controles en llegarle y su
   * estado en volver (ida y vuelta + un frame).
   */
  update(dt: number, input: PlayerInput | undefined, latest: Snapshot, k: number, silence: number, lag: number): void {
    const s = this.s;
    const r = s.robots[this.robot];
    const now = latest.robots[this.robot];
    if (!r || !now || dt <= 0) return;
    const ph = r.phys;
    const phase = s.match?.phase;
    // (si el host se trabó, su robot tampoco se mueve: no se predice lo que no va a pasar)
    // y quieto tampoco: parado se ve exactamente donde lo pone el host
    const p = this.pred;
    const driving = !!input && (Math.abs(input.moveX) + Math.abs(input.moveY) + Math.abs(input.rotate) > 0.05 || input.held.shoot || input.held.pass);
    const moving = Math.hypot(p.vx, p.vz) > 0.05 || Math.abs(p.w) > 0.05;
    const active = !!input && (driving || moving) && r.enabled && !r.climbing && !r.climb.slot && (!phase || isTeleop(phase)) && silence < PREDICT.maxSilence;
    const tau = Math.min(PREDICT.maxLag, silence + lag);
    const host: Pose2 = { x: now.p[0], z: now.p[2], h: headingOf({ x: now.q[0], y: now.q[1], z: now.q[2], w: now.q[3] }) };
    if (this.weight === 0) this.pred.reset(host, now.v[0], now.v[1]);
    this.weight = Math.max(0, Math.min(1, this.weight + (active ? dt : -dt) / 0.25));
    if (this.weight === 0) return;
    // pose interpolada (la que dejó SnapshotApplier)
    const ix = ph.prevPos.x + (ph.curPos.x - ph.prevPos.x) * k;
    const iy = ph.prevPos.y + (ph.curPos.y - ph.prevPos.y) * k;
    const iz = ph.prevPos.z + (ph.curPos.z - ph.prevPos.z) * k;
    const iq = ph.curRot;
    const ih = headingOf(iq);
    // el mando se calcula con el rumbo predicho (manejo relativo al robot, auto-aim)
    ph.body.setRotation(yawQuat(this.pred.h), false);
    ph.body.setTranslation({ x: this.pred.x, y: iy, z: this.pred.z }, false);
    const cmd = active && input && !s.paused ? s.predictDrive(r, input) : { vx: 0, vz: 0, omega: 0 };
    this.pred.step(cmd, dt);
    this.error = this.pred.correct(host, tau, dt);
    const w = this.weight;
    const x = ix + (this.pred.x - ix) * w;
    const z = iz + (this.pred.z - iz) * w;
    const dh = Math.atan2(Math.sin(this.pred.h - ih), Math.cos(this.pred.h - ih)) * w;
    // conserva la inclinación del host (BUMP) y cambia solo el rumbo
    const q = qmul(yawQuat(dh), iq);
    const pos = { x, y: iy, z };
    ph.prevPos = pos;
    ph.curPos = { ...pos };
    ph.prevRot = q;
    ph.curRot = { ...q };
    ph.body.setTranslation(pos, false);
    ph.body.setRotation(q, false);
    ph.body.setLinvel({ x: this.pred.vx * w + now.v[0] * (1 - w), y: 0, z: this.pred.vz * w + now.v[1] * (1 - w) }, false);
  }
}
