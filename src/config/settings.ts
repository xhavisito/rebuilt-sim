/** Ajustes persistentes (localStorage, con valores por defecto si no hay almacenamiento). */
import type { Alliance, EventType, StationNumber } from '../core/types';
import { DEFAULT_KEYS, DEFAULT_PAD, type KeyBindings, type PadBindings } from '../input/actions';
import type { Quality } from '../render/Renderer';
import type { CameraMode } from '../render/CameraRig';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'einstein';
export type Lang = 'es' | 'en';

export interface Settings {
  lang: Lang;
  /** Nombre del piloto (menú principal). */
  driverName: string;
  quality: Quality | 'auto';
  showFps: boolean;
  camera: CameraMode;
  cameraShake: boolean;
  /** Drive coach en los matches: mensajes en pantalla y voz. */
  coach: { show: boolean; voice: boolean };
  colorblind: boolean;
  drive: {
    fieldRelative: boolean;
    mouseAim: boolean;
    autoAim: boolean;
    shootOnMove: boolean;
    /** Dibuja la trayectoria del siguiente tiro. */
    aimGuide: boolean;
  };
  pad: { deadzone: number; curve: 'linear' | 'quadratic'; vibration: boolean };
  touch: { scale: number; opacity: number; layout: Record<string, { x: number; y: number }> };
  keys: KeyBindings;
  padBindings: PadBindings;
  audio: { master: number; music: number; sfx: number; voice: number };
  match: {
    eventType: EventType;
    fuel: 504 | 600;
    fouls: boolean;
    alliance: Alliance;
    station: StationNumber;
    difficulty: Difficulty;
    robotId: string;
    autoRoutine: string;
    humanPlayer: 'ai' | 'player';
    /** Desplazamiento lateral de la posición inicial (m) a lo largo de la ROBOT STARTING LINE. */
    startOffset: number;
    /** Estrategia de tu alianza y la del rival (ids de `Strategy`). */
    strategy: string;
    oppStrategy: string;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'es',
  driverName: '',
  quality: 'auto',
  showFps: false,
  camera: 'third',
  cameraShake: true,
  coach: { show: true, voice: true },
  colorblind: false,
  drive: { fieldRelative: true, mouseAim: false, autoAim: true, shootOnMove: true, aimGuide: true },
  pad: { deadzone: 0.12, curve: 'quadratic', vibration: true },
  touch: { scale: 1, opacity: 0.55, layout: {} },
  keys: DEFAULT_KEYS,
  padBindings: DEFAULT_PAD,
  audio: { master: 0.8, music: 0.35, sfx: 0.8, voice: 0.7 },
  match: {
    eventType: 'regional',
    fuel: 504,
    fouls: true,
    alliance: 'blue',
    station: 2,
    difficulty: 'normal',
    robotId: 'cad-1678',
    autoRoutine: 'default-score',
    humanPlayer: 'ai',
    startOffset: 0,
    strategy: 'auto',
    oppStrategy: 'auto',
  },
};

const KEY = 'rebuilt-sim.settings.v1';
/** Igual a CAMERA_MODES (sin importar Three.js aquí). */
const CAMERAS: CameraMode[] = ['third', 'driver', 'onboard', 'top', 'broadcast', 'free'];

function merge<T>(base: T, over: unknown): T {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return (over ?? base) as T;
  if (typeof over !== 'object' || over === null) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b !== undefined && typeof b === 'object' && !Array.isArray(b) && b !== null ? merge(b, v) : v;
  }
  return out as T;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = merge(structuredClone(DEFAULT_SETTINGS), JSON.parse(raw));
      // Cámaras que ya no existen (la de "seguimiento" se fusionó con tercera persona)
      if (!CAMERAS.includes(s.camera)) s.camera = 'third';
      // Las recreaciones aproximadas ("top-…") se reemplazaron por robots con su CAD real
      // …y los diseños genéricos de las primeras versiones se quitaron
      if (s.match.robotId.startsWith('top-') || ['tank', 'balanced', 'climber', 'defender'].includes(s.match.robotId)) s.match.robotId = 'cad-1678';
      return s;
    }
  } catch {
    /* almacenamiento no disponible: usar defaults */
  }
  const s = structuredClone(DEFAULT_SETTINGS);
  if (typeof navigator !== 'undefined' && !/^es/i.test(navigator.language || 'es')) s.lang = 'en';
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignorar */
  }
}

/** Lectura/escritura segura de JSON en localStorage (rutinas, robots, torneo). */
export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignorar */
  }
}
