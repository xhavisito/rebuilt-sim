/** Acciones abstractas y asignaciones por defecto (reasignables en Ajustes). */

export type ButtonAction =
  | 'shoot'
  | 'intake'
  | 'pass'
  | 'climbUp'
  | 'climbDown'
  | 'resetGyro'
  | 'toggleFieldRelative'
  | 'cameraNext'
  | 'pause'
  | 'slow'
  | 'chuteDoor'
  | 'hpThrow';

export const BUTTON_ACTIONS: ButtonAction[] = [
  'shoot',
  'intake',
  'pass',
  'climbUp',
  'climbDown',
  'resetGyro',
  'toggleFieldRelative',
  'cameraNext',
  'pause',
  'slow',
  'chuteDoor',
  'hpThrow',
];

export type AxisAction = 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight' | 'rotLeft' | 'rotRight';
export const AXIS_ACTIONS: AxisAction[] = ['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'rotLeft', 'rotRight'];

export type DeviceKind = 'keyboard' | 'gamepad' | 'touch';

export interface PlayerInput {
  /** Stick de traslación: derecha +, arriba + (−1..1). */
  moveX: number;
  moveY: number;
  /** Giro: + = horario (derecha). */
  rotate: number;
  held: Record<ButtonAction, boolean>;
  /** Flancos de subida en este frame. */
  pressed: Set<ButtonAction>;
  /** Mouse en coordenadas normalizadas de pantalla (−1..1) si se usa para apuntar. */
  mouseNdc: { x: number; y: number } | null;
  device: DeviceKind;
}

export type KeyBindings = Record<ButtonAction | AxisAction, string[]>;
export type PadBindings = Record<ButtonAction, number[]>;

export const DEFAULT_KEYS: KeyBindings = {
  moveUp: ['KeyW'],
  moveDown: ['KeyS'],
  moveLeft: ['KeyA'],
  moveRight: ['KeyD'],
  rotLeft: ['KeyQ', 'ArrowLeft'],
  rotRight: ['KeyE', 'ArrowRight'],
  shoot: ['Space', 'Mouse0'],
  intake: ['KeyF', 'Mouse2'],
  pass: ['KeyG'],
  climbUp: ['KeyR'],
  climbDown: ['KeyV'],
  resetGyro: ['KeyZ'],
  toggleFieldRelative: ['KeyX'],
  cameraNext: ['KeyC'],
  pause: ['Escape', 'KeyP'],
  slow: ['ShiftLeft', 'ShiftRight'],
  chuteDoor: ['KeyO'],
  hpThrow: ['KeyH'],
};

/** Mapeo "standard" de la Gamepad API. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

export const DEFAULT_PAD: PadBindings = {
  shoot: [PAD.RT],
  intake: [PAD.LT],
  pass: [PAD.RB],
  climbUp: [PAD.A],
  climbDown: [PAD.B],
  resetGyro: [PAD.Y],
  toggleFieldRelative: [PAD.BACK],
  cameraNext: [PAD.X],
  pause: [PAD.START],
  slow: [PAD.LB],
  chuteDoor: [PAD.UP],
  hpThrow: [PAD.DOWN],
};

export type PadStyle = 'xbox' | 'ps' | 'generic';

/** Etiquetas de botones según el tipo de control (para el HUD). */
export const PAD_LABELS: Record<PadStyle, string[]> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', '↑', '↓', '←', '→'],
  ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', '↑', '↓', '←', '→'],
  generic: ['B1', 'B2', 'B3', 'B4', 'L1', 'R1', 'L2', 'R2', 'Sel', 'Start', 'L3', 'R3', '↑', '↓', '←', '→'],
};

export function padStyle(id: string): PadStyle {
  if (/xbox|xinput|045e/i.test(id)) return 'xbox';
  if (/playstation|dualshock|dualsense|054c|sony/i.test(id)) return 'ps';
  return 'generic';
}

export function keyLabel(code: string, lang: 'es' | 'en' = 'es'): string {
  const en = lang === 'en';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Mouse0') return en ? '🖱 Left' : '🖱 Izq';
  if (code === 'Mouse2') return en ? '🖱 Right' : '🖱 Der';
  if (code === 'Space') return en ? 'Space' : 'Espacio';
  if (code.startsWith('Arrow')) return { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }[code] ?? code;
  if (code.startsWith('Shift')) return 'Shift';
  if (code === 'Escape') return 'Esc';
  return code;
}

export function emptyInput(device: DeviceKind = 'keyboard'): PlayerInput {
  const held = {} as Record<ButtonAction, boolean>;
  for (const a of BUTTON_ACTIONS) held[a] = false;
  return { moveX: 0, moveY: 0, rotate: 0, held, pressed: new Set(), mouseNdc: null, device };
}
