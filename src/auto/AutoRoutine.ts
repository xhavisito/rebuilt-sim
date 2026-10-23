/**
 * Rutinas de AUTO (§7.4.1): durante los 20 s de AUTO el robot NO recibe mandos del piloto;
 * ejecuta su rutina pre-programada. Las coordenadas se guardan en el marco de la alianza
 * AZUL (pared propia a la izquierda, −X) y se rotan 180° para la roja.
 */
import * as F from '../config/field';
import { loadJSON, saveJSON } from '../config/settings';
import type { Alliance } from '../core/types';

export interface AutoWaypoint {
  /** Posición en el marco azul (m). */
  x: number;
  z: number;
  /** Rumbo deseado al llegar (rad, marco azul) o null = mirar hacia donde avanza. */
  heading: number | null;
  /** Acciones al llegar (en orden): intake on/off, disparar, esperar, trepar L1. */
  intake?: boolean;
  shoot?: boolean;
  wait?: number;
  climb?: boolean;
  /** Rutas suaves: detenerse aquí aunque no haya acción (si no, pasa sin frenar). */
  stop?: boolean;
  /** Rutas suaves: manijas de la curva Bézier (offset en m desde el punto); sin ellas, automáticas. */
  hin?: { x: number; z: number };
  hout?: { x: number; z: number };
}

export interface AutoRoutine {
  id: string;
  name: string;
  builtin?: boolean;
  /** Si es true, empieza disparando lo precargado desde la posición inicial. */
  shootPreload: boolean;
  /**
   * Rutina "de cualquier lado": si el robot sale del lado contrario (en z) al de su primer
   * waypoint, se refleja en z para no cruzar por enfrente de sus compañeros.
   */
  mirrorToStart?: boolean;
  /**
   * Ruta suave tipo PathPlanner (curvas Bézier + perfil de velocidad, `Trajectory.ts`). Si no,
   * el navegador va de punto a punto e inserta solo los cruces de BUMP/TRENCH.
   */
  spline?: boolean;
  /** Rutas suaves: fracción de la velocidad máxima del robot (0.2–1; por defecto 0.85). */
  speed?: number;
  waypoints: AutoWaypoint[];
}

const hubX = F.HUB_CENTER_X_BLUE;
const line = F.STARTING_LINE_X_BLUE;
const tower = F.towerInfo('blue');
const depot = F.depotCenter('blue');

/** Rutinas incluidas (no se pueden borrar). */
export const BUILTIN_ROUTINES: AutoRoutine[] = [
  { id: 'none', name: 'Nada / Nothing', builtin: true, shootPreload: false, waypoints: [] },
  { id: 'preload', name: 'Solo precarga · Preload only', builtin: true, shootPreload: true, waypoints: [] },
  {
    // Sale por el lado de su DRIVER STATION (el cruce lo elige el navegador), barre la NEUTRAL
    // ZONE de su lado al otro y regresa a tirar por el otro lado
    id: 'default-score',
    name: 'Precarga + NEUTRAL ZONE',
    builtin: true,
    shootPreload: true,
    mirrorToStart: true,
    waypoints: [
      { x: hubX + 1.4, z: F.BUMP_CENTER_Z, heading: 0, intake: true },
      { x: -0.9, z: 0.9, heading: 0 },
      { x: -0.9, z: -0.9, heading: -Math.PI / 2 },
      { x: hubX + 1.4, z: -F.BUMP_CENTER_Z, heading: Math.PI },
      { x: line - 1.6, z: -F.BUMP_CENTER_Z, heading: 0, shoot: true },
    ],
  },
  // Mitad de la NEUTRAL ZONE de cada lado (lado azul: arriba = z < 0): dos robots de la misma
  // alianza recogen sin estorbarse. Sin pasar la CENTER LINE (G403); el cruce (BUMP o TRENCH) lo
  // elige el navegador según el robot.
  ...(['top', 'bottom'] as const).map((side): AutoRoutine => {
    const s = side === 'top' ? -1 : 1;
    return {
      id: `neutral-${side}`,
      name: side === 'top' ? 'Precarga + NEUTRAL ZONE (arriba · top)' : 'Precarga + NEUTRAL ZONE (abajo · bottom)',
      builtin: true,
      shootPreload: true,
      waypoints: [
        { x: hubX + 1.6, z: s * 2.3, heading: 0, intake: true },
        { x: -0.9, z: s * 2.6, heading: s * (Math.PI / 2) },
        { x: -0.9, z: s * 0.7, heading: Math.PI },
        { x: hubX + 1.6, z: s * 1.2, heading: Math.PI },
        { x: line - 1.6, z: s * 2.0, heading: 0, shoot: true },
      ],
    };
  }),
  {
    // Ruta suave de ejemplo (y plantilla de las nuevas): cruza el BUMP de su lado, barre la
    // NEUTRAL ZONE sin pasar la CENTER LINE y regresa por el otro BUMP a tirar
    id: 'spline-sweep',
    name: 'Ruta suave · NEUTRAL ZONE',
    builtin: true,
    shootPreload: true,
    mirrorToStart: true,
    spline: true,
    speed: 0.85,
    waypoints: [
      { x: hubX - 1.25, z: F.BUMP_CENTER_Z, heading: null, intake: true },
      { x: hubX + 1.35, z: F.BUMP_CENTER_Z, heading: null },
      { x: -1.0, z: 1.9, heading: null },
      { x: -1.0, z: -1.2, heading: null },
      { x: hubX + 1.35, z: -F.BUMP_CENTER_Z, heading: null },
      { x: hubX - 1.25, z: -F.BUMP_CENTER_Z, heading: null },
      { x: line - 1.5, z: -F.BUMP_CENTER_Z - 0.4, heading: 0, shoot: true },
    ],
  },
  {
    id: 'depot',
    name: 'Precarga + DEPOT',
    builtin: true,
    shootPreload: true,
    waypoints: [
      { x: depot.x + 1.2, z: depot.z, heading: Math.PI, intake: true },
      { x: depot.x + 0.45, z: depot.z, heading: Math.PI, wait: 1.2 },
      { x: line - 1.8, z: depot.z * 0.6, heading: 0, intake: false, shoot: true },
    ],
  },
  {
    id: 'climb-l1',
    name: 'Precarga + TOWER L1',
    builtin: true,
    shootPreload: true,
    waypoints: [{ x: tower.uprightX + 1.25, z: tower.cz, heading: Math.PI, climb: true }],
  },
];

