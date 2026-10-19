/**
 * Máquina de estados del match (lógica pura): reloj, SHIFTS, estado de HUBS, puntuación,
 * faltas, tarjetas y RP. La sesión de juego la alimenta con eventos físicos (FUEL que entra
 * al HUB, evaluaciones de TOWER, faltas del árbitro) y reacciona a los eventos que emite.
 */
import { phaseAt, T } from './clock';
import { FOUL_POINTS, type CardRecord, type FoulRecord, type RuleCode } from './fouls';
import { decideFirstInactive, fuelCounts, hubActive, hubLight, isAutoFuelTime } from './hub';
import type { Rng } from './rng';
import { rankingPoints, type RpResult } from './rp';
import type { TowerResult } from './tower';
import { ALLIANCES, opponent, type Alliance, type CardType, type EventType, type FoulSeverity, type HubLight, type Phase } from './types';

export type MatchEvent =
  | { type: 'phase'; phase: Phase; prev: Phase }
  | { type: 'firstInactive'; alliance: Alliance; random: boolean }
  | { type: 'warning'; alliance: Alliance }
  | { type: 'evalAutoTower' }
  | { type: 'evalTeleopTower' }
  | { type: 'foul'; foul: FoulRecord }
  | { type: 'card'; card: CardRecord }
  | { type: 'end' };

export interface AllianceFuel {
  auto: number;
  teleop: number;
  /** FUEL que entró con el HUB inactivo (no da puntos; estadística). */
  wasted: number;
}

export class Match {
  t = -1;
  running = false;
  phase: Phase = 'PRE';
  firstInactive: Alliance | null = null;
  firstInactiveRandom = false;
  readonly fuel: Record<Alliance, AllianceFuel> = {
    red: { auto: 0, teleop: 0, wasted: 0 },
    blue: { auto: 0, teleop: 0, wasted: 0 },
  };
  readonly tower: Record<Alliance, { auto: number; teleop: number }> = {
    red: { auto: 0, teleop: 0 },
    blue: { auto: 0, teleop: 0 },
  };
  readonly fouls: FoulRecord[] = [];
  readonly cards: CardRecord[] = [];
  /** Robots DESCALIFICADOS (RED CARD). */
  readonly disqualified = new Set<number>();
  /** Muestras para la gráfica de puntos en el tiempo. */
  readonly history: Array<{ t: number; red: number; blue: number }> = [];
  autoTowerDone = false;
  teleopTowerDone = false;
  private yellows = new Map<number, number>();
  private pending: MatchEvent[] = [];
  private lastSample = -1;
  private warned = new Set<string>();

  constructor(
    readonly eventType: EventType,
    private rng: Rng,
    readonly playoff = false,
  ) {}

  start(): void {
    this.t = 0;
    this.running = true;
    this.phase = 'AUTO';
    this.pending.push({ type: 'phase', phase: 'AUTO', prev: 'PRE' });
  }

  /** Avanza el reloj y devuelve los eventos generados. */
  tick(dt: number): MatchEvent[] {
    if (this.running) {
      const prevT = this.t;
      this.t += dt;
      const p = phaseAt(this.t);
      // Avisos de desactivación (3 s antes)
      for (const a of ALLIANCES) {
        if (hubLight(this.t, a, this.firstInactive) === 'pulse' && hubLight(prevT, a, this.firstInactive) !== 'pulse') {
          const k = `${a}@${Math.round(this.t)}`;
          if (!this.warned.has(k)) {
            this.warned.add(k);
            this.pending.push({ type: 'warning', alliance: a });
          }
        }
      }
      if (p !== this.phase) {
        const prev = this.phase;
        this.phase = p;
        if (prev === 'AUTO') {
          // §6.5-C: TOWER de AUTO se evalúa al llegar a 0:00
          this.pending.push({ type: 'evalAutoTower' });
        }
        if (p === 'TRANSITION') {
          // §6.4.1: al iniciar TELEOP el FMS informa quién queda inactivo en SHIFT 1
          const d = decideFirstInactive({ red: this.fuel.red.auto, blue: this.fuel.blue.auto }, this.rng);
          this.firstInactive = d.alliance;
          this.firstInactiveRandom = d.random;
          this.pending.push({ type: 'firstInactive', alliance: d.alliance, random: d.random });
        }
        this.pending.push({ type: 'phase', phase: p, prev });
        if (p === 'DONE') {
          this.running = false;
          if (!this.teleopTowerDone) this.pending.push({ type: 'evalTeleopTower' });
          this.pending.push({ type: 'end' });
        }
      }
      if (this.t - this.lastSample >= 1) {
        this.lastSample = this.t;
        this.history.push({ t: this.t, red: this.score('red'), blue: this.score('blue') });
      }
    }
    const out = this.pending;
    this.pending = [];
    return out;
  }

