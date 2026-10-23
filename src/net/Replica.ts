/**
 * Estado del campo entre host y clientes del modo en línea.
 * - Host: `captureRobots` / `captureFuel` / `captureSlow` leen la sesión que simula.
 * - Cliente: `Replica` guarda los estados que llegan y dibuja ~100 ms en el pasado, interpolando
 *   entre los dos que rodean ese instante (como la interpolación de paso fijo, pero con la red).
 */
import { NET } from '../config/net';
import type { FoulRecord, CardRecord } from '../core/fouls';
import { ALLIANCES, type Phase } from '../core/types';
import type { ClimbSlot } from '../game/Climber';
import type { GameSession, SessionReplica } from '../game/GameSession';
import { FuelState, type FuelSystem } from '../physics/FuelSystem';
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

export class Replica implements SessionReplica {
  private buf: Snapshot[] = [];
  private base: FuelSnap;
  private renderT = -1;
  private prevState: Uint8Array;
  /** Último estado recibido (s del host) y cuándo llegó (para detectar al host congelado). */
  lastRecv = 0;

  constructor(private s: GameSession) {
    this.base = newFuelSnap(s.fuel.count);
    this.prevState = new Uint8Array(s.fuel.count).fill(FuelState.Out);
  }

  push(buf: ArrayBuffer): void {
    const snap = decodeSnapshot(buf, this.base);
    if (!snap) return;
    this.base = snap.fuel;
    this.buf.push(snap);
    if (this.buf.length > 30) this.buf.shift();
    this.lastRecv = performance.now();
  }

  applySlow(st: SlowState): void {
    const s = this.s;
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

  /** Segundos desde el último estado del host. */
  get silence(): number {
    return this.lastRecv ? (performance.now() - this.lastRecv) / 1000 : 0;
  }

  update(frameDt: number): void {
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
    this.applyRobots(A, B, k);
    this.applyFuel(A, B);
    const s = this.s;
    if (s.match) s.match.t = lerp(A.mt, B.mt, k);
    s.simTime = this.renderT;
    s.fuel.time = this.renderT;
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
    for (let i = 0; i < f.count; i++) {
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
