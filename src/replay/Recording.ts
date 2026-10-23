/**
 * Repeticiones: grabación compacta de un match y su archivo (lógica pura, pruebas en
 * tests/replay.test.ts).
 *
 * Se graba lo mismo que el host del modo en línea manda a sus clientes (net/protocol): el estado
 * del campo en binario a 30 Hz (robots completos; del FUEL solo lo que cambió), el estado lento
 * (marcador, faltas, estadísticas) cuando cambia, y los eventos (sonidos y efectos). Así la
 * repetición se dibuja con el mismo código que el cliente en línea (net/Replica).
 *
 * Para poder saltar a cualquier momento sin decodificar desde el inicio, cada `KEY_EVERY` s hay un
 * cuadro clave con el FUEL completo.
 */
import type { SessionConfig, SessionMode } from '../game/GameSession';
import type { EventType } from '../core/types';
import { decodeSnapshot, encodeSnapshot, newFuelSnap, type FuelSnap, type NetEvent, type RobotSnap, type SlowState, type Snapshot } from '../net/protocol';

/** Cuadros por segundo de la grabación (como el estado del modo en línea). */
export const REPLAY_HZ = 30;
/** Cada cuántos segundos hay un cuadro clave (FUEL completo). */
export const KEY_EVERY = 2;
/** Duración máxima grabada (s): un match dura 2:43 más la pausa y la evaluación final. */
export const MAX_DURATION = 6 * 60;
const FORMAT = 1;
const MAGIC = [0x52, 0x42, 0x52, 0x50]; // "RBRP"

export interface ReplayMeta {
  /** Fecha de grabación (ms). */
  date: number;
  mode: SessionMode;
  eventType: EventType;
  /** Marcador final (o al cortar). */
  score: { red: number; blue: number };
  teams: { red: number[]; blue: number[] };
  /** Duración (s). */
  duration: number;
  /** Match sin terminar (se salió antes del final). */
  partial?: boolean;
  /** Clip: segmento de otra repetición (reloj del match al inicio y al final). */
  clip?: { from: number; to: number };
  /** Versión del simulador que la grabó. */
  app?: string;
}

export interface ReplayData {
  meta: ReplayMeta;
  /** Configuración de la sesión (robots, FUEL, tipo de evento). */
  cfg: SessionConfig;
  fuelCount: number;
  /** Estados del campo (encodeSnapshot, cada uno sobre el anterior salvo los cuadros clave). */
  frames: Uint8Array[];
  /** Índices de los cuadros clave (el primero siempre es 0). */
  keys: number[];
  /** Estado lento como JSON, desde el tiempo `t`. */
  slow: Array<{ t: number; j: string }>;
  events: Array<{ t: number; e: NetEvent }>;
}

/** Tiempo (s del host) de un cuadro: va en los bytes 4–7 de encodeSnapshot. */
export function frameTime(f: Uint8Array): number {
  return new DataView(f.buffer, f.byteOffset, f.byteLength).getFloat32(4, true);
}

/** Reloj del match de un cuadro (bytes 8–11). */
export function frameMatchTime(f: Uint8Array): number {
  return new DataView(f.buffer, f.byteOffset, f.byteLength).getFloat32(8, true);
}

// ------------------------------------------------------------------ grabación
export class ReplayRecorder {
  readonly frames: Uint8Array[] = [];
  readonly keys: number[] = [];
  readonly slow: Array<{ t: number; j: string }> = [];
  readonly events: Array<{ t: number; e: NetEvent }> = [];
  private sent: FuelSnap;
  private lastT = -Infinity;
  private lastKeyT = -Infinity;
  private lastSlow = '';
  /** Tiempo del último cuadro grabado. */
  t = 0;
  full = false;

  constructor(
    readonly cfg: SessionConfig,
    readonly fuelCount: number,
  ) {
    this.sent = newFuelSnap(fuelCount);
  }

  get duration(): number {
    return this.frames.length ? this.t - frameTime(this.frames[0]) : 0;
  }

  /** ¿Toca grabar un cuadro en el tiempo `t`? (a REPLAY_HZ, con tolerancia de medio paso). */
  due(t: number): boolean {
    return !this.full && t - this.lastT >= 1 / REPLAY_HZ - 0.004;
  }

  frame(t: number, mt: number, robots: RobotSnap[], fuel: FuelSnap): void {
    if (this.full || t <= this.lastT) return;
    if (this.frames.length && t - frameTime(this.frames[0]) > MAX_DURATION) {
      this.full = true;
      return;
    }
    const key = t - this.lastKeyT >= KEY_EVERY - 1e-6;
    if (key) {
      // cuadro clave: todo el FUEL (contra un estado vacío)
      this.sent = newFuelSnap(this.fuelCount);
      this.lastKeyT = t;
      this.keys.push(this.frames.length);
    }
    this.frames.push(new Uint8Array(encodeSnapshot(t, mt, robots, fuel, this.sent)));
    this.lastT = t;
    this.t = t;
  }

