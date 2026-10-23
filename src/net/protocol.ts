/**
 * Mensajes del modo en línea y su codificación (lógica pura, con pruebas en tests/net.test.ts).
 *
 * - Cliente → host: controles (`in`, ~60 Hz) con la pose de su cámara (el host la usa para el
 *   manejo field-relative y para apuntar con el mouse, igual que con un jugador local).
 * - Host → clientes: estado del campo en binario (`encodeSnapshot`, 30 Hz; el FUEL solo cuando
 *   cambia), estado lento en JSON (marcador, faltas, estadísticas) y eventos (sonidos, efectos).
 */
import type { RobotSpec } from '../config/robots';
import type { MatchEvent } from '../core/match';
import type { Alliance } from '../core/types';
import { BUTTON_ACTIONS, emptyInput, type ButtonAction, type PlayerInput } from '../input/actions';
import type { SessionConfig } from '../game/GameSession';
import type { CameraMode } from '../render/CameraRig';

// ------------------------------------------------------------------ lobby
export interface LobbyPlayer {
  id: string;
  name: string;
  alliance: Alliance;
  robotName: string;
  team: number;
  host: boolean;
}

export interface LobbyInfo {
  players: LobbyPlayer[];
  difficulty: string;
  fillAi: boolean;
  fuel: number;
}

/** Pose de la cámara del cliente: posición, cuaternión, fov, aspecto y modo. */
export interface NetCamera {
  p: [number, number, number];
  q: [number, number, number, number];
  fov: number;
  aspect: number;
  mode: CameraMode;
}

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; alliance: Alliance; spec: RobotSpec }
  | { t: 'pick'; alliance: Alliance; spec: RobotSpec }
  | { t: 'in'; i: WireInput; cam: NetCamera }
  | { t: 'bye' };

/** Evento del host para efectos y sonidos del cliente. */
export type NetEvent =
  | { k: 'match'; e: MatchEvent }
  | { k: 'score'; hub: Alliance; counted: boolean; x: number; y: number; z: number }
  | { k: 'launch'; robot: number; kind: 'shot' | 'pass' | 'corral' }
  | { k: 'hp'; a: Alliance; what: 'throw' | 'door' }
  | { k: 'impact'; s: number; robots: number[]; x: number; y: number; z: number }
  | { k: 'toast'; key: 'gyroReset' | 'fieldRel' | 'robotRel'; robot: number }
  | { k: 'left'; name: string };

export type HostMsg =
  | { t: 'welcome'; id: string }
  | { t: 'reject'; reason: 'full' | 'version' | 'started' }
  | { t: 'lobby'; info: LobbyInfo }
  | { t: 'start'; cfg: SessionConfig; robot: number }
  | { t: 'slow'; s: SlowState }
  | { t: 'ev'; e: NetEvent }
  | { t: 'close' };

/** Estado que cambia poco: marcador, faltas, estadísticas, OUTPOST, PINS. */
export interface SlowState {
  m: {
    running: boolean;
    phase: string;
    firstInactive: Alliance | null;
    firstInactiveRandom: boolean;
    fuel: unknown;
    tower: unknown;
    fouls: unknown[];
    cards: unknown[];
    disq: number[];
    history: unknown[];
    autoTowerDone: boolean;
    teleopTowerDone: boolean;
  } | null;
  r: Array<{ stats: Record<string, number>; tower: { auto: number; teleop: number; level: number }; climb: number }>;
  door: Record<Alliance, boolean>;
  chute: Record<Alliance, number[]>;
  corral: Record<Alliance, number[]>;
  pins: Array<{ victim: number; pinner: number; seconds: number }>;
}

// ------------------------------------------------------------------ controles
export interface WireInput {
  mx: number;
  my: number;
  rot: number;
  /** Botones sostenidos y flancos (bits en el orden de BUTTON_ACTIONS). */
  held: number;
  pressed: number;
  mouse: [number, number] | null;
}

