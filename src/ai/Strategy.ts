/**
 * Estrategias de alianza para 3 vs 3: qué hace cada DRIVER STATION (rol, carril, ruta de
 * recolección, punto de tiro y nivel de climb). Se dibujan desde el lado azul (como las rutinas
 * de AUTO) y se reflejan para la roja: (x, z) → (−x, −z). La IA de cada robot las sigue
 * (RobotAI); sin plan, cada robot juega en automático.
 */
import * as F from '../config/field';
import type { Alliance, StationNumber } from '../core/types';

/**
 * - auto: decide solo (recoge y anota; con turret, ciclos continuos).
 * - scorer: anota; no defiende aunque su HUB esté apagado.
 * - feeder: se queda en la NEUTRAL ZONE recogiendo y PASA el FUEL a su ALLIANCE ZONE (no anota).
 * - defender: estorba al rival con más FUEL mientras su HUB está apagado; con él activo, anota.
 */
export type Role = 'auto' | 'scorer' | 'feeder' | 'defender';
/** Carril (lado azul, vista superior): z < −1.35 · |z| ≤ 1.35 · z > 1.35. */
export type Lane = 'any' | 'top' | 'mid' | 'bottom';
export const ROLES: Role[] = ['auto', 'scorer', 'feeder', 'defender'];
/** Tarea con el HUB propio activo: anotar o alimentar (pasar FUEL a la zona para los anotadores). */
export type ActiveTask = 'score' | 'feed';
/**
 * Tarea con el HUB propio inactivo (nunca esperar todo el SHIFT): acaparar (llenarse y pasar el
 * excedente a la zona), defender al rival marcado o pasar todo a la zona.
 */
export type InactiveTask = 'stockpile' | 'defend' | 'feed';
export const ACTIVE_TASKS: ActiveTask[] = ['score', 'feed'];
export const INACTIVE_TASKS: InactiveTask[] = ['stockpile', 'defend', 'feed'];
export const LANES: Lane[] = ['any', 'top', 'mid', 'bottom'];
/** Límite entre carriles (m): los BUMPS quedan en el carril de arriba y el de abajo. */
export const LANE_EDGE = 1.35;

export interface Pt {
  x: number;
  z: number;
}

export interface RobotPlan {
  role: Role;
  lane: Lane;
  /** Línea de recolección (lado azul): prefiere el FUEL cerca de ella y la recorre si no hay. */
  route: Pt[];
  /** Punto de tiro (lado azul); null = el de su DRIVER STATION. */
  shootSpot: Pt | null;
  /** Nivel de climb en END GAME ('auto' = el máximo de su robot; 0 = no trepa). */
  climb: 'auto' | 0 | 1 | 2 | 3;
  /** Z de la posición inicial (lado azul, sobre la ROBOT STARTING LINE); null = frente a su DS. */
  startZ: number | null;
  /** Rutina de AUTO (id); null = automática (sin choques con su alianza, `assignAutos`). */
  auto: string | null;
  /** Defensor: número de equipo rival que marca (null = el más peligroso según el scouting). */
  defendTeam?: number | null;
  /** Tarea por fase (tablas del dashboard); sin ellas manda `role`. */
  active?: ActiveTask;
  inactive?: InactiveTask;
  /**
   * Tareas por SHIFT: ventana 0 (SHIFT activo / inactivo 1, en SHIFT 1–2) y ventana 1 (SHIFT 3–4).
   * Si están, mandan sobre `active` / `inactive` / `defendTeam` (ver `planAt`).
   */
  windows?: [ShiftPlan, ShiftPlan];
}

/** Lo que hace un robot en un par de SHIFTS (su SHIFT activo y su SHIFT inactivo de esa ventana). */
export interface ShiftPlan {
  active: ActiveTask;
  inactive: InactiveTask;
  /** Rival que marca si defiende (null = el más peligroso). */
  defendTeam: number | null;
}

/** El plan con las tareas de la ventana `w` (0 = SHIFT 1–2, 1 = SHIFT 3–4). */
export function planAt(p: RobotPlan, w: 0 | 1): RobotPlan {
  const s = p.windows?.[w];
  return s ? { ...p, active: s.active, inactive: s.inactive, defendTeam: s.defendTeam } : p;
}

export interface Strategy {
  id: string;
  /** Nombre (en las de fábrica, clave de i18n `strat_…`). */
  name: string;
  /** Planes de las DRIVER STATIONS 1, 2 y 3. */
  plans: [RobotPlan, RobotPlan, RobotPlan];
  builtin?: boolean;
}

