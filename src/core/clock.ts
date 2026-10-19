/**
 * Reloj del match (Game Manual §6.4, Tabla 6-2). `t` = segundos desde el inicio del match
 * (0 = arranca AUTO). Entre AUTO y TELEOP hay 3 s de evaluación con robots deshabilitados.
 */
import type { Phase } from './types';

export const AUTO_LEN = 20;
export const AUTO_PAUSE_LEN = 3;
export const TRANSITION_LEN = 10;
export const SHIFT_LEN = 25;
export const END_GAME_LEN = 30;
export const POST_LEN = 3;
export const TELEOP_LEN = TRANSITION_LEN + 4 * SHIFT_LEN + END_GAME_LEN; // 140 s = 2:20

/** Instantes (s desde el inicio) de cada frontera. */
export const T = {
  autoStart: 0,
  autoEnd: AUTO_LEN, // 20
  teleopStart: AUTO_LEN + AUTO_PAUSE_LEN, // 23
  shift1: AUTO_LEN + AUTO_PAUSE_LEN + TRANSITION_LEN, // 33 (2:10)
  shift2: 33 + SHIFT_LEN, // 58 (1:45)
  shift3: 33 + 2 * SHIFT_LEN, // 83 (1:20)
  shift4: 33 + 3 * SHIFT_LEN, // 108 (0:55)
  endGame: 33 + 4 * SHIFT_LEN, // 133 (0:30)
  teleopEnd: AUTO_LEN + AUTO_PAUSE_LEN + TELEOP_LEN, // 163 (0:00)
  postEnd: AUTO_LEN + AUTO_PAUSE_LEN + TELEOP_LEN + POST_LEN, // 166
} as const;

const ORDER: Array<[Phase, number, number]> = [
  ['AUTO', T.autoStart, T.autoEnd],
  ['AUTO_PAUSE', T.autoEnd, T.teleopStart],
  ['TRANSITION', T.teleopStart, T.shift1],
  ['SHIFT1', T.shift1, T.shift2],
  ['SHIFT2', T.shift2, T.shift3],
  ['SHIFT3', T.shift3, T.shift4],
  ['SHIFT4', T.shift4, T.endGame],
  ['END_GAME', T.endGame, T.teleopEnd],
  ['POST', T.teleopEnd, T.postEnd],
];

export function phaseAt(t: number): Phase {
  if (t < 0) return 'PRE';
  for (const [p, a, b] of ORDER) if (t >= a && t < b) return p;
  return 'DONE';
}

export function phaseBounds(p: Phase): [number, number] {
  const hit = ORDER.find((o) => o[0] === p);
  if (hit) return [hit[1], hit[2]];
  return p === 'PRE' ? [-Infinity, 0] : [T.postEnd, Infinity];
}

export const isTeleop = (p: Phase): boolean =>
  p === 'TRANSITION' || p === 'SHIFT1' || p === 'SHIFT2' || p === 'SHIFT3' || p === 'SHIFT4' || p === 'END_GAME';

export const isAllianceShift = (p: Phase): boolean => p === 'SHIFT1' || p === 'SHIFT2' || p === 'SHIFT3' || p === 'SHIFT4';

/** ¿Los robots están habilitados? (AUTO y TELEOP; no en la pausa ni después). */
export const robotsEnabled = (p: Phase): boolean => p === 'AUTO' || isTeleop(p);

/** Segundos que muestra el timer de la ARENA: AUTO 0:20→0:00, TELEOP 2:20→0:00. */
export function timerSeconds(t: number): number {
  const p = phaseAt(t);
  if (p === 'PRE') return AUTO_LEN;
  if (p === 'AUTO') return Math.max(0, T.autoEnd - t);
  if (p === 'AUTO_PAUSE') return 0;
  if (isTeleop(p)) return Math.max(0, T.teleopEnd - t);
  return 0;
}

/** Formato m:ss (se redondea hacia arriba como los timers de la ARENA). */
export function formatTimer(sec: number): string {
  const s = Math.max(0, Math.ceil(sec - 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Segundos hasta el próximo cambio de estado de los HUBS (null si no hay más). */
export function timeToNextShiftChange(t: number): number | null {
  const marks = [T.shift1, T.shift2, T.shift3, T.shift4, T.endGame];
  for (const m of marks) if (t < m && t >= T.teleopStart) return m - t;
  return null;
}