const bits = (has: (a: ButtonAction) => boolean) => BUTTON_ACTIONS.reduce((acc, a, k) => (has(a) ? acc | (1 << k) : acc), 0);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function encodeInput(inp: PlayerInput): WireInput {
  return {
    mx: r3(inp.moveX),
    my: r3(inp.moveY),
    rot: r3(inp.rotate),
    held: bits((a) => inp.held[a]),
    pressed: bits((a) => inp.pressed.has(a)),
    mouse: inp.mouseNdc ? [r3(inp.mouseNdc.x), r3(inp.mouseNdc.y)] : null,
  };
}

const clamp1 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

/** Decodifica (y sanea: viene de otra computadora) los controles de un cliente. */
export function decodeInput(w: WireInput): PlayerInput {
  const inp = emptyInput('keyboard');
  inp.moveX = clamp1(w.mx);
  inp.moveY = clamp1(w.my);
  inp.rotate = clamp1(w.rot);
  BUTTON_ACTIONS.forEach((a, k) => {
    inp.held[a] = !!((w.held | 0) & (1 << k));
    if ((w.pressed | 0) & (1 << k)) inp.pressed.add(a);
  });
  if (Array.isArray(w.mouse)) inp.mouseNdc = { x: clamp1(w.mouse[0]), y: clamp1(w.mouse[1]) };
  return inp;
}

// ------------------------------------------------------------------ estado del campo (binario)
/** Valores de mecanismos de un robot (en este orden). */
export const ROBOT_MECH = ['intakeDeploy', 'turretYaw', 'hoodAngle', 'climbHeight', 'climbDeploy', 'wheelYaw', 'wheelSpin', 'intakeSpin', 'flywheelSpin'] as const;
export type MechKey = (typeof ROBOT_MECH)[number];

export const RF = { enabled: 1, disabled: 2, intakeOn: 4, climbing: 8, fieldRelative: 16, attached: 32 } as const;

export interface RobotSnap {
  p: [number, number, number];
  q: [number, number, number, number];
  v: [number, number];
  mech: number[];
  flags: number;
}

/** FUEL cuantizado: estado, dueño, banderas y posición en mm. */
export interface FuelSnap {
  state: Uint8Array;
  owner: Int8Array;
  flags: Uint8Array;
  pos: Int16Array;
}

export interface Snapshot {
  /** Tiempo simulado del host (s). */
  t: number;
  /** Reloj del match (s). */
  mt: number;
  robots: RobotSnap[];
  fuel: FuelSnap;
}

export const newFuelSnap = (n: number): FuelSnap => ({
  state: new Uint8Array(n).fill(255),
  owner: new Int8Array(n),
  flags: new Uint8Array(n),
  pos: new Int16Array(n * 3),
});

export const cloneFuelSnap = (f: FuelSnap): FuelSnap => ({ state: f.state.slice(), owner: f.owner.slice(), flags: f.flags.slice(), pos: f.pos.slice() });

/** m → mm en Int16 (±32 m: el campo mide 16.5 × 8.1 m). */
export const qPos = (m: number) => Math.max(-32767, Math.min(32767, Math.round(m * 1000)));

const SNAP = 1;
const ROBOT_BYTES = (3 + 4 + 2 + ROBOT_MECH.length) * 4 + 1;
const FUEL_BYTES = 2 + 1 + 1 + 1 + 6;

/**
 * Codifica el estado. Del FUEL solo van los que cambiaron respecto a `sent` (que se actualiza):
 * el canal es confiable y ordenado, así que el cliente reconstruye el estado completo.
 */
