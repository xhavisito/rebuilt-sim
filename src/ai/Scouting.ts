/**
 * Scouting de la IA: cada alianza conoce los pros y contras de cada robot (el suyo, sus
 * compañeros y los rivales) y los usa en su estrategia. Parte de la ficha técnica (lo que se ve
 * en el pit: shooter, turret, hopper, intake, velocidad, peso, si pasa por el TRENCH, climb) y
 * aprende durante el match de lo que observa (FUEL anotado por segundo, puntería, ritmo de
 * recolección). Sin Three.js ni Rapier: se prueba en `tests/`.
 */
import { fitsUnderTrench, type RobotSpec } from '../config/robots';

/** Calificaciones 0–1 (1 = de lo mejor del evento). */
export interface RobotProfile {
  /** Anotar: cadencia, puntería, capacidad, turret (tira en movimiento). */
  scoring: number;
  /** Recoger: ancho y ritmo de la intake, velocidad. */
  collecting: number;
  /** Defender: peso, empuje (tracción, tanque), velocidad. */
  defense: number;
  /** Pasar a su ALLIANCE ZONE: shooter con buen rango, turret, hopper. */
  passing: number;
  /** Moverse por el campo: velocidad, aceleración, TRENCH. */
  driving: number;
  /** Nivel máximo de climb (0–3) / 3. */
  climb: number;
}

export type ProfileKey = keyof RobotProfile;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Lo que se sabe de un robot antes de verlo jugar (su ficha técnica). */
export function profileFromSpec(s: RobotSpec): RobotProfile {
  const turret = s.shooter.type === 'turret';
  const shots = s.shooter.rate * (s.shooter.lanes ?? 1);
  const scoring = clamp01(0.35 * clamp01(shots / 14) + 0.3 * clamp01((s.shooter.accuracy - 0.6) / 0.38) + 0.2 * clamp01(s.hopperCapacity / 60) + (turret ? 0.15 : 0));
  const collecting = clamp01(0.4 * clamp01(s.intake.widthIn / 28) + 0.35 * clamp01(s.intake.rate / 14) + 0.25 * clamp01(s.maxSpeed / 5));
  const defense = clamp01(0.45 * clamp01((s.massKg - 40) / 30) + 0.25 * clamp01(s.traction / 1.3) + 0.2 * clamp01(s.maxSpeed / 5) + (s.drivetrain === 'tank' ? 0.1 : 0));
  const passing = clamp01(0.45 * clamp01(s.shooter.maxSpeed / 14) + 0.25 * clamp01(s.hopperCapacity / 50) + (turret ? 0.3 : 0.1));
  const driving = clamp01(0.45 * clamp01(s.maxSpeed / 5) + 0.3 * clamp01(s.maxAccel / 10) + (fitsUnderTrench(s) ? 0.25 : 0.1));
  return { scoring, collecting, defense, passing, driving, climb: s.climb.maxLevel / 3 };
}

/** Lo observado de un robot en el match (lo alimenta la sesión). */
export interface RobotObservation {
  /** FUEL anotado y tirado por el robot. */
  scored: number;
  shot: number;
  /** FUEL recogido. */
  intaked: number;
  /** Segundos que su HUB estuvo activo (para el ritmo de anotación). */
  activeSeconds: number;
  /** Segundos jugados (TELEOP y AUTO). */
  seconds: number;
}

/**
 * Ficha aprendida: mezcla la ficha técnica con lo observado; cuanto más ve, más confía en lo
 * observado (hasta 70 %).
 */
export function learnedProfile(base: RobotProfile, o: RobotObservation): RobotProfile {
  const w = clamp01(o.seconds / 90) * 0.7;
  if (w <= 0) return { ...base };
  const accuracy = o.shot > 4 ? o.scored / o.shot : 0.8;
  // ~1.6 FUEL/s con el HUB activo es de lo mejor; la puntería pesa aparte
  const rate = o.activeSeconds > 5 ? o.scored / o.activeSeconds : base.scoring * 1.6;
  const scoringObs = clamp01(0.7 * clamp01(rate / 1.6) + 0.3 * clamp01((accuracy - 0.5) / 0.45));
  const collectingObs = clamp01(o.intaked / Math.max(1, o.seconds) / 1.6);
  return {
    ...base,
    scoring: base.scoring * (1 - w) + scoringObs * w,
    collecting: base.collecting * (1 - w) + collectingObs * w,
  };
}

/** Rol dinámico que la alianza le da a un robot de la IA. */
export type DynRole = 'scorer' | 'feeder' | 'defender';

export interface BrainMember {
  index: number;
  profile: RobotProfile;
  /** ¿Lo controla la IA y su rol es automático? (los demás no se reasignan) */
  free: boolean;
  /** Rol fijo de la estrategia o del jugador (para contarlo en el reparto). */
  fixed?: DynRole;
}

export interface BrainSituation {
  /** ¿El HUB propio cuenta ahora? ¿y el del rival? */
  ownActive: boolean;
  oppActive: boolean;
  endgame: boolean;
  /** Amenaza del mejor anotador rival (0–1: su `scoring` por qué tan lleno viene). */
  oppThreat: number;
}

/**
 * Reparte roles de una alianza según los pros y contras de cada robot y el momento:
 * - Con el HUB propio activo (o en END GAME) todos anotan: es cuando cada FUEL vale.
 * - Con el propio apagado y el rival activo, el que menos anota y mejor empuja defiende al
 *   anotador rival más peligroso, si vale la pena (la amenaza supera lo que él aportaría
 *   anotando) y quedan al menos dos anotando.
 * - Un robot que anota poco pero pasa bien alimenta a la ALLIANCE ZONE si hay un compañero que
 *   anota mucho más (el FUEL que le pasa vale más en sus manos).
 */
export function assignRoles(members: BrainMember[], s: BrainSituation): Map<number, DynRole> {
  const out = new Map<number, DynRole>();
  for (const m of members) out.set(m.index, m.fixed ?? 'scorer');
  const free = members.filter((m) => m.free && !m.fixed);
  if (!free.length || s.endgame) return out;
  const best = Math.max(...members.map((m) => m.profile.scoring));
  const taken = (r: DynRole) => members.some((m) => out.get(m.index) === r);
  // Defensa: solo con el HUB propio apagado y el rival activo
  if (!s.ownActive && s.oppActive && !taken('defender') && members.length >= 3) {
    const value = (m: BrainMember) => m.profile.defense * 1.2 - m.profile.scoring;
    const cand = [...free].sort((a, b) => value(b) - value(a))[0];
    const scorersLeft = members.filter((m) => m !== cand && (out.get(m.index) ?? 'scorer') === 'scorer').length;
    if (cand && scorersLeft >= 2 && s.oppThreat > cand.profile.scoring * 0.8 && cand.profile.defense >= 0.45) out.set(cand.index, 'defender');
  }
  // Alimentador: el que anota claramente menos que el mejor y pasa bien
  if (!taken('feeder')) {
    const pool = free.filter((m) => out.get(m.index) === 'scorer');
    const cand = [...pool].sort((a, b) => a.profile.scoring - a.profile.passing * 0.5 - (b.profile.scoring - b.profile.passing * 0.5))[0];
    if (cand && members.length >= 3 && cand.profile.scoring < best * 0.62 && cand.profile.passing >= 0.5) out.set(cand.index, 'feeder');
  }
  return out;
}

/** Categorías para el ranking del torneo (0–1). */
export const CATEGORY_KEYS: ProfileKey[] = ['scoring', 'defense', 'passing', 'driving'];