  get timer(): number {
    return this.t;
  }

  isHubActive(a: Alliance): boolean {
    return hubActive(this.phase, a, this.firstInactive);
  }

  light(a: Alliance): HubLight {
    return hubLight(this.t, a, this.firstInactive);
  }

  /**
   * Un FUEL cruzó el sensor del HUB de `hub`. Devuelve si dio punto y si cuenta como AUTO.
   * (FUEL en HUB activo = 1 punto en AUTO y en TELEOP.)
   */
  fuelEntered(hub: Alliance): { counted: boolean; auto: boolean } {
    if (!this.running && this.phase !== 'POST') return { counted: false, auto: false };
    const auto = isAutoFuelTime(this.t);
    const counted = fuelCounts(this.t, hub, this.firstInactive);
    if (counted) {
      if (auto) this.fuel[hub].auto++;
      else this.fuel[hub].teleop++;
    } else this.fuel[hub].wasted++;
    return { counted, auto };
  }

  addFoul(rule: RuleCode, severity: FoulSeverity, offender: Alliance, robot: number, note?: string): FoulRecord {
    const f: FoulRecord = { rule, severity, offender, robot, time: this.t, note };
    this.fouls.push(f);
    this.pending.push({ type: 'foul', foul: f });
    return f;
  }

  /** YELLOW + YELLOW = RED (§6.6.1). RED → DESCALIFICADO. */
  addCard(card: CardType, offender: Alliance, robot: number, rule: RuleCode): CardRecord {
    let c: CardType = card;
    if (card === 'YELLOW') {
      const n = (this.yellows.get(robot) ?? 0) + 1;
      this.yellows.set(robot, n);
      if (n >= 2) c = 'RED';
    }
    if (c === 'RED') this.disqualified.add(robot);
    const rec: CardRecord = { card: c, offender, robot, rule, time: this.t };
    this.cards.push(rec);
    this.pending.push({ type: 'card', card: rec });
    return rec;
  }

  setAutoTower(r: TowerResult): void {
    this.autoTowerDone = true;
    for (const a of ALLIANCES) this.tower[a].auto = r.byAlliance[a];
  }

  setTeleopTower(r: TowerResult): void {
    this.teleopTowerDone = true;
    for (const a of ALLIANCES) this.tower[a].teleop = r.byAlliance[a];
  }

  /** Puntos que recibe `a` por las faltas del oponente. */
  foulPointsFor(a: Alliance): number {
    let s = 0;
    for (const f of this.fouls) if (f.offender === opponent(a)) s += FOUL_POINTS[f.severity];
    return s;
  }

  fuelPoints(a: Alliance): number {
    return this.fuel[a].auto + this.fuel[a].teleop;
  }

  towerPoints(a: Alliance): number {
    return this.tower[a].auto + this.tower[a].teleop;
  }

  /** En Playoffs una RED CARD deja a la alianza con 0 puntos (§6.6.3). */
  allianceDisqualified(a: Alliance, robotsOf: (a: Alliance) => number[]): boolean {
    return this.playoff && robotsOf(a).some((r) => this.disqualified.has(r));
  }

  score(a: Alliance): number {
    return this.fuelPoints(a) + this.towerPoints(a) + this.foulPointsFor(a);
  }

  rp(a: Alliance, robotDisqualified = false): RpResult {
    return rankingPoints(
      {
        fuel: this.fuelPoints(a),
        towerPoints: this.towerPoints(a),
        score: this.score(a),
        opponentScore: this.score(opponent(a)),
      },
      this.eventType,
      robotDisqualified,
    );
  }

  /** Atajo para pruebas: salta a un instante del match. */
  seek(t: number): MatchEvent[] {
    if (!this.running) this.start();
    const out: MatchEvent[] = [];
    while (this.t < t) out.push(...this.tick(Math.min(0.05, t - this.t)));
    return out;
  }
}

export { T };
