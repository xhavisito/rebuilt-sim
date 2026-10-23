/**
 * Niveles de dificultad de la IA (puro, sin Three.js ni Rapier).
 *
 * Cada nivel cambia cómo maneja, cuánto piensa y qué tan bien tira, y además qué tan lista es su
 * defensa y cómo reacciona cuando la defienden:
 * - Fácil: principiante. No aprende (sin memoria), no reparte roles y no juega defensa salvo que
 *   la estrategia se lo pida; cuando defiende persigue al rival y apura el conteo de PIN.
 * - Normal: defiende cuando le conviene a la alianza (HUB propio apagado y el rival activo) y se
 *   interpone entre el rival y su HUB.
 * - Difícil: anticipa hacia dónde va el rival, lo espera en el BUMP/TRENCH por el que va a cruzar
 *   y, al soltar un PIN, se queda enfrente sin tocarlo; al anotar esquiva a los defensores.
 * - Einstein: como Difícil, con más anticipación, márgenes de falta más amplios y deja la defensa
 *   a tiempo para llenarse antes de que se active su HUB.
 */
import type { Difficulty } from '../config/settings';

export interface DefenseSkill {
  /** Ganas de defender (0 = solo si la estrategia lo pide; 1 = normal; > 1 = más seguido). */
  willing: number;
  /** Segundos que adelanta la posición del rival (lo espera donde va a estar). */
  lead: number;
  /** ¿Lo espera en el BUMP o TRENCH por el que va a cruzar a su ALLIANCE ZONE? */
  intercept: boolean;
  /** Suelta el PIN a estos segundos (G418: la falta es a los 3 s). */
  pinRelease: number;
  /** Al soltar, ¿se queda enfrente del rival sin tocarlo (en vez de alejarse)? */
  shadow: boolean;
  /** Velocidad máxima (m/s) al llegar al contacto: más despacio no cuenta como embestida (G416). */
  contactSpeed: number;
  /** Deja de defender estos segundos antes de que su HUB vuelva a contar, para ir por FUEL. */
  leaveEarly: number;
}

export interface DifficultyProfile {
  /** Fracción de la velocidad máxima del robot. */
  speed: number;
  /** Segundos entre decisiones (reacción). */
  think: number;
  /** Multiplicador de la precisión del shooter. */
  accuracy: number;
  /** Margen (s) con el que sale a trepar en END GAME. */
  climbMargin: number;
  /** Probabilidad de errores de criterio (cambiar de objetivo sin razón). */
  mistakes: number;
  /** Precisión de su HUMAN PLAYER. */
  hpAccuracy: number;
  /** Aprende por prueba y error (`AiMemory`). */
  memory: boolean;
  /** La alianza reparte roles según el momento (`AllianceBrain`). */
  brain: boolean;
  defense: DefenseSkill;
  /** Esquiva a los defensores rivales cuando va a tirar (busca otro punto de tiro). */
  evade: boolean;
}

export const DIFFICULTY: Record<Difficulty, DifficultyProfile> = {
  easy: {
    speed: 0.68,
    think: 0.9,
    accuracy: 0.82,
    climbMargin: 7,
    mistakes: 0.25,
    hpAccuracy: 0.6,
    memory: false,
    brain: false,
    defense: { willing: 0, lead: 0, intercept: false, pinRelease: 2.6, shadow: false, contactSpeed: 99, leaveEarly: 0 },
    evade: false,
  },
  normal: {
    speed: 0.84,
    think: 0.5,
    accuracy: 0.94,
    climbMargin: 5,
    mistakes: 0.1,
    hpAccuracy: 0.78,
    memory: true,
    brain: true,
    defense: { willing: 1, lead: 0.25, intercept: false, pinRelease: 2.0, shadow: false, contactSpeed: 2.6, leaveEarly: 0 },
    evade: false,
  },
  hard: {
    speed: 0.94,
    think: 0.3,
    accuracy: 1.0,
    climbMargin: 4,
    mistakes: 0.04,
    hpAccuracy: 0.88,
    memory: true,
    brain: true,
    defense: { willing: 1.25, lead: 0.5, intercept: true, pinRelease: 1.8, shadow: true, contactSpeed: 2.0, leaveEarly: 2.5 },
    evade: true,
  },
  einstein: {
    speed: 1.0,
    think: 0.18,
    accuracy: 1.06,
    climbMargin: 3,
    mistakes: 0,
    hpAccuracy: 0.95,
    memory: true,
    brain: true,
    defense: { willing: 1.45, lead: 0.7, intercept: true, pinRelease: 1.6, shadow: true, contactSpeed: 1.8, leaveEarly: 3.5 },
    evade: true,
  },
};

export const DIFFICULTIES = Object.keys(DIFFICULTY) as Difficulty[];

export function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === 'string' && v in DIFFICULTY;
}
