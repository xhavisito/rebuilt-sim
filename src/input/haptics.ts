/**
 * Vibración del control: catálogo de efectos por evento del juego (lógica pura, sin DOM).
 * `InputManager.haptic()` lo usa para mandar `dual-rumble` / `trigger-rumble` a la Gamepad API
 * o `navigator.vibrate` en teléfonos.
 */

export type HapticEvent = 'shot' | 'pass' | 'impact' | 'intake' | 'shift' | 'endgame' | 'foul' | 'test';

/** Grupos que se pueden apagar por separado en Ajustes › Control. */
export type HapticGroup = 'shots' | 'impacts' | 'intake' | 'match';

export const HAPTIC_GROUPS: HapticGroup[] = ['shots', 'impacts', 'intake', 'match'];

export const HAPTIC_GROUP: Record<HapticEvent, HapticGroup | null> = {
  shot: 'shots',
  pass: 'shots',
  impact: 'impacts',
  intake: 'intake',
  shift: 'match',
  endgame: 'match',
  foul: 'match',
  test: null,
};

export interface HapticSpec {
  /** Motor grande (baja frecuencia), 0–1. */
  strong: number;
  /** Motor chico (alta frecuencia), 0–1. */
  weak: number;
  ms: number;
  /** Gatillo derecho / izquierdo (impulse triggers de Xbox), 0–1. */
  right?: number;
  left?: number;
  /** Duración en teléfonos (0 = no vibra: los tiros seguidos serían molestos). */
  phoneMs: number;
  /** Tiempo mínimo entre dos efectos iguales (un dumper lanza 20+ FUEL/s). */
  cooldown: number;
}

const SPECS: Record<HapticEvent, HapticSpec> = {
  // Golpe seco y corto del flywheel; el gatillo derecho "patea"
  shot: { strong: 0.15, weak: 0.55, ms: 45, right: 0.6, phoneMs: 0, cooldown: 0.07 },
  pass: { strong: 0.1, weak: 0.4, ms: 40, right: 0.4, phoneMs: 0, cooldown: 0.07 },
  // Choque: escala con la fuerza del golpe
  impact: { strong: 1, weak: 0.6, ms: 140, phoneMs: 120, cooldown: 0.12 },
  // Un FUEL entra a la intake: tic suave en el gatillo izquierdo
  intake: { strong: 0, weak: 0.25, ms: 30, left: 0.35, phoneMs: 0, cooldown: 0.09 },
  shift: { strong: 0.5, weak: 0.3, ms: 250, phoneMs: 160, cooldown: 1 },
  endgame: { strong: 0.65, weak: 0.4, ms: 320, phoneMs: 200, cooldown: 1 },
  foul: { strong: 0.4, weak: 0.7, ms: 160, phoneMs: 120, cooldown: 0.5 },
  test: { strong: 0.8, weak: 0.5, ms: 350, right: 0.6, left: 0.6, phoneMs: 200, cooldown: 0 },
};

export interface HapticPrefs {
  vibration: boolean;
  /** Intensidad global 0–1. */
  vibrationStrength: number;
  triggerRumble: boolean;
  haptics: Record<HapticGroup, boolean>;
}

/**
 * Efecto final para un evento, o null si está apagado.
 * @param strength 0–1 (fuerza del choque; 1 para los demás)
 */
export function hapticPattern(ev: HapticEvent, strength: number, p: HapticPrefs): HapticSpec | null {
  if (!p.vibration) return null;
  const g = HAPTIC_GROUP[ev];
  if (g && p.haptics[g] === false) return null;
  const base = SPECS[ev];
  const k = clamp01(p.vibrationStrength) * clamp01(strength);
  if (k <= 0.01) return null;
  const out: HapticSpec = {
    ...base,
    strong: clamp01(base.strong * k),
    weak: clamp01(base.weak * k),
    // Los choques leves también duran menos
    ms: Math.round(ev === 'impact' ? base.ms * (0.5 + 0.5 * clamp01(strength)) : base.ms),
  };
  if (p.triggerRumble) {
    if (base.right) out.right = clamp01(base.right * k);
    if (base.left) out.left = clamp01(base.left * k);
  } else {
    delete out.right;
    delete out.left;
  }
  return out;
}

export function hapticCooldown(ev: HapticEvent): number {
  return SPECS[ev].cooldown;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