export const plan = (o: Partial<RobotPlan> = {}): RobotPlan => ({ role: 'auto', lane: 'any', route: [], shootSpot: null, climb: 'auto', startZ: null, auto: null, ...o });

const HUB_X = F.HUB_CENTER_X_BLUE;
const NEUTRAL_X = HUB_X + 1.8;

export const BUILTIN_STRATEGIES: Strategy[] = [
  { id: 'auto', name: 'strat_auto', builtin: true, plans: [plan(), plan(), plan()] },
  {
    id: 'two-one-defense',
    name: 'strat_twoOneDefense',
    builtin: true,
    plans: [plan({ role: 'scorer', lane: 'top' }), plan({ role: 'scorer', lane: 'bottom' }), plan({ role: 'defender', climb: 0 })],
  },
  {
    id: 'feeder',
    name: 'strat_feeder',
    builtin: true,
    plans: [
      plan({ role: 'scorer', lane: 'top' }),
      plan({ role: 'feeder', route: [{ x: NEUTRAL_X, z: -2.4 }, { x: NEUTRAL_X + 1.5, z: 0 }, { x: NEUTRAL_X, z: 2.4 }], climb: 0 }),
      plan({ role: 'scorer', lane: 'bottom' }),
    ],
  },
  {
    id: 'all-offense',
    name: 'strat_allOffense',
    builtin: true,
    plans: [plan({ role: 'scorer', lane: 'top' }), plan({ role: 'scorer', lane: 'mid' }), plan({ role: 'scorer', lane: 'bottom' })],
  },
];

const KEY = 'rebuilt-sim.strategies.v1';

export function loadStrategies(): Strategy[] {
  let custom: Strategy[] = [];
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) custom = (JSON.parse(raw) as Strategy[]).filter((s) => s && Array.isArray(s.plans) && s.plans.length === 3).map((s) => ({ ...s, builtin: false, plans: s.plans.map((p) => plan(p)) as Strategy['plans'] }));
  } catch {
    /* sin almacenamiento: solo las de fábrica */
  }
  return [...BUILTIN_STRATEGIES, ...custom];
}

export function saveCustomStrategies(list: Strategy[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.filter((s) => !s.builtin)));
  } catch {
    /* sin almacenamiento */
  }
}

export function strategyById(id: string | undefined): Strategy {
  return loadStrategies().find((s) => s.id === id) ?? BUILTIN_STRATEGIES[0];
}

/** Punto del lado azul → campo real de la alianza (la roja es el giro de 180°). */
export function toAlliance(p: Pt, a: Alliance): Pt {
  return a === 'blue' ? { x: p.x, z: p.z } : { x: -p.x, z: -p.z };
}

/** Plan de una DRIVER STATION en el marco real de su alianza. */
export function planFor(s: Strategy, a: Alliance, station: StationNumber): RobotPlan {
  const p = s.plans[station - 1] ?? plan();
  return {
    ...p,
    route: p.route.map((q) => toAlliance(q, a)),
    shootSpot: p.shootSpot ? toAlliance(p.shootSpot, a) : null,
    startZ: p.startZ === null ? null : a === 'blue' ? p.startZ : -p.startZ,
  };
}

/** ¿z (marco real de la alianza) cae en el carril? (el carril se define del lado azul) */
export function inLane(lane: Lane, z: number, a: Alliance): boolean {
  if (lane === 'any') return true;
  const zb = a === 'blue' ? z : -z;
  if (lane === 'top') return zb < -LANE_EDGE + 0.3;
  if (lane === 'bottom') return zb > LANE_EDGE - 0.3;
  return Math.abs(zb) <= LANE_EDGE + 0.3;
}

/** Distancia (m) de un punto a la línea de recolección (polilínea). Infinity si no hay línea. */
export function routeDistance(route: Pt[], x: number, z: number): number {
  if (!route.length) return Infinity;
  if (route.length === 1) return Math.hypot(route[0].x - x, route[0].z - z);
  let best = Infinity;
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i];
    const b = route[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
  }
  return best;
}

/** ¿x está en la NEUTRAL ZONE? (entre las dos líneas de los HUBS) */
export const inNeutral = (x: number): boolean => Math.abs(x) < Math.abs(HUB_X) - F.HUB_SIZE / 2;
