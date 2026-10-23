/**
 * Grabar y reproducir repeticiones en una sesión.
 * - `SessionTap`: graba la sesión que simula (match local, torneo u host en línea) o lo que le
 *   llega al cliente en línea.
 * - `ReplayPlayer`: hace las veces del host en una sesión sin física: dibuja la grabación en el
 *   instante elegido (play/pausa, velocidad, saltos) con el mismo código que el cliente en línea.
 */
import type { GameSession, SessionHooks } from '../game/GameSession';
import type { SessionReplica } from '../game/GameSession';
import { newFuelSnap, type FuelSnap, type NetEvent, type SlowState } from '../net/protocol';
import { applySlowState, captureFuel, captureRobots, captureSlow, SnapshotApplier, type Replica } from '../net/Replica';
import { FrameReader, ReplayRecorder, type ReplayData, type ReplayMeta } from './Recording';

// ------------------------------------------------------------------ grabación
export class SessionTap {
  readonly rec: ReplayRecorder;
  private fuel: FuelSnap;
  private slowAcc = 0;
  finished = false;

  constructor(private s: GameSession) {
    this.rec = new ReplayRecorder(structuredClone(s.cfg), s.fuel.count);
    this.fuel = newFuelSnap(s.fuel.count);
    // a paso fijo: la grabación no depende de los FPS (ni de ?speed)
    s.onStep = (dt) => this.tick(dt);
  }

  /** Tiempo para eventos y estado lento: el de la simulación (o el del host, en el cliente). */
  private get now(): number {
    const r = this.s.replica as Replica | null;
    return r && 'hostTime' in r ? r.hostTime : this.s.simTime;
  }

  /** Cliente en línea: graba lo que llega del host. */
  attach(r: Replica): void {
    r.onSnapshot = (snap) => this.rec.snapshot(snap);
    r.onSlow = (st) => this.rec.slowState(r.hostTime, st);
  }

  /** Después de cada paso de física (sesión que simula). */
  private tick(dt: number): void {
    const s = this.s;
    if (this.finished || s.replica || !s.match?.running) return;
    if (this.rec.due(s.simTime)) {
      captureFuel(s.fuel, this.fuel);
      this.rec.frame(s.simTime, s.match.t, captureRobots(s), this.fuel);
    }
    this.slowAcc += dt;
    if (this.slowAcc >= 0.25) this.captureSlow();
  }

  private captureSlow(): void {
    this.slowAcc = 0;
    this.rec.slowState(this.s.simTime, captureSlow(this.s));
  }

  event(e: NetEvent): void {
    if (!this.finished && this.rec.frames.length) this.rec.event(this.now, e);
  }

  /** Envuelve los hooks de la sesión para grabar sus eventos (sonidos, efectos, faltas). */
  wrapHooks(h: SessionHooks): SessionHooks {
    return {
      ...h,
      matchEvent: (e) => {
        if (!this.s.replica) this.captureSlow();
        h.matchEvent?.(e);
        if (e.type !== 'evalAutoTower' && e.type !== 'evalTeleopTower') this.event({ k: 'match', e });
      },
      fuelScored: (hub, counted, x, y, z, by = -1) => {
        h.fuelScored?.(hub, counted, x, y, z, by);
        this.event({ k: 'score', hub, counted, x, y, z, by });
      },
      launch: (robot, kind, isPlayer) => {
        h.launch?.(robot, kind, isPlayer);
        this.event({ k: 'launch', robot: robot.index, kind });
      },
      hpAction: (a, what) => {
        h.hpAction?.(a, what);
        this.event({ k: 'hp', a, what });
      },
      impact: (strength, slot, x, y, z, robots = []) => {
        h.impact?.(strength, slot, x, y, z, robots);
        this.event({ k: 'impact', s: strength, robots, x, y, z });
      },
    };
  }

