/**
 * Estratega: analiza un match (tus 3 robots contra los 3 rivales) como lo haría el estratega de
 * un equipo finalista: pros y contras de cada robot, predicción, roles por SHIFT (quién anota,
 * quién acapara/alimenta, quién defiende y a quién), plan de AUTO sin choques y si conviene
 * ganar el AUTO, plan de END GAME (TOWER y TRAVERSAL) y lo que falta para cada RP.
 *
 * Experiencia que aplica (REBUILT 2026):
 * - Quien anota MÁS FUEL en AUTO deja su HUB inactivo en SHIFT 1 → sus ventanas activas son
 *   SHIFT 2 y SHIFT 4 + END GAME (55 s seguidos). Quien pierde el AUTO tiene TRANSITION + SHIFT 1
 *   (35 s) y SHIFT 3. Con hoppers grandes y buen acaparamiento conviene la ventana larga final.
 * - En los SHIFTS inactivos no se espera: se llena, se acapara FUEL en la ALLIANCE ZONE propia
 *   (recarga rápida y menos FUEL para el rival) o se defiende al mejor anotador rival mientras su
 *   HUB está activo, soltando antes de 3 s de PIN (G418).
 * - Cada viaje cuesta ~7 s: se tira con el hopper casi lleno, salvo que se acabe la ventana.
 * - END GAME: ambos HUBS activos; trepar vale si sus puntos superan lo que anotaría en ese
 *   tiempo. TRAVERSAL se gana con los puntos de TOWER de la alianza.
 * Sin Three.js ni Rapier: se prueba en `tests/`.
 */
import { assignAutos, BUILTIN_ROUTINES, type AutoRoutine } from '../auto/AutoRoutine';
import { fitsUnderTrench, type RobotSpec } from '../config/robots';
import { RP_THRESHOLDS } from '../core/rp';
import type { EventType } from '../core/types';
import { profileFromSpec, type RobotProfile } from './Scouting';

export interface ScoutRobot {
  team: number;
  name: string;
  spec: RobotSpec;
  /** Ficha 0–1 (de la técnica o aprendida en el torneo). */
  profile?: RobotProfile;
  /** Promedios por match en el torneo (si ya jugó). */
  stats?: { fuel: number; defense: number; passes: number; driving: number; played: number };
  isPlayer?: boolean;
}

export type PlanRole = 'scorer' | 'feeder' | 'defender';

/** Clave de i18n de un pro o contra (`pro_*` / `con_*`) y sus parámetros. */
export interface Note {
  key: string;
  params?: Record<string, string | number>;
}

export interface RobotReport {
  team: number;
  name: string;
  /** FUEL esperado por match. */
  fuel: number;
  pros: Note[];
  cons: Note[];
  profile: RobotProfile;
}

export interface RobotOrders {
  team: number;
  station: 1 | 2 | 3;
  role: PlanRole;
  /** Rival que marca si defiende (número de equipo). */
  defendTeam: number | null;
  /** Nivel al que trepa en END GAME (0 = no trepa). */
  climb: 0 | 1 | 2 | 3;
  /** Rutina de AUTO (id). */
  auto: string;
  isPlayer: boolean;
}

export interface MatchPlan {
  ours: RobotReport[];
  theirs: RobotReport[];
  predicted: { ours: number; theirs: number };
  /** Probabilidad aproximada de ganar (0–1). */
  winProb: number;
  orders: RobotOrders[];
  /** ¿Conviene ganar el AUTO? */
  autoAdvice: 'win' | 'lose' | 'either';
  rp: { fuel: number; energized: boolean; supercharged: boolean; towerPts: number; traversal: boolean; th: { energized: number; supercharged: number; traversal: number } };
  /** Consejos en orden de importancia. */
  tips: Note[];
}

const TOWER_PTS = [0, 10, 20, 30] as const;

/** FUEL esperado por match de un robot (promedio del torneo si lo hay; si no, por su ficha). */
export function expectedFuel(r: ScoutRobot): number {
  const p = r.profile ?? profileFromSpec(r.spec);
  const est = 60 + 170 * p.scoring;
  if (!r.stats || r.stats.played <= 0) return est;
  // mezcla: con más matches confía más en lo observado
  const w = Math.min(1, r.stats.played / 3);
  return est * (1 - w) + r.stats.fuel * w;
}

