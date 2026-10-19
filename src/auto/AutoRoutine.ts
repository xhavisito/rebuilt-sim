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