export function encodeSnapshot(t: number, mt: number, robots: RobotSnap[], fuel: FuelSnap, sent: FuelSnap): ArrayBuffer {
  const n = fuel.state.length;
  const changed: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    if (
      fuel.state[i] !== sent.state[i] ||
      fuel.owner[i] !== sent.owner[i] ||
      fuel.flags[i] !== sent.flags[i] ||
      fuel.pos[o] !== sent.pos[o] ||
      fuel.pos[o + 1] !== sent.pos[o + 1] ||
      fuel.pos[o + 2] !== sent.pos[o + 2]
    ) {
      changed.push(i);
      sent.state[i] = fuel.state[i];
      sent.owner[i] = fuel.owner[i];
      sent.flags[i] = fuel.flags[i];
      sent.pos[o] = fuel.pos[o];
      sent.pos[o + 1] = fuel.pos[o + 1];
      sent.pos[o + 2] = fuel.pos[o + 2];
    }
  }
  const buf = new ArrayBuffer(1 + 1 + 2 + 8 + robots.length * ROBOT_BYTES + changed.length * FUEL_BYTES);
  const d = new DataView(buf);
  let k = 0;
  d.setUint8(k++, SNAP);
  d.setUint8(k++, robots.length);
  d.setUint16(k, changed.length, true);
  k += 2;
  d.setFloat32(k, t, true);
  d.setFloat32(k + 4, mt, true);
  k += 8;
  for (const r of robots) {
    for (const v of [...r.p, ...r.q, ...r.v, ...r.mech]) {
      d.setFloat32(k, v, true);
      k += 4;
    }
    d.setUint8(k++, r.flags);
  }
  for (const i of changed) {
    const o = i * 3;
    d.setUint16(k, i, true);
    d.setUint8(k + 2, fuel.state[i]);
    d.setInt8(k + 3, fuel.owner[i]);
    d.setUint8(k + 4, fuel.flags[i]);
    d.setInt16(k + 5, fuel.pos[o], true);
    d.setInt16(k + 7, fuel.pos[o + 1], true);
    d.setInt16(k + 9, fuel.pos[o + 2], true);
    k += FUEL_BYTES;
  }
  return buf;
}

/** Decodifica sobre el estado de FUEL anterior (`base`, no se modifica). */
export function decodeSnapshot(buf: ArrayBuffer, base: FuelSnap): Snapshot | null {
  const d = new DataView(buf);
  if (buf.byteLength < 12 || d.getUint8(0) !== SNAP) return null;
  const nr = d.getUint8(1);
  const nf = d.getUint16(2, true);
  if (buf.byteLength !== 12 + nr * ROBOT_BYTES + nf * FUEL_BYTES) return null;
  const t = d.getFloat32(4, true);
  const mt = d.getFloat32(8, true);
  let k = 12;
  const f32 = () => {
    const v = d.getFloat32(k, true);
    k += 4;
    return v;
  };
  const robots: RobotSnap[] = [];
  for (let j = 0; j < nr; j++) {
    const p: [number, number, number] = [f32(), f32(), f32()];
    const q: [number, number, number, number] = [f32(), f32(), f32(), f32()];
    const v: [number, number] = [f32(), f32()];
    const mech = ROBOT_MECH.map(() => f32());
    robots.push({ p, q, v, mech, flags: d.getUint8(k++) });
  }
  const fuel = cloneFuelSnap(base);
  for (let j = 0; j < nf; j++) {
    const i = d.getUint16(k, true);
    if (i < fuel.state.length) {
      const o = i * 3;
      fuel.state[i] = d.getUint8(k + 2);
      fuel.owner[i] = d.getInt8(k + 3);
      fuel.flags[i] = d.getUint8(k + 4);
      fuel.pos[o] = d.getInt16(k + 5, true);
      fuel.pos[o + 1] = d.getInt16(k + 7, true);
      fuel.pos[o + 2] = d.getInt16(k + 9, true);
    }
    k += FUEL_BYTES;
  }
  return { t, mt, robots, fuel };
}

/** Código de sala: 5 caracteres sin los que se confunden (0/O, 1/I/L). */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function roomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}

/** Normaliza lo que escribe el jugador ("abc d2" → "ABCD2"); null si no es un código válido. */
export function parseRoomCode(s: string): string | null {
  const c = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 5 && [...c].every((ch) => CODE_CHARS.includes(ch)) ? c : null;
}
