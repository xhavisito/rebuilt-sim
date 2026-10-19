/**
 * Torneo rápido (§10.5, §10.6): Qualifications con calendario, ranking por Ranking Score
 * y desempates de la Tabla 10-1, selección de alianzas serpentina y Playoffs
 * (semifinales a 1 match, final al mejor de 3). Los matches donde no juega el jugador se
 * simulan estadísticamente a partir de la "fuerza" de cada equipo.
 */
import type { Rng } from './rng';
import { rankingPoints } from './rp';
import type { EventType } from './types';

export interface TeamEntry {
  team: number;
  specId: string;
  name: string;
  /** 0–1: calidad del equipo para la simulación estadística. */
  strength: number;
  isPlayer: boolean;
}

export interface AllianceMatchResult {
  score: number;
  /** Puntos sin faltas (2º criterio de desempate). */
  noFoul: number;
  autoFuel: number;
  tower: number;
  rp: number;
}

export interface TMatch {
  id: string;
  kind: 'qual' | 'semi' | 'final';
  red: number[]; // índices de equipo
  blue: number[];
  result?: { red: AllianceMatchResult; blue: AllianceMatchResult };
}

export interface Tournament {
  eventType: EventType;
  teams: TeamEntry[];
  quals: TMatch[];
  alliances: number[][] | null;
  playoffs: TMatch[];
  champion: number | null; // índice de alianza
  seed: number;
}

/** Calendario: cada equipo juega `perTeam` matches; se evita repetir compañeros cuando se puede. */
export function generateSchedule(nTeams: number, perTeam: number, rng: Rng): TMatch[] {
  const total = Math.ceil((nTeams * perTeam) / 6);
  const played = new Array(nTeams).fill(0);
  const partners = new Set<string>();
  const out: TMatch[] = [];
  for (let m = 0; m < total; m++) {
    // los que menos han jugado primero (con desempate aleatorio)
    const order = rng.shuffle([...Array(nTeams).keys()]).sort((a, b) => played[a] - played[b]);
    const pick = order.slice(0, 6);
    // reparte buscando compañeros nuevos
    let best: number[] = pick;
    let bestRep = Infinity;
    for (let k = 0; k < 12; k++) {
      const p = rng.shuffle([...pick]);
      let rep = 0;
      for (const side of [p.slice(0, 3), p.slice(3)])
        for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (partners.has(key(side[i], side[j]))) rep++;
      if (rep < bestRep) {
        bestRep = rep;
        best = p;
      }
    }
    const red = best.slice(0, 3);
    const blue = best.slice(3);
    for (const side of [red, blue]) for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) partners.add(key(side[i], side[j]));
    for (const t of best) played[t]++;
    out.push({ id: `Q${m + 1}`, kind: 'qual', red, blue });
  }
  return out;
}

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Simulación estadística de un match entre dos alianzas. */
export function simulateMatch(teams: TeamEntry[], m: TMatch, ev: EventType, rng: Rng): { red: AllianceMatchResult; blue: AllianceMatchResult } {
  const side = (idx: number[]) => {
    let fuel = 0;
    let auto = 0;
    let tower = 0;
    for (const i of idx) {
      const s = teams[i].strength;
      fuel += Math.max(0, 25 + 95 * s + rng.gauss() * 14);
      auto += Math.max(0, 3 + 12 * s + rng.gauss() * 3);
      tower += rng.next() < 0.3 + 0.6 * s ? (s > 0.75 ? 30 : s > 0.5 ? 20 : 10) : 0;
    }
    const fouls = Math.max(0, Math.round(rng.gauss() * 8 + 6));
    return { fuel: Math.round(fuel), auto: Math.round(auto), tower, fouls };
  };
  const r = side(m.red);
  const b = side(m.blue);
  const mk = (me: typeof r, op: typeof r): AllianceMatchResult => {
    const noFoul = me.fuel + me.tower;
    const score = noFoul + op.fouls;
    const opScore = op.fuel + op.tower + me.fouls;
    return { score, noFoul, autoFuel: me.auto, tower: me.tower, rp: rankingPoints({ fuel: me.fuel, towerPoints: me.tower, score, opponentScore: opScore }, ev).total };
  };
  return { red: mk(r, b), blue: mk(b, r) };
}

export interface RankRow {
  team: number; // índice
  played: number;
  rpTotal: number;
  rs: number;
  avgNoFoul: number;
  avgAuto: number;
  avgTower: number;
  rand: number;
}

