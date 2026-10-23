/** Lectura del gamepad sin DOM: zonas muertas, esquema de sticks, gatillos y reasignación. */
import { BUTTON_ACTIONS, DEFAULT_PAD, PAD, type ButtonAction, type PadBindings } from './actions';

export type Curve = 'linear' | 'quadratic';
/** standard: stick izquierdo mueve, derecho gira · southpaw: al revés. */
export type StickLayout = 'standard' | 'southpaw';

export interface StickOpts {
  deadzone: number;
  curve: Curve;
  layout: StickLayout;
  invertRotate: boolean;
}

const shape = (v: number, curve: Curve): number => (curve === 'quadratic' ? Math.sign(v) * v * v : v);

/** Zona muerta radial (no "cuadra" las diagonales) reescalada a 0–1 y con curva. */
export function radialDeadzone(x: number, y: number, dz: number, curve: Curve): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dz || m === 0) return [0, 0];
  const n = Math.min(1, (m - dz) / (1 - dz));
  const s = shape(n, curve) / m;
  return [x * s, y * s];
}

export function axisDeadzone(v: number, dz: number, curve: Curve): number {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return shape(Math.sign(v) * Math.min(1, (a - dz) / (1 - dz)), curve);
}

/** Ejes del mapeo "standard": 0/1 stick izquierdo, 2/3 stick derecho (Y hacia abajo = +). */
export function readSticks(axes: readonly number[], o: StickOpts): { moveX: number; moveY: number; rotate: number } {
  const south = o.layout === 'southpaw';
  const mx = axes[south ? 2 : 0] ?? 0;
  const my = -(axes[south ? 3 : 1] ?? 0);
  const rx = axes[south ? 0 : 2] ?? 0;
  const [moveX, moveY] = radialDeadzone(mx, my, o.deadzone, o.curve);
  const r = axisDeadzone(rx, o.deadzone, o.curve);
  return { moveX, moveY, rotate: o.invertRotate ? -r : r };
}

/** Gatillos analógicos (LT/RT) usan el umbral; los demás botones, su estado digital. */
export function buttonDown(btn: { pressed: boolean; value: number } | undefined, index: number, triggerThreshold: number): boolean {
  if (!btn) return false;
  if (index === PAD.LT || index === PAD.RT) return btn.value >= triggerThreshold || (btn.value === 0 && btn.pressed);
  return btn.pressed || btn.value > 0.5;
}

/**
 * Asigna `button` a `action` como único botón. Si otra acción lo usaba, recibe a cambio los
 * botones que tenía `action` (intercambio), así ninguna acción se queda sin botón.
 */
export function rebindPad(b: PadBindings, action: ButtonAction, button: number): PadBindings {
  const out = structuredClone(b);
  const old = out[action];
  for (const a of BUTTON_ACTIONS) {
    if (a === action || !out[a].includes(button)) continue;
    const rest = out[a].filter((x) => x !== button);
    out[a] = rest.length ? rest : old.filter((x) => x !== button);
  }
  out[action] = [button];
  return out;
}

export type PadPreset = 'default' | 'bumpers';

/** Esquemas listos. "bumpers": para controles con gatillos digitales (Switch Pro, 8BitDo…). */
export const PAD_PRESETS: Record<PadPreset, PadBindings> = {
  default: DEFAULT_PAD,
  bumpers: { ...DEFAULT_PAD, shoot: [PAD.RB], intake: [PAD.LB], pass: [PAD.RT], slow: [PAD.LT] },
};

export function matchPreset(b: PadBindings): PadPreset | null {
  for (const [k, p] of Object.entries(PAD_PRESETS) as Array<[PadPreset, PadBindings]>)
    if (BUTTON_ACTIONS.every((a) => b[a].length === p[a].length && b[a].every((x, i) => x === p[a][i]))) return k;
  return null;
}