/** Pros y contras de un robot, para el scouting. */
export function prosCons(r: ScoutRobot, field: ScoutRobot[] = []): { pros: Note[]; cons: Note[] } {
  const s = r.spec;
  const p = r.profile ?? profileFromSpec(s);
  const pros: Note[] = [];
  const cons: Note[] = [];
  // cada disparo saca de 1 a `lanes` FUEL (promedio (lanes + 1) / 2)
  const lanes = s.shooter.lanes ?? 1;
  const shots = Math.round(s.shooter.rate * ((lanes + 1) / 2));
  if (s.shooter.type === 'turret') pros.push({ key: 'pro_turret' });
  else cons.push({ key: 'con_fixed' });
  if (s.hopperCapacity >= 50) pros.push({ key: 'pro_bigHopper', params: { n: s.hopperCapacity } });
  else if (s.hopperCapacity <= 30) cons.push({ key: 'con_smallHopper', params: { n: s.hopperCapacity } });
  if (lanes >= 3) pros.push({ key: 'pro_dumper' });
  else if (shots >= 12) pros.push({ key: 'pro_fastShooter', params: { n: shots } });
  if (s.shooter.accuracy >= 0.92) pros.push({ key: 'pro_accurate' });
  else if (s.shooter.accuracy < 0.85) cons.push({ key: 'con_inaccurate' });
  if (s.maxSpeed >= 4.6) pros.push({ key: 'pro_fast' });
  else if (s.maxSpeed <= 3.8) cons.push({ key: 'con_slow' });
  if (fitsUnderTrench(s)) pros.push({ key: 'pro_trench' });
  else cons.push({ key: 'con_noTrench' });
  if (s.climb.maxLevel >= 2) pros.push({ key: 'pro_climb', params: { l: s.climb.maxLevel } });
  else if (s.climb.maxLevel === 0) cons.push({ key: 'con_noClimb' });
  if (s.massKg >= 60 && p.defense >= 0.55) pros.push({ key: 'pro_heavy' });
  else if (s.massKg < 50) cons.push({ key: 'con_light' });
  if (s.intake.widthIn >= 26 && s.intake.rate >= 12) pros.push({ key: 'pro_intake' });
  // Lo que ya demostró en el torneo (comparado con el resto del evento)
  const st = r.stats;
  if (st && st.played > 0 && field.length > 3) {
    const rank = (k: 'fuel' | 'defense' | 'passes') => field.filter((o) => (o.stats?.[k] ?? 0) > st[k]).length + 1;
    if (rank('fuel') <= 3) pros.push({ key: 'pro_topScorer', params: { n: Math.round(st.fuel) } });
    if (rank('defense') <= 3 && st.defense >= 8) pros.push({ key: 'pro_defender', params: { n: Math.round(st.defense) } });
    if (rank('passes') <= 3 && st.passes >= 5) pros.push({ key: 'pro_passer', params: { n: Math.round(st.passes) } });
    if (st.driving < 45) cons.push({ key: 'con_driving', params: { n: Math.round(st.driving) } });
  }
  return { pros, cons };
}

/** Reporte de scouting de un robot (comparado contra `field`). */
export function report(r: ScoutRobot, field: ScoutRobot[]): RobotReport {
  const { pros, cons } = prosCons(r, field);
  return { team: r.team, name: r.name, fuel: expectedFuel(r), pros, cons, profile: r.profile ?? profileFromSpec(r.spec) };
}

/** Tiempo (s) para trepar a un nivel, más ~3 s de viaje. */
const climbTime = (s: RobotSpec, l: number) => (l === 0 ? 0 : [0, s.climb.timeL1, s.climb.timeL2, s.climb.timeL3][l] + 3);

/**
 * Plan del match. `ours` y `theirs` en orden de DRIVER STATION (1, 2, 3). `routines` para el
 * plan de AUTO (por defecto, las de fábrica).
 */