/** Zona del campo que ocupa una rutina en AUTO (para que dos robots de una alianza no choquen). */
export type AutoZone = 'depot' | 'tower' | 'neutral-top' | 'neutral-bottom' | 'zone-top' | 'zone-bottom';

/** Zona de un punto (marco azul). */
export function pointZone(x: number, z: number): AutoZone {
  if (Math.hypot(x - depot.x, z - depot.z) < F.DEPOT_WIDTH / 2 + 1.3) return 'depot';
  if (Math.hypot(x - tower.uprightX, z - tower.cz) < 1.4) return 'tower';
  if (x > hubX) return z < 0 ? 'neutral-top' : 'neutral-bottom';
  return z < 0 ? 'zone-top' : 'zone-bottom';
}

/** Zonas por las que pasa una rutina (marco azul). */
export function routineZones(r: AutoRoutine): AutoZone[] {
  const out = new Set<AutoZone>();
  for (const w of r.waypoints) {
    if (w.climb) out.add('tower');
    else {
      const z = pointZone(w.x, w.z);
      // el punto donde solo tira no "ocupa" su zona
      if (!(w.shoot && (z === 'zone-top' || z === 'zone-bottom'))) out.add(z);
    }
  }
  return [...out];
}

export interface AutoSlot {
  station: 1 | 2 | 3;
  canClimb: boolean;
  /** Z de salida (marco azul): se reparte por el orden real de arriba a abajo, no por DS. */
  z?: number;
  /** Rutina elegida (jugador o estrategia); undefined = la elige la computadora. */
  fixed?: string;
}

/** Preferencias de la asignación automática, por DRIVER STATION (DS1 arriba, DS3 abajo). */
const PREFS: Record<1 | 2 | 3, string[]> = {
  1: ['neutral-top', 'depot', 'preload'],
  2: ['climb-l1', 'depot', 'neutral-top', 'neutral-bottom', 'preload'],
  3: ['neutral-bottom', 'climb-l1', 'preload'],
};

/**
 * Rutinas de AUTO de una alianza sin choques: respeta las elegidas y reparte las demás para que
 * no compartan zona (DEPOT, TOWER, cada mitad de la NEUTRAL ZONE). Solo un robot trepa (§6.5:
 * en AUTO cuenta LEVEL 1 y el TOWER es angosto). Devuelve ids en el orden de `slots`.
 */
