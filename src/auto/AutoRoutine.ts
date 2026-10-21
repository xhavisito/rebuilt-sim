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
}

export interface AutoRoutine {
  id: string;
  name: string;
  builtin?: boolean;
  /** Si es true, empieza disparando lo precargado desde la posición inicial. */
  shootPreload: boolean;
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
    id: 'default-score',
    name: 'Precarga + NEUTRAL ZONE',
    builtin: true,
    shootPreload: true,
    waypoints: [
      { x: line - 0.6, z: F.BUMP_CENTER_Z, heading: 0, intake: true },
      { x: hubX + 1.4, z: F.BUMP_CENTER_Z, heading: 0 },
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

/** Zonas por las que pasa una rutina (marco azul). */
export function routineZones(r: AutoRoutine): AutoZone[] {
  const out = new Set<AutoZone>();
  for (const w of r.waypoints) {
    if (w.climb) out.add('tower');
    else if (Math.hypot(w.x - depot.x, w.z - depot.z) < F.DEPOT_WIDTH / 2 + 1.3) out.add('depot');
    else if (w.x > hubX) out.add(w.z < 0 ? 'neutral-top' : 'neutral-bottom');
    else if (!w.shoot) out.add(w.z < 0 ? 'zone-top' : 'zone-bottom');
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

/** Convierte un punto del marco azul al de la alianza. */
export function toAlliance(a: Alliance, x: number, z: number, h: number | null): { x: number; z: number; h: number | null } {
  if (a === 'blue') return { x, z, h };
  return { x: -x, z: -z, h: h === null ? null : h + Math.PI };
}

/** ¿El waypoint cruza COMPLETAMENTE la CENTER LINE? (G403: la rutina sería ilegal). */
export function crossesCenter(w: AutoWaypoint, halfFootprint: number): boolean {
  return w.x - halfFootprint > F.CENTER_LINE_X;
}