  /** Un estado ya decodificado (cliente en línea). */
  snapshot(s: Snapshot): void {
    this.frame(s.t, s.mt, s.robots, s.fuel);
  }

  slowState(t: number, st: SlowState): void {
    const j = JSON.stringify(st);
    if (j === this.lastSlow) return;
    this.lastSlow = j;
    const last = this.slow[this.slow.length - 1];
    // varios en el mismo instante: vale el último
    if (last && last.t >= t) last.j = j;
    else this.slow.push({ t, j });
  }

  event(t: number, e: NetEvent): void {
    if (!this.full) this.events.push({ t, e });
  }

  finish(meta: Omit<ReplayMeta, 'duration'>): ReplayData {
    return {
      meta: { ...meta, duration: Math.round(this.duration * 100) / 100 },
      cfg: this.cfg,
      fuelCount: this.fuelCount,
      frames: this.frames.slice(),
      keys: this.keys.slice(),
      slow: this.slow.slice(),
      events: this.events.slice(),
    };
  }
}

// ------------------------------------------------------------------ lectura
/** Lee los cuadros de una repetición en cualquier orden (decodifica desde el cuadro clave previo). */
export class FrameReader {
  readonly times: Float64Array;
  private idx = -1;
  private cur: Snapshot | null = null;
  private prev: Snapshot | null = null;

  constructor(private d: ReplayData) {
    this.times = Float64Array.from(d.frames, frameTime);
  }

  get count(): number {
    return this.d.frames.length;
  }

  get start(): number {
    return this.times[0] ?? 0;
  }

  get end(): number {
    return this.times[this.times.length - 1] ?? 0;
  }

  /** Último cuadro con tiempo ≤ t (0 si t es anterior al primero). */
  indexAt(t: number): number {
    return Math.max(0, upperBound(this.times, t) - 1);
  }

  get(i: number): Snapshot {
    i = Math.max(0, Math.min(this.count - 1, i));
    if (i === this.idx && this.cur) return this.cur;
    if (i === this.idx - 1 && this.prev) return this.prev;
    let from = this.idx + 1;
    let base = this.cur?.fuel;
    // hacia atrás, o muy adelante: desde el cuadro clave anterior
    if (!base || i < from || i - from > REPLAY_HZ * KEY_EVERY) {
      from = this.d.keys[upperBound(this.d.keys, i) - 1] ?? 0;
      base = newFuelSnap(this.d.fuelCount);
      this.cur = null;
    }
    for (let j = from; j <= i; j++) {
      const f = this.d.frames[j];
      const buf = f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer;
      const s = decodeSnapshot(buf, base!);
      if (!s) throw new Error('replay: cuadro inválido');
      this.prev = this.cur;
      this.cur = s;
      base = s.fuel;
    }
    this.idx = i;
    return this.cur!;
  }

  /** Estado lento vigente en `t` (índice en d.slow, −1 si aún no hay). */
  slowIndexAt(t: number): number {
    const sl = this.d.slow;
    let lo = 0;
    let hi = sl.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (sl[m].t <= t) lo = m + 1;
      else hi = m;
    }
    return lo - 1;
  }
}

/** Primer índice con a[i] > x. */
function upperBound(a: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] <= x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

// ------------------------------------------------------------------ clips
/** Segmento [t0, t1] (s del host) como repetición propia (para compartir). */
export function clipReplay(d: ReplayData, t0: number, t1: number): ReplayData {
  const rd = new FrameReader(d);
  const i0 = rd.indexAt(t0);
  const i1 = Math.max(i0, rd.indexAt(t1));
  const rec = new ReplayRecorder(d.cfg, d.fuelCount);
  for (let i = i0; i <= i1; i++) rec.snapshot(rd.get(i));
  const a = rd.times[i0];
  const b = rd.times[i1];
  // el estado lento vigente al inicio, y los que siguen
  const s0 = rd.slowIndexAt(a);
  for (let k = Math.max(0, s0); k < d.slow.length && d.slow[k].t <= b; k++) rec.slow.push({ t: Math.max(a, d.slow[k].t), j: d.slow[k].j });
  for (const ev of d.events) if (ev.t > a && ev.t <= b) rec.events.push(ev);
  const mt0 = frameMatchTime(d.frames[i0]);
  const mt1 = frameMatchTime(d.frames[i1]);
  return rec.finish({ ...d.meta, clip: { from: Math.round(mt0 * 10) / 10, to: Math.round(mt1 * 10) / 10 } });
}