  /** Cierra la grabación (null si no alcanzó a grabar nada que valga la pena). */
  finish(partial: boolean, app?: string): ReplayData | null {
    if (this.finished) return null;
    if (!this.s.replica) this.captureSlow();
    this.finished = true;
    if (this.rec.duration < 5) return null;
    const s = this.s;
    const m = s.match;
    const meta: Omit<ReplayMeta, 'duration'> = {
      date: Date.now(),
      mode: s.cfg.mode,
      eventType: s.cfg.eventType,
      score: { red: m?.score('red') ?? 0, blue: m?.score('blue') ?? 0 },
      teams: {
        red: s.robots.filter((r) => r.alliance === 'red').map((r) => r.spec.teamNumber),
        blue: s.robots.filter((r) => r.alliance === 'blue').map((r) => r.spec.teamNumber),
      },
      app,
    };
    if (partial) meta.partial = true;
    return this.rec.finish(meta);
  }
}

// ------------------------------------------------------------------ reproducción
export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4];

export class ReplayPlayer implements SessionReplica {
  readonly reader: FrameReader;
  /** Instante dibujado (s del host). */
  t: number;
  playing = true;
  speed = 1;
  /** Eventos (sonidos, efectos) al reproducir hacia adelante. */
  onEvent: (e: NetEvent) => void = () => {};
  /** Llegó al final. */
  onEnd: () => void = () => {};
  private applier: SnapshotApplier;
  private slowIdx = -2;
  private evIdx = 0;
  /** Para exportar video: avanza exactamente esto por frame (s), sin importar el reloj. */
  fixedStep = 0;

  constructor(
    private s: GameSession,
    readonly data: ReplayData,
  ) {
    this.reader = new FrameReader(data);
    this.t = this.reader.start;
    this.applier = new SnapshotApplier(s);
  }

  get start(): number {
    return this.reader.start;
  }

  get end(): number {
    return this.reader.end;
  }

  /** Reloj del match en el instante dibujado. */
  get matchTime(): number {
    return this.s.match?.t ?? 0;
  }

  seek(t: number): void {
    this.t = Math.max(this.start, Math.min(this.end, t));
    this.applier.reset();
    this.evIdx = upper(this.data.events, this.t);
    this.apply();
  }

  /** Un cuadro hacia adelante o atrás (en pausa). */
  stepFrame(dir: 1 | -1): void {
    this.playing = false;
    const i = this.reader.indexAt(this.t + 1e-4) + dir;
    this.seek(this.reader.times[Math.max(0, Math.min(this.reader.count - 1, i))]);
  }

  togglePlay(): void {
    if (!this.playing && this.t >= this.end - 1e-3) this.seek(this.start);
    this.playing = !this.playing;
  }

  update(frameDt: number): void {
    if (this.playing) {
      const prev = this.t;
      this.t = Math.min(this.end, this.t + (this.fixedStep || Math.min(frameDt, 0.1)) * this.speed);
      // sonidos y efectos de lo que pasó entre los dos instantes (no a velocidades altas)
      const ev = this.data.events;
      while (this.evIdx < ev.length && ev[this.evIdx].t <= this.t) {
        if (this.speed <= 2 && ev[this.evIdx].t > prev - 0.05) this.onEvent(ev[this.evIdx].e);
        this.evIdx++;
      }
      if (this.t >= this.end) {
        this.playing = false;
        this.onEnd();
      }
    }
    this.apply();
  }

  private apply(): void {
    const rd = this.reader;
    const i = rd.indexAt(this.t);
    const A = rd.get(i);
    const B = i + 1 < rd.count ? rd.get(i + 1) : A;
    const k = B.t > A.t ? Math.max(0, Math.min(1, (this.t - A.t) / (B.t - A.t))) : 1;
    // (get(i + 1) movió el lector: A sigue siendo válido, es el cuadro anterior en su caché)
    this.applier.apply(A, B, k, this.t);
    const j = rd.slowIndexAt(this.t);
    if (j !== this.slowIdx) {
      this.slowIdx = j;
      if (j >= 0) applySlowState(this.s, JSON.parse(this.data.slow[j].j) as SlowState);
    }
  }
}

/** Primer evento con t > x. */
function upper(ev: Array<{ t: number }>, x: number): number {
  let lo = 0;
  let hi = ev.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (ev[m].t <= x) lo = m + 1;
    else hi = m;
  }
  return lo;
}
