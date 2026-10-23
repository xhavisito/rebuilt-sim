/**
 * Torneo rápido (§10.5, §10.6): Qualifications con calendario, ranking por Ranking Score
 * y desempates de la Tabla 10-1, selección de alianzas serpentina (4 u 8 alianzas, los
 * capitanes pueden invitar a otro capitán) y Playoffs de doble eliminación con la Final al
 * mejor de 3, como en un regional. Los matches donde no juega el jugador se
 * simulan estadísticamente a partir de la "fuerza" de cada equipo (o se ven en vivo).
 * Además: ranking por categoría (anotar, defensa, pases, manejo) y selección de alianzas por
 * turnos donde el capitán invita y el equipo acepta o rechaza (§10.6: quien rechaza ya no puede
 * ser elegido).
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
  /** Pros y contras del robot (0–1, del scouting): para simular categorías y elegir alianzas. */
  traits?: TeamTraits;
}

export interface TeamTraits {
  scoring: number;
  defense: number;
  passing: number;
  driving: number;
}

/** Desempeño de un equipo en un match, por categoría. */
export interface TeamPerf {
  /** FUEL anotado en su HUB. */
  fuel: number;
  /** FUEL pasado a su ALLIANCE ZONE. */
  passes: number;
  /** Segundos defendiendo (cerca de un rival, de su lado del campo). */
  defense: number;
  /** Manejo 0–100 (recorrido, velocidad, limpieza: pocas faltas). */
  driving: number;
}

export type Category = keyof TeamPerf;
export const CATEGORIES: Category[] = ['fuel', 'defense', 'passes', 'driving'];

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
  kind: 'qual' | 'playoff' | 'final';
  red: number[]; // índices de equipo
  blue: number[];
  /** Playoffs: número de match del bracket (M1…); las repeticiones por empate comparten slot. */
  slot?: number;
  result?: { red: AllianceMatchResult; blue: AllianceMatchResult; perf?: Record<number, TeamPerf> };
}

export interface SelectionLog {
  alliance: number;
  team: number;
  accepted: boolean;
}

/** Selección de alianzas en curso (§10.6). */
export interface Selection {
  alliances: number[][];
  /** Turno en el orden serpentina (1…N, N…1). */
  turn: number;
  /** Equipos que rechazaron: ya no pueden ser elegidos. */
  declined: number[];
  log: SelectionLog[];
  /** Orden del ranking al empezar (para promover capitanes cuando uno se une a otra alianza). */
  ranking?: number[];
}