// ------------------------------------------------------------------ momentos destacados
export interface Highlight {
  /** Tiempo (s del host) donde conviene empezar a verlo. */
  t: number;
  kind: 'score' | 'foul' | 'card' | 'hit';
  /** Para ordenar: FUEL anotado en la ráfaga, o peso fijo para faltas y choques. */
  weight: number;
  alliance?: 'red' | 'blue';
}

/**
 * Momentos para marcar en la línea de tiempo: las rachas de FUEL anotado (ventanas de 6 s), las
 * faltas y tarjetas, y los choques más fuertes. A lo más `max`.
 */
export function highlights(d: ReplayData, max = 8): Highlight[] {
  const out: Highlight[] = [];
  const W = 6;
  const scores = d.events.filter((x) => x.e.k === 'score' && x.e.counted);
  for (let i = 0; i < scores.length; ) {
    const t0 = scores[i].t;
    const by: Record<string, number> = { red: 0, blue: 0 };
    let j = i;
    while (j < scores.length && scores[j].t - t0 < W) {
      const e = scores[j].e as Extract<NetEvent, { k: 'score' }>;
      by[e.hub]++;
      j++;
    }
    const n = j - i;
    if (n >= 5) out.push({ t: t0 - 2, kind: 'score', weight: n, alliance: by.red >= by.blue ? 'red' : 'blue' });
    i = j;
  }
  for (const x of d.events) {
    if (x.e.k === 'match' && x.e.e.type === 'foul') out.push({ t: x.t - 3, kind: 'foul', weight: x.e.e.foul.severity === 'MAJOR' ? 12 : 8 });
    if (x.e.k === 'match' && x.e.e.type === 'card') out.push({ t: x.t - 3, kind: 'card', weight: 20 });
    if (x.e.k === 'impact' && x.e.s > 0.7) out.push({ t: x.t - 2, kind: 'hit', weight: 6 + x.e.s * 4 });
  }
  // sin encimarse: si dos quedan a menos de 4 s, gana el de más peso
  out.sort((a, b) => b.weight - a.weight);
  const kept: Highlight[] = [];
  for (const h of out) if (kept.length < max && kept.every((k) => Math.abs(k.t - h.t) > 4)) kept.push(h);
  const t0 = d.frames.length ? frameTime(d.frames[0]) : 0;
  for (const h of kept) h.t = Math.max(t0, h.t);
  return kept.sort((a, b) => a.t - b.t);
}

// ------------------------------------------------------------------ archivo
/**
 * Archivo `.rbreplay`: "RBRP", versión, JSON (todo menos los cuadros) y los cuadros con su largo;
 * todo comprimido con gzip si el navegador lo permite.
 */
export async function serializeReplay(d: ReplayData, compress = true): Promise<Uint8Array> {
  const { frames, ...rest } = d;
  const json = new TextEncoder().encode(JSON.stringify({ ...rest, f: FORMAT }));
  const size = 4 + 1 + 4 + json.length + 4 + frames.reduce((n, f) => n + 4 + f.length, 0);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = FORMAT;
  dv.setUint32(5, json.length, true);
  out.set(json, 9);
  let k = 9 + json.length;
  dv.setUint32(k, frames.length, true);
  k += 4;
  for (const f of frames) {
    dv.setUint32(k, f.length, true);
    out.set(f, k + 4);
    k += 4 + f.length;
  }
  return compress && typeof CompressionStream !== 'undefined' ? pipe(out, new CompressionStream('gzip')) : out;
}

export async function deserializeReplay(bytes: Uint8Array): Promise<ReplayData> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('replay: gzip no disponible');
    bytes = await pipe(bytes, new DecompressionStream('gzip'));
  }
  if (bytes.length < 13 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('replay: no es una repetición');
  if (bytes[4] > FORMAT) throw new Error('replay: versión más nueva');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jl = dv.getUint32(5, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(9, 9 + jl)));
  let k = 9 + jl;
  const n = dv.getUint32(k, true);
  k += 4;
  const frames: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const len = dv.getUint32(k, true);
    if (k + 4 + len > bytes.length) throw new Error('replay: archivo incompleto');
    frames.push(bytes.slice(k + 4, k + 4 + len));
    k += 4 + len;
  }
  const d: ReplayData = { meta: head.meta, cfg: head.cfg, fuelCount: head.fuelCount, keys: head.keys, slow: head.slow, events: head.events, frames };
  if (!d.meta || !d.cfg || !Array.isArray(d.keys) || d.keys[0] !== 0 || !frames.length) throw new Error('replay: archivo inválido');
  return d;
}

async function pipe(data: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(t);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