/** Ranking de Qualifications según la Tabla 10-1. */
export function rankings(t: Tournament, rng: Rng): RankRow[] {
  const rows: RankRow[] = t.teams.map((_, i) => ({ team: i, played: 0, rpTotal: 0, rs: 0, avgNoFoul: 0, avgAuto: 0, avgTower: 0, rand: rng.next() }));
  for (const m of t.quals) {
    if (!m.result) continue;
    for (const [idx, res] of [
      [m.red, m.result.red],
      [m.blue, m.result.blue],
    ] as const)
      for (const i of idx) {
        const r = rows[i];
        r.played++;
        r.rpTotal += res.rp;
        r.avgNoFoul += res.noFoul;
        r.avgAuto += res.autoFuel;
        r.avgTower += res.tower;
      }
  }
  for (const r of rows) {
    const n = Math.max(1, r.played);
    r.rs = Math.round((r.rpTotal / n) * 100) / 100; // redondeado a 2 decimales (§10.5.3)
    r.avgNoFoul /= n;
    r.avgAuto /= n;
    r.avgTower /= n;
  }
  return rows.sort((a, b) => b.rs - a.rs || b.avgNoFoul - a.avgNoFoul || b.avgAuto - a.avgAuto || b.avgTower - a.avgTower || b.rand - a.rand);
}

/** Selección de alianzas: 4 capitanes (top 4) eligen en serpentina 1-2-3-4-4-3-2-1. */
export function selectAlliances(t: Tournament, ranking: RankRow[]): number[][] {
  const captains = ranking.slice(0, 4).map((r) => r.team);
  const alliances = captains.map((c) => [c]);
  const available = ranking.map((r) => r.team).filter((x) => !captains.includes(x));
  // los capitanes eligen al mejor disponible por fuerza (la IA de selección)
  available.sort((a, b) => t.teams[b].strength - t.teams[a].strength);
  const order = [0, 1, 2, 3, 3, 2, 1, 0];
  for (const a of order) {
    const pick = available.shift();
    if (pick !== undefined) alliances[a].push(pick);
  }
  return alliances;
}

/** Crea las semifinales (1 vs 4, 2 vs 3). */
export function startPlayoffs(t: Tournament): void {
  const a = t.alliances!;
  t.playoffs = [
    { id: 'SF1', kind: 'semi', red: a[0], blue: a[3] },
    { id: 'SF2', kind: 'semi', red: a[1], blue: a[2] },
  ];
}

/** Índice de alianza (0–3) de un lado de un match de Playoffs. */
export function allianceIndexOf(t: Tournament, side: number[]): number {
  return t.alliances!.findIndex((a) => a[0] === side[0]);
}

/** Avanza el bracket: crea la final o la siguiente partida, o declara campeón. */
export function advancePlayoffs(t: Tournament): void {
  const semis = t.playoffs.filter((m) => m.kind === 'semi');
  if (semis.some((m) => !m.result)) return;
  const finals = t.playoffs.filter((m) => m.kind === 'final');
  const winner = (m: TMatch) => (m.result!.red.score >= m.result!.blue.score ? m.red : m.blue);
  if (!finals.length) {
    const [a, b] = semis.map(winner);
    t.playoffs.push({ id: 'F1', kind: 'final', red: a, blue: b });
    return;
  }
  if (finals.some((m) => !m.result)) return;
  // final al mejor de 3
  const first = finals[0];
  let wr = 0;
  let wb = 0;
  for (const f of finals) {
    const redSide = f.red[0] === first.red[0] ? 'red' : 'blue';
    const redWon = f.result!.red.score >= f.result!.blue.score;
    if ((redWon && redSide === 'red') || (!redWon && redSide === 'blue')) wr++;
    else wb++;
  }
  if (wr >= 2 || wb >= 2) t.champion = allianceIndexOf(t, wr >= 2 ? first.red : first.blue);
  else t.playoffs.push({ id: `F${finals.length + 1}`, kind: 'final', red: first.red, blue: first.blue });
}

/** Crea un torneo con el equipo del jugador y `n − 1` equipos de la IA. */
export function createTournament(player: TeamEntry, pool: Array<Omit<TeamEntry, 'isPlayer'>>, n: number, perTeam: number, ev: EventType, rng: Rng, seed: number): Tournament {
  const teams: TeamEntry[] = [player];
  for (let i = 1; i < n; i++) teams.push({ ...pool[i % pool.length], isPlayer: false });
  return { eventType: ev, teams, quals: generateSchedule(n, perTeam, rng), alliances: null, playoffs: [], champion: null, seed };
}