export interface Tournament {
  eventType: EventType;
  teams: TeamEntry[];
  quals: TMatch[];
  alliances: number[][] | null;
  playoffs: TMatch[];
  champion: number | null; // índice de alianza
  seed: number;
  selection?: Selection | null;
  /** Matches de otros equipos: preguntar si verlos u omitirlos siempre. */
  others?: 'ask' | 'skip';
  /**
   * Plan por fases que editó el jugador para cada uno de sus matches (id del match → filas del
   * dashboard; ver src/ai/PhasePlan.ts). Sin entrada = la sugerencia del drive coach.
   */
  matchPlans?: Record<string, unknown[]>;
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
export function simulateMatch(teams: TeamEntry[], m: TMatch, ev: EventType, rng: Rng): { red: AllianceMatchResult; blue: AllianceMatchResult; perf: Record<number, TeamPerf> } {
  const perf: Record<number, TeamPerf> = {};
  const side = (idx: number[]) => {
    let fuel = 0;
    let auto = 0;
    let tower = 0;
    for (const i of idx) {
      const s = teams[i].strength;
      const tr = teams[i].traits ?? { scoring: s, defense: 0.5, passing: 0.5, driving: 0.5 };
      // misma escala que un match jugado en el simulador (~150–250 FUEL por robot)
      const f = Math.max(0, 50 + 190 * s * (0.8 + 0.4 * tr.scoring) + rng.gauss() * 25);
      fuel += f;
      perf[i] = {
        fuel: Math.round(f),
        passes: Math.max(0, Math.round((tr.passing > 0.6 ? 26 : 8) * tr.passing * (0.5 + s) + rng.gauss() * 4)),
        defense: Math.max(0, Math.round(45 * tr.defense * (1 - tr.scoring) + rng.gauss() * 5)),
        driving: Math.round(Math.max(0, Math.min(100, 100 * (0.55 * tr.driving + 0.45 * s) + rng.gauss() * 6))),
      };
      auto += Math.max(0, 6 + 22 * s + rng.gauss() * 4);
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
  return { red: mk(r, b), blue: mk(b, r), perf };
}

/** Promedios por match de un equipo en todas las categorías (y cuántos matches con datos). */
export function teamAverages(t: Tournament, team: number): TeamPerf & { played: number } {
  const out = { fuel: 0, passes: 0, defense: 0, driving: 0, played: 0 };
  for (const m of [...t.quals, ...t.playoffs]) {
    const p = m.result?.perf?.[team];
    if (!p) continue;
    out.played++;
    for (const c of CATEGORIES) out[c] += p[c];
  }
  if (out.played) for (const c of CATEGORIES) out[c] /= out.played;
  return out;
}

/** Fila del ranking por categoría: promedio por match. */
export interface CategoryRow {
  team: number;
  value: number;
  played: number;
}

/** Ranking de una categoría (Qualifications y Playoffs con datos). */
export function categoryRankings(t: Tournament, cat: Category): CategoryRow[] {
  const sum = t.teams.map(() => ({ v: 0, n: 0 }));
  for (const m of [...t.quals, ...t.playoffs])
    for (const [k, p] of Object.entries(m.result?.perf ?? {})) {
      sum[Number(k)].v += p[cat];
      sum[Number(k)].n++;
    }
  return sum
    .map((s, team) => ({ team, value: s.n ? s.v / s.n : 0, played: s.n }))
    .sort((a, b) => b.value - a.value || a.team - b.team);
}

// ------------------------------------------------------------------ selección de alianzas

/**
 * Alianzas de los Playoffs según el tamaño del evento: 8 (como un regional) cuando alcanzan los
 * equipos para llenarlas, si no 4. Cada alianza = capitán + 2 elegidos.
 */
export function allianceCountFor(nTeams: number): 4 | 8 {
  return nTeams >= 24 ? 8 : 4;
}

/** Orden de turnos: ronda 1 de la alianza 1 a la N, ronda 2 de la N a la 1 (§10.6). */
export function serpentine(n: number): number[] {
  const up = [...Array(n).keys()];
  return [...up, ...up.slice().reverse()];
}

/** Empieza la selección: los N primeros del ranking son capitanes. */
export function beginSelection(t: Tournament, ranking: RankRow[], n: number = allianceCountFor(t.teams.length)): Selection {
  t.selection = { alliances: ranking.slice(0, n).map((r) => [r.team]), turn: 0, declined: [], log: [], ranking: ranking.map((r) => r.team) };
  return t.selection;
}

const order = (s: Selection) => serpentine(s.alliances.length);

/**
 * Capitanes que todavía se pueden invitar: en la ronda 1 un capitán puede invitar al capitán
 * de una alianza de menor seed que aún no elige (§10.6); si acepta, las alianzas de abajo suben.
 */
function invitableCaptains(s: Selection): number[] {
  const n = s.alliances.length;
  if (s.turn >= n) return [];
  const a = order(s)[s.turn];
  return s.alliances.filter((al, j) => j > a && al.length === 1 && !s.declined.includes(al[0])).map((al) => al[0]);
}

/** Equipos libres: ni en una alianza ni capitanes. */
function freeTeams(t: Tournament): number[] {
  const taken = new Set(t.selection!.alliances.flat());
  return t.teams.map((_, i) => i).filter((i) => !taken.has(i));
}

/** Equipos que hacen falta todavía: elecciones pendientes + capitanes por promover. */
const stillNeeded = (s: Selection) => order(s).length - s.turn;

/**
 * Equipos que todavía se pueden elegir (ni en una alianza ni rechazaron), más los capitanes
 * invitables. En un evento chico, si ya no alcanzan para llenar las alianzas, los que
 * rechazaron vuelven a la lista y tienen que aceptar (`mustAccept`).
 */
export function availableTeams(t: Tournament): number[] {
  const s = t.selection!;
  const free = freeTeams(t);
  const open = free.filter((i) => !s.declined.includes(i));
  return [...(open.length >= stillNeeded(s) ? open : free), ...invitableCaptains(s)];
}

/**
 * ¿El equipo tiene que aceptar? Si ya rechazó antes y volvió a la lista, o si rechazar dejaría
 * alguna alianza incompleta (evento sin equipos de sobra). Un capitán siempre puede rechazar
 * (sigue como capitán de su alianza, pero ya no se le puede volver a invitar).
 */
export function mustAccept(t: Tournament, team: number): boolean {
  const s = t.selection!;
  if (s.alliances.some((al) => al[0] === team)) return false;
  if (s.declined.includes(team)) return true;
  const others = freeTeams(t).filter((i) => i !== team && !s.declined.includes(i)).length;
  return others < stillNeeded(s);
}

/** Alianza que elige ahora (índice 0–N−1), o null si terminó. */
export function selectionTurn(t: Tournament): number | null {
  const s = t.selection;
  if (!s || s.turn >= order(s).length || !availableTeams(t).length) return null;
  return order(s)[s.turn];
}

/**
 * Elección de un capitán de la IA: el mejor disponible por fuerza, con un extra por lo que le
 * falta a su alianza (si nadie anota mucho, busca anotador; si nadie defiende, defensor…).
 */
export function aiPick(t: Tournament, alliance: number): number {
  const s = t.selection!;
  const mine = s.alliances[alliance].map((i) => t.teams[i]);
  const keys: Array<keyof TeamTraits> = ['scoring', 'defense', 'passing', 'driving'];
  const have = Object.fromEntries(keys.map((k) => [k, Math.max(...mine.map((m) => m.traits?.[k] ?? 0.5))])) as Record<keyof TeamTraits, number>;
  const value = (i: number) => {
    const tm = t.teams[i];
    const gap = Math.max(...keys.map((k) => (tm.traits?.[k] ?? 0.5) - have[k]));
    return tm.strength * 0.75 + Math.max(0, gap) * 0.25;
  };
  return availableTeams(t).sort((a, b) => value(b) - value(a))[0];
}

/**
 * ¿Un equipo de la IA acepta la invitación? Casi siempre; un equipo bastante mejor que el
 * capitán que lo invita a veces rechaza (espera una mejor oferta). Un capitán invitado acepta
 * si le conviene más unirse que encabezar su propia alianza.
 */
export function aiAccepts(t: Tournament, team: number, alliance: number, rng: Rng): boolean {
  if (mustAccept(t, team)) return true;
  const cap = t.teams[t.selection!.alliances[alliance][0]];
  const isCaptain = t.selection!.alliances.some((al) => al[0] === team);
  const base = isCaptain ? 0.25 : 0.06;
  const pDecline = Math.max(0.03, Math.min(isCaptain ? 0.85 : 0.45, base + 0.9 * (t.teams[team].strength - cap.strength)));
  return rng.next() >= pDecline;
}

/** Registra la respuesta a una invitación y avanza el turno si aceptó. */
export function respondInvite(t: Tournament, team: number, alliance: number, accepted: boolean): void {
  const s = t.selection!;
  accepted ||= mustAccept(t, team);
  s.log.push({ alliance, team, accepted });
  const capOf = s.alliances.findIndex((al, j) => j !== alliance && al[0] === team);
  if (!accepted) {
    // Ya no puede ser elegido (§10.6); un capitán que rechaza sigue siendo capitán
    s.declined.push(team);
    return;
  }
  s.alliances[alliance].push(team);
  s.turn++;
  if (capOf >= 0) {
    // Su alianza desaparece, las de abajo suben un lugar y el siguiente del ranking que no esté
    // en una alianza pasa a ser capitán de la última (puede ser uno que rechazó, §10.6)
    s.alliances.splice(capOf, 1);
    const taken = new Set(s.alliances.flat());
    const rank = s.ranking ?? t.teams.map((_, i) => i);
    const next = rank.find((i) => !taken.has(i));
    if (next !== undefined) {
      s.alliances.push([next]);
      s.declined = s.declined.filter((d) => d !== next);
    }
  }
}

/** Cierra la selección y arma el bracket de los Playoffs. */
export function finishSelection(t: Tournament): void {
  t.alliances = t.selection!.alliances;
  startPlayoffs(t);
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

/** Selección automática (sin rechazos): los capitanes eligen al mejor disponible en serpentina. */
export function selectAlliances(t: Tournament, ranking: RankRow[], n: number = allianceCountFor(t.teams.length)): number[][] {
  const captains = ranking.slice(0, n).map((r) => r.team);
  const alliances = captains.map((c) => [c]);
  const available = ranking.map((r) => r.team).filter((x) => !captains.includes(x));
  available.sort((a, b) => t.teams[b].strength - t.teams[a].strength);
  for (const a of serpentine(n)) {
    const pick = available.shift();
    if (pick !== undefined) alliances[a].push(pick);
  }
  return alliances;
}

// ------------------------------------------------------------------ Playoffs (doble eliminación)

/** De dónde sale cada lado de un match del bracket: un seed, o el ganador / perdedor de otro match. */
export type BracketSrc = { seed: number } | { w: number } | { l: number };

export interface BracketSlot {
  /** Número de match del bracket (M1…). */
  n: number;
  round: number;
  /** Llave inferior (quien pierde aquí queda eliminado). */
  lower: boolean;
  red: BracketSrc;
  blue: BracketSrc;
}

export interface BracketFormat {
  slots: BracketSlot[];
  /** Matches cuyos ganadores juegan la Final (ganador de la llave superior = rojo). */
  finals: { red: number; blue: number };
}

const S = (n: number, round: number, lower: boolean, red: BracketSrc, blue: BracketSrc): BracketSlot => ({ n, round, lower, red, blue });

/**
 * Bracket de doble eliminación de 8 alianzas (el de FRC desde 2023): 13 matches y la Final
 * al mejor de 3. Los cruces de la ronda 3 (perdedor de M7 vs ganador de M6, perdedor de M8 vs
 * ganador de M5) evitan repetir enfrentamientos.
 */
export const DOUBLE_ELIM_8: BracketFormat = {
  slots: [
    S(1, 1, false, { seed: 1 }, { seed: 8 }),
    S(2, 1, false, { seed: 4 }, { seed: 5 }),
    S(3, 1, false, { seed: 2 }, { seed: 7 }),
    S(4, 1, false, { seed: 3 }, { seed: 6 }),
    S(5, 2, true, { l: 1 }, { l: 2 }),
    S(6, 2, true, { l: 3 }, { l: 4 }),
    S(7, 2, false, { w: 1 }, { w: 2 }),
    S(8, 2, false, { w: 3 }, { w: 4 }),
    S(9, 3, true, { l: 7 }, { w: 6 }),
    S(10, 3, true, { l: 8 }, { w: 5 }),
    S(11, 4, false, { w: 7 }, { w: 8 }),
    S(12, 4, true, { w: 10 }, { w: 9 }),
    S(13, 5, true, { l: 11 }, { w: 12 }),
  ],
  finals: { red: 11, blue: 13 },
};

/** Doble eliminación de 4 alianzas (eventos chicos): 5 matches y la Final al mejor de 3. */
export const DOUBLE_ELIM_4: BracketFormat = {
  slots: [
    S(1, 1, false, { seed: 1 }, { seed: 4 }),
    S(2, 1, false, { seed: 2 }, { seed: 3 }),
    S(3, 2, true, { l: 1 }, { l: 2 }),
    S(4, 2, false, { w: 1 }, { w: 2 }),
    S(5, 3, true, { l: 4 }, { w: 3 }),
  ],
  finals: { red: 4, blue: 5 },
};

export const bracketFor = (nAlliances: number): BracketFormat => (nAlliances >= 8 ? DOUBLE_ELIM_8 : DOUBLE_ELIM_4);

/** Victorias necesarias en la Final (mejor de 3). */
export const FINALS_WINS = 2;

/**
 * Ganador de un match de Playoffs. Supuesto (ver docs/PLAN.md): un empate se desempata con los
 * mismos criterios de la Tabla 10-1 (puntos sin faltas, FUEL de AUTO, puntos de TOWER); si
 * persiste, el match se repite. null = empate total o sin resultado.
 */
export function playoffWinner(m: TMatch): 'red' | 'blue' | null {
  const r = m.result;
  if (!r) return null;
  const keys: Array<keyof AllianceMatchResult> = ['score', 'noFoul', 'autoFuel', 'tower'];
  for (const k of keys) if (r.red[k] !== r.blue[k]) return r.red[k] > r.blue[k] ? 'red' : 'blue';
  return null;
}

/** Crea el primer round del bracket. */
export function startPlayoffs(t: Tournament): void {
  t.playoffs = [];
  t.champion = null;
  advancePlayoffs(t);
}

/** Índice de alianza (0–N−1) de un lado de un match de Playoffs. */
export function allianceIndexOf(t: Tournament, side: number[]): number {
  return t.alliances!.findIndex((a) => a[0] === side[0]);
}

/** Resultado de un slot del bracket: alianzas (índices) ganadora y perdedora. */
interface SlotOutcome {
  w: number;
  l: number;
}

/** Estado del bracket calculado a partir de los matches jugados. */
export interface BracketState {
  format: BracketFormat;
  /** Alianzas de cada lado por slot (si ya se conocen). */
  sides: Map<number, { red?: number; blue?: number }>;
  outcomes: Map<number, SlotOutcome>;
  /** Victorias en la Final por alianza (índice). */
  finalsWins: Map<number, number>;
  finalists: { red?: number; blue?: number };
}

export function bracketState(t: Tournament): BracketState {
  const format = bracketFor(t.alliances?.length ?? 4);
  const sides = new Map<number, { red?: number; blue?: number }>();
  const outcomes = new Map<number, SlotOutcome>();
  const resolve = (src: BracketSrc): number | undefined => {
    if ('seed' in src) return src.seed - 1 < (t.alliances?.length ?? 0) ? src.seed - 1 : undefined;
    const o = outcomes.get('w' in src ? src.w : src.l);
    return o ? ('w' in src ? o.w : o.l) : undefined;
  };
  for (const slot of format.slots) {
    const s = { red: resolve(slot.red), blue: resolve(slot.blue) };
    sides.set(slot.n, s);
    if (s.red === undefined || s.blue === undefined) continue;
    const last = t.playoffs.filter((m) => m.slot === slot.n).pop();
    const w = last && playoffWinner(last);
    if (!last || !w) continue;
    // El lado del match guardado manda (por si los colores no siguen el slot)
    const winA = allianceIndexOf(t, last[w]);
    outcomes.set(slot.n, { w: winA, l: winA === s.red ? s.blue : s.red });
  }
  const finalists = { red: outcomes.get(format.finals.red)?.w, blue: outcomes.get(format.finals.blue)?.w };
  const finalsWins = new Map<number, number>();
  for (const m of t.playoffs)
    if (m.kind === 'final') {
      const w = playoffWinner(m);
      if (!w) continue;
      const a = allianceIndexOf(t, m[w]);
      finalsWins.set(a, (finalsWins.get(a) ?? 0) + 1);
    }
  return { format, sides, outcomes, finalsWins, finalists };
}

/**
 * Avanza el bracket: crea los matches cuyos dos lados ya se conocen (en el orden del bracket),
 * repite los empates, arma la Final y la juega al mejor de 3 (más matches si hay empates), o
 * declara campeón.
 */
export function advancePlayoffs(t: Tournament): void {
  if (!t.alliances || t.champion !== null) return;
  const st = bracketState(t);
  const al = t.alliances;
  for (const slot of st.format.slots) {
    const s = st.sides.get(slot.n)!;
    if (s.red === undefined || s.blue === undefined || st.outcomes.has(slot.n)) continue;
    const ms = t.playoffs.filter((m) => m.slot === slot.n);
    const last = ms[ms.length - 1];
    if (last && !last.result) continue;
    // Sin match todavía, o empate total: (re)programa el match
    t.playoffs.push({ id: ms.length ? `M${slot.n}-R${ms.length}` : `M${slot.n}`, kind: 'playoff', slot: slot.n, red: al[s.red], blue: al[s.blue] });
  }
  // Se juegan en orden de número de match (M5 antes que M7 aunque se conozca después)
  t.playoffs.sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
  const { red, blue } = st.finalists;
  if (red === undefined || blue === undefined) return;
  for (const [a, w] of st.finalsWins)
    if (w >= FINALS_WINS) {
      t.champion = a;
      return;
    }
  const finals = t.playoffs.filter((m) => m.kind === 'final');
  if (finals.some((m) => !m.result)) return;
  t.playoffs.push({ id: `F${finals.length + 1}`, kind: 'final', red: al[red], blue: al[blue] });
}

/**
 * Lugar final de cada alianza (índice → lugar): 1 campeón, 2 finalista, 3 perdedor de M13,
 * 4 de M12, 5–6 de M9/M10, 7–8 de M5/M6 (8 alianzas; con 4: 3 = M5, 4 = M3). Las alianzas que
 * siguen en juego no aparecen.
 */
export function placements(t: Tournament): Map<number, number> {
  const out = new Map<number, number>();
  if (!t.alliances) return out;
  const st = bracketState(t);
  const lowers = st.format.slots.filter((s) => s.lower).sort((a, b) => b.n - a.n);
  // los perdedores de la llave inferior quedan eliminados; empatan en lugar los de la misma ronda
  let place = 3;
  const byRound = new Map<number, number[]>();
  for (const s of lowers) byRound.set(s.round, [...(byRound.get(s.round) ?? []), s.n]);
  for (const [, ns] of [...byRound].sort((a, b) => b[0] - a[0])) {
    for (const n of ns) {
      const o = st.outcomes.get(n);
      if (o) out.set(o.l, place);
    }
    place += ns.length;
  }
  if (t.champion !== null) {
    out.set(t.champion, 1);
    const { red, blue } = st.finalists;
    const other = t.champion === red ? blue : red;
    if (other !== undefined) out.set(other, 2);
  }
  return out;
}

/** Crea un torneo con el equipo del jugador y `n − 1` equipos de la IA. */
export function createTournament(player: TeamEntry, pool: Array<Omit<TeamEntry, 'isPlayer'>>, n: number, perTeam: number, ev: EventType, rng: Rng, seed: number): Tournament {
  const teams: TeamEntry[] = [player];
  for (let i = 1; i < n; i++) teams.push({ ...pool[i % pool.length], isPlayer: false });
  return { eventType: ev, teams, quals: generateSchedule(n, perTeam, rng), alliances: null, playoffs: [], champion: null, seed };
}

/**
 * Pone al día un torneo guardado con el formato anterior (semifinales a 1 match + final): si
 * los Playoffs no habían terminado, se rehace el bracket de doble eliminación.
 */
export function migrateTournament(t: Tournament): void {
  const old = t.playoffs.some((m) => (m.kind as string) === 'semi');
  if (!old) return;
  if (t.champion === null && t.alliances) startPlayoffs(t);
  else for (const m of t.playoffs) if ((m.kind as string) === 'semi') m.kind = 'playoff';
}