export function assignAutos(slots: AutoSlot[], all: AutoRoutine[] = loadRoutines()): string[] {
  const byId = new Map(all.map((r) => [r.id, r]));
  const used = new Set<AutoZone>();
  const out: string[] = slots.map((s) => s.fixed ?? '');
  slots.forEach((s) => {
    if (s.fixed) for (const z of routineZones(byId.get(s.fixed) ?? BUILTIN_ROUTINES[1])) used.add(z);
  });
  // Lugar de arriba (1) a abajo (3): por la z de salida si se conoce, si no por DS
  const place = slots.map((s) => s.station);
  if (slots.every((s) => s.z !== undefined)) {
    const byZ = slots.map((_, i) => i).sort((a, b) => slots[a].z! - slots[b].z! || slots[a].station - slots[b].station);
    byZ.forEach((i, k) => (place[i] = Math.min(3, Math.round(k * (slots.length > 1 ? 2 / (slots.length - 1) : 0)) + 1) as 1 | 2 | 3));
  }
  // El de en medio primero: elige entre TOWER y DEPOT y deja las mitades de la NEUTRAL ZONE a
  // los de los lados
  const order = slots.map((_, i) => i).filter((i) => !slots[i].fixed);
  order.sort((a, b) => (place[a] === 2 ? -1 : place[b] === 2 ? 1 : place[a] - place[b]));
  for (const i of order) {
    const s = slots[i];
    const pick =
      PREFS[place[i]].find((id) => {
        const r = byId.get(id);
        if (!r || (id === 'climb-l1' && !s.canClimb)) return false;
        return routineZones(r).every((z) => !used.has(z));
      }) ?? 'preload';
    for (const z of routineZones(byId.get(pick)!)) used.add(z);
    out[i] = pick;
  }
  return out;
}

const KEY = 'rebuilt-sim.autos.v1';

export function loadRoutines(): AutoRoutine[] {
  return [...BUILTIN_ROUTINES, ...loadJSON<AutoRoutine[]>(KEY, [])];
}

export function saveCustomRoutines(list: AutoRoutine[]): void {
  saveJSON(
    KEY,
    list.filter((r) => !r.builtin),
  );
}

export function routineById(id: string): AutoRoutine {
  return loadRoutines().find((r) => r.id === id) ?? BUILTIN_ROUTINES[2];
}

const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);
const vec = (v: unknown): { x: number; z: number } | undefined => {
  const o = v as { x?: unknown; z?: unknown } | null;
  const x = num(o?.x, -6, 6);
  const z = num(o?.z, -6, 6);
  return o && x !== undefined && z !== undefined ? { x, z } : undefined;
};

/**
 * Valida una rutina importada (JSON de otra persona): solo los campos conocidos, con números
 * finitos y dentro del campo. Devuelve null si no parece una rutina.
 */
export function sanitizeRoutine(o: unknown): AutoRoutine | null {
  const r = o as Partial<AutoRoutine> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.waypoints) || r.waypoints.length > 64) return null;
  const waypoints: AutoWaypoint[] = [];
  for (const w of r.waypoints as unknown[]) {
    const q = w as Record<string, unknown>;
    const x = num(q?.x, -F.HALF_L, F.HALF_L);
    const z = num(q?.z, -F.HALF_W, F.HALF_W);
    if (x === undefined || z === undefined) return null;
    const wp: AutoWaypoint = { x, z, heading: num(q.heading, -10, 10) ?? null };
    if (typeof q.intake === 'boolean') wp.intake = q.intake;
    if (q.shoot === true) wp.shoot = true;
    if (q.climb === true) wp.climb = true;
    if (q.stop === true) wp.stop = true;
    const wait = num(q.wait, 0, 15);
    if (wait) wp.wait = wait;
    const hin = vec(q.hin);
    const hout = vec(q.hout);
    if (hin) wp.hin = hin;
    if (hout) wp.hout = hout;
    waypoints.push(wp);
  }
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 48) : 'AUTO';
  return {
    id: `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name,
    shootPreload: r.shootPreload !== false,
    spline: r.spline !== false,
    speed: num(r.speed, 0.2, 1) ?? 0.85,
    mirrorToStart: r.mirrorToStart === true || undefined,
    waypoints,
  };
}

/** Waypoint reflejado en z (lado de arriba ↔ abajo). */
export function mirrorWaypointZ(w: AutoWaypoint): AutoWaypoint {
  return {
    ...w,
    z: -w.z,
    heading: w.heading === null ? null : -w.heading,
    hin: w.hin ? { x: w.hin.x, z: -w.hin.z } : undefined,
    hout: w.hout ? { x: w.hout.x, z: -w.hout.z } : undefined,
  };
}

/** Convierte un punto del marco azul al de la alianza. */
export function toAlliance(a: Alliance, x: number, z: number, h: number | null): { x: number; z: number; h: number | null } {
  if (a === 'blue') return { x, z, h };
  return { x: -x, z: -z, h: h === null ? null : h + Math.PI };
}

/** ¿El waypoint cruza COMPLETAMENTE la CENTER LINE? (G403: la rutina sería ilegal). */
export function crossesCenter(w: AutoWaypoint, halfFootprint: number): boolean {
  return w.x - halfFootprint > F.CENTER_LINE_X;
}
