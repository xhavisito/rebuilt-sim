/**
 * Estado de los HUBS (§6.4.1, Tabla 6-3) y sus luces (Tabla 5-3).
 * `firstInactive` = alianza que anotó MÁS FUEL en AUTO (o la elegida por el FMS en empate):
 * su HUB queda inactivo en SHIFT 1 y 3, activo en SHIFT 2 y 4.
 */
import { phaseAt, T } from './clock';
import type { Rng } from './rng';
import type { Alliance, HubLight, Phase } from './types';

/** Gracia de procesamiento: el FUEL sigue contando 3 s tras la desactivación (§6.5). */
export const HUB_GRACE = 3;

export function hubActive(phase: Phase, a: Alliance, firstInactive: Alliance | null): boolean {
  switch (phase) {
    case 'AUTO':
    case 'AUTO_PAUSE':
    case 'TRANSITION':
    case 'END_GAME':
      return true;
    case 'SHIFT1':
    case 'SHIFT3':
      return a !== firstInactive;
    case 'SHIFT2':
    case 'SHIFT4':
      return a === firstInactive;
    default:
      return false;
  }
}

/**
 * Ventana de la alianza (0 = primera, 1 = segunda): sus SHIFTS activos son 1 y 3 o 2 y 4 (según
 * quién ganó el AUTO), igual que los inactivos; así SHIFT 1–2 son la ventana 0 y SHIFT 3–4 la 1.
 * Antes (AUTO, TRANSITION) cuenta como la 0 y el END GAME como la 1.
 */
export function shiftWindow(phase: Phase): 0 | 1 {
  return phase === 'SHIFT3' || phase === 'SHIFT4' || phase === 'END_GAME' || phase === 'POST' || phase === 'DONE' ? 1 : 0;
}

/** Intervalos [inicio, fin) en que el HUB de `a` está activo durante el match. */
export function activeIntervals(a: Alliance, firstInactive: Alliance | null): Array<[number, number]> {
  const raw: Array<[number, number]> = [[T.autoStart, T.teleopStart]]; // AUTO + pausa de evaluación
  raw.push([T.teleopStart, T.shift1]); // TRANSITION
  const shifts: Array<[Phase, number, number]> = [
    ['SHIFT1', T.shift1, T.shift2],
    ['SHIFT2', T.shift2, T.shift3],
    ['SHIFT3', T.shift3, T.shift4],
    ['SHIFT4', T.shift4, T.endGame],
  ];
  for (const [p, s, e] of shifts) if (hubActive(p, a, firstInactive)) raw.push([s, e]);
  raw.push([T.endGame, T.teleopEnd]);
  // fusiona contiguos
  const out: Array<[number, number]> = [];
  for (const iv of raw.sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

/**
 * ¿Un FUEL que entra al HUB de `a` en el instante `t` vale puntos?
 * Activo, o dentro de los 3 s posteriores a una desactivación / al final del match.
 * Antes del inicio de TELEOP `firstInactive` aún no se conoce y no hace falta.
 */
export function fuelCounts(t: number, a: Alliance, firstInactive: Alliance | null): boolean {
  if (t < 0) return false;
  for (const [s, e] of activeIntervals(a, firstInactive)) if (t >= s && t < e + HUB_GRACE) return true;
  return false;
}

/** El FUEL que entra en t cuenta como AUTO si entra antes de 0:00 + 3 s (§6.5-A). */
export const isAutoFuelTime = (t: number): boolean => t < T.autoEnd + HUB_GRACE;

/** Decide qué alianza queda inactiva en SHIFT 1 (§6.4.1). Empate → aleatorio (FMS). */
export function decideFirstInactive(autoFuel: Record<Alliance, number>, rng: Rng): { alliance: Alliance; random: boolean } {
  if (autoFuel.red > autoFuel.blue) return { alliance: 'red', random: false };
  if (autoFuel.blue > autoFuel.red) return { alliance: 'blue', random: false };
  return { alliance: rng.next() < 0.5 ? 'red' : 'blue', random: true };
}

/** ¿El HUB se desactiva dentro de los próximos `within` segundos? */
function deactivatesSoon(t: number, a: Alliance, firstInactive: Alliance | null, within: number): boolean {
  for (const [, e] of activeIntervals(a, firstInactive)) if (t < e && e - t <= within && t >= e - within) return true;
  return false;
}

/** Luz del HUB (Tabla 5-3). Tras la evaluación post-match: morado y luego verde (campo seguro). */
export function hubLight(t: number, a: Alliance, firstInactive: Alliance | null): HubLight {
  const p = phaseAt(t);
  if (p === 'PRE') return 'off';
  if (p === 'POST') return 'white';
  if (p === 'DONE') return t < T.postEnd + 4 ? 'purple' : 'green';
  if (p === 'AUTO' || p === 'AUTO_PAUSE') return 'active';
  if (!hubActive(p, a, firstInactive)) return 'off';
  // Aviso de desactivación: pulsa 3 s antes (y hasta el final del match)
  if (deactivatesSoon(t, a, firstInactive, 3)) return 'pulse';
  if (p === 'TRANSITION' && a === firstInactive) return 'chase';
  return 'active';
}