export function planMatch(ours: ScoutRobot[], theirs: ScoutRobot[], ev: EventType, routines: AutoRoutine[] = BUILTIN_ROUTINES, eventField?: ScoutRobot[]): MatchPlan {
  // contra quién se compara cada robot (todo el evento si se conoce)
  const field = eventField ?? [...ours, ...theirs];
  const repO = ours.map((r) => report(r, field));
  const repT = theirs.map((r) => report(r, field));
  const th = RP_THRESHOLDS[ev];
  // ---- Roles
  const orders: RobotOrders[] = ours.map((r, i) => ({ team: r.team, station: (i + 1) as 1 | 2 | 3, role: 'scorer', defendTeam: null, climb: 0, auto: 'preload', isPlayer: !!r.isPlayer }));
  const threat = [...repT].sort((a, b) => b.fuel - a.fuel)[0];
  const byFuel = repO.map((r, i) => ({ r, i })).sort((a, b) => a.r.fuel - b.r.fuel);
  const best = byFuel[byFuel.length - 1];
  let defenderIdx = -1;
  if (threat && ours.length === 3) {
    // El que menos anota y mejor empuja: defiende si le quita al rival más de lo que deja de anotar
    const cand = byFuel.find(({ r, i }) => !ours[i].isPlayer && r.profile.defense >= 0.45) ?? byFuel.find(({ r }) => r.profile.defense >= 0.45);
    if (cand && cand !== best) {
      const gain = threat.fuel * 0.18; // le quita ~1/3 de sus SHIFTS activos
      const loss = cand.r.fuel * 0.3; // él anota menos (defiende en sus SHIFTS inactivos)
      if (gain > loss) {
        defenderIdx = cand.i;
        orders[cand.i].role = 'defender';
        orders[cand.i].defendTeam = threat.team;
      }
    }
  }
  // Alimentador / acaparador: anota mucho menos que el mejor y pasa bien
  const feeder = byFuel.find(({ r, i }) => i !== defenderIdx && i !== best.i && r.fuel < best.r.fuel * 0.62 && r.profile.passing >= 0.55);
  if (feeder && ours.length === 3) orders[feeder.i].role = 'feeder';
  // ---- END GAME: cada quien a su nivel máximo si vale más que anotar en ese tiempo
  let towerPts = 0;
  ours.forEach((r, i) => {
    const s = r.spec;
    for (let l = s.climb.maxLevel; l >= 1; l--) {
      const rate = repO[i].fuel / 100; // FUEL/s aproximados con el HUB activo
      if (TOWER_PTS[l] >= rate * climbTime(s, l) * 0.9) {
        orders[i].climb = l as 1 | 2 | 3;
        towerPts += TOWER_PTS[l];
        break;
      }
    }
  });
  // ---- AUTO: sin choques (y el que trepa L1 en AUTO suma 15)
  const autos = assignAutos(
    ours.map((r, i) => ({ station: (i + 1) as 1 | 2 | 3, canClimb: r.spec.climb.maxLevel > 0 })),
    routines,
  );
  autos.forEach((a, i) => (orders[i].auto = a));
  if (autos.includes('climb-l1')) towerPts += 15;
  // ---- Predicción (puntos ≈ FUEL + TOWER; el defensor anota menos y le quita al rival)
  let fuelO = repO.reduce((s, r) => s + r.fuel, 0);
  let fuelT = repT.reduce((s, r) => s + r.fuel, 0);
  if (defenderIdx >= 0 && threat) {
    fuelO -= repO[defenderIdx].fuel * 0.3;
    fuelT -= threat.fuel * 0.18;
  }
  const towerT = theirs.reduce((s, r) => s + TOWER_PTS[r.spec.climb.maxLevel] * 0.8, 0);
  const predO = Math.round(fuelO + towerPts * 0.85);
  const predT = Math.round(fuelT + towerT);
  const sigma = Math.max(25, 0.18 * (predO + predT) / 2);
  const winProb = 1 / (1 + Math.exp(-(predO - predT) / (sigma * 0.6)));
  // ---- ¿Ganar el AUTO? Hoppers grandes aprovechan la ventana final de 55 s (SHIFT 4 + END GAME)
  const capO = ours.reduce((s, r) => s + r.spec.hopperCapacity, 0);
  const capT = theirs.reduce((s, r) => s + r.spec.hopperCapacity, 0);
  const autoAdvice: MatchPlan['autoAdvice'] = capO > capT * 1.15 ? 'win' : capO < capT * 0.87 ? 'lose' : 'either';
  // ---- Consejos (en orden de importancia)
  const tips: Note[] = [];
  const name = (team: number) => String(team);
  tips.push({ key: winProb >= 0.5 ? 'tip_favored' : 'tip_underdog', params: { p: Math.round(winProb * 100), us: predO, them: predT } });
  if (threat) {
    const tr = theirs.find((r) => r.team === threat.team)!;
    if (defenderIdx >= 0) tips.push({ key: 'tip_defend', params: { who: name(ours[defenderIdx].team), target: name(threat.team), n: Math.round(threat.fuel) } });
    else tips.push({ key: 'tip_noDefense', params: { target: name(threat.team) } });
    // sus puntos débiles
    if (!fitsUnderTrench(tr.spec)) tips.push({ key: 'tip_blockBumps', params: { target: name(threat.team) } });
    if (tr.spec.shooter.type === 'fixed') tips.push({ key: 'tip_fixedShooter', params: { target: name(threat.team) } });
    if (tr.spec.massKg < 50) tips.push({ key: 'tip_lightTarget', params: { target: name(threat.team) } });
  }
  if (feeder) tips.push({ key: 'tip_feeder', params: { who: name(ours[feeder.i].team), to: name(ours[best.i].team) } });
  tips.push({ key: autoAdvice === 'win' ? 'tip_winAuto' : autoAdvice === 'lose' ? 'tip_loseAuto' : 'tip_eitherAuto' });
  tips.push({ key: 'tip_stockpile' });
  tips.push({ key: 'tip_bigLoads' });
  const rpFuel = Math.round(fuelO);
  const climbers = orders.filter((o) => o.climb > 0).map((o) => `${o.team} L${o.climb}`);
  if (climbers.length) tips.push({ key: towerPts >= th.traversal ? 'tip_traversalOk' : 'tip_traversalShort', params: { list: climbers.join(', '), pts: towerPts, th: th.traversal } });
  else tips.push({ key: 'tip_noClimbers' });
  if (rpFuel < th.supercharged && rpFuel >= th.supercharged * 0.8) tips.push({ key: 'tip_superchargedClose', params: { n: th.supercharged - rpFuel } });
  if (rpFuel < th.energized) tips.push({ key: 'tip_energizedShort', params: { n: th.energized - rpFuel } });
  return {
    ours: repO,
    theirs: repT,
    predicted: { ours: predO, theirs: predT },
    winProb,
    orders,
    autoAdvice,
    rp: { fuel: rpFuel, energized: rpFuel >= th.energized, supercharged: rpFuel >= th.supercharged, towerPts, traversal: towerPts >= th.traversal, th },
    tips,
  };
}
