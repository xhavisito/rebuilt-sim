/** Tipos compartidos de la lógica pura del juego (sin Three.js ni Rapier). */

export type Alliance = 'red' | 'blue';
export const ALLIANCES: readonly Alliance[] = ['red', 'blue'];
export const opponent = (a: Alliance): Alliance => (a === 'red' ? 'blue' : 'red');

export type StationNumber = 1 | 2 | 3;

/** Periodos/fases del match (Game Manual §6.4, Tabla 6-2). */
export type Phase =
  | 'PRE' // antes de empezar
  | 'AUTO' // 0:20 → 0:00
  | 'AUTO_PAUSE' // 3 s de evaluación entre AUTO y TELEOP (§6.4, §6.5-A)
  | 'TRANSITION' // 2:20 → 2:10
  | 'SHIFT1' // 2:10 → 1:45
  | 'SHIFT2' // 1:45 → 1:20
  | 'SHIFT3' // 1:20 → 0:55
  | 'SHIFT4' // 0:55 → 0:30
  | 'END_GAME' // 0:30 → 0:00
  | 'POST' // 3 s de evaluación post-match (§6.5-B)
  | 'DONE';

export type EventType = 'regional' | 'districtChamp' | 'champs';

export type FoulSeverity = 'MINOR' | 'MAJOR';
export type CardType = 'YELLOW' | 'RED';

/** Luz de un HUB (Tabla 5-3). */
export type HubLight = 'off' | 'active' | 'pulse' | 'chase' | 'white' | 'purple' | 'green';

export type TowerLevel = 0 | 1 | 2 | 3;
