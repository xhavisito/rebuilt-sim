/**
 * Medidas del campo REBUILT (Game Manual TU22 §5) en METROS.
 * La medida original en pulgadas va en el comentario de cada constante.
 *
 * Sistema de coordenadas (ver docs/PLAN.md):
 *   origen = centro del campo, +Y arriba, +X hacia la ALLIANCE WALL roja (azul en −X),
 *   Z = −y_WPILib. Todo lo de la alianza roja es la rotación 180° (x,z)→(−x,−z) de la azul.
 * Posiciones tomadas del layout oficial de AprilTags de WPILib "2026-rebuilt-welded".
 */
import type { Alliance } from '../core/types';

export const IN = 0.0254;
/** Convierte pulgadas a metros. */
export const inch = (v: number): number => v * IN;

/** Convierte coordenadas WPILib (pulgadas, origen esquina azul) a mundo (m). */
export function wpiToWorld(xIn: number, yIn: number): { x: number; z: number } {
  return { x: inch(xIn - FIELD_LENGTH_IN / 2), z: -inch(yIn - FIELD_WIDTH_IN / 2) };
}

export const FIELD_LENGTH_IN = 651.2; // §5.2 ≈ 16.54 m
export const FIELD_WIDTH_IN = 317.7; // §5.2 ≈ 8.07 m
export const FIELD_LENGTH = 16.541; // WPILib field-dimensions
export const FIELD_WIDTH = 8.069;
export const HALF_L = FIELD_LENGTH / 2;
export const HALF_W = FIELD_WIDTH / 2;

export const GUARDRAIL_HEIGHT = inch(20.0); // §5.2 policarbonato
export const TAPE_WIDTH = inch(2.0); // §5.3

// ---------------------------------------------------------------- Zonas (§5.3)
export const ALLIANCE_ZONE_DEPTH = inch(158.6); // ALLIANCE ZONE 158.6 in
/** X de la ROBOT STARTING LINE (borde de la ALLIANCE ZONE) para azul; la cinta va hacia la pared. */
export const STARTING_LINE_X_BLUE = -HALF_L + ALLIANCE_ZONE_DEPTH;
export const NEUTRAL_ZONE_DEPTH = inch(283); // NEUTRAL ZONE 283 in (referencia)
export const CENTER_LINE_X = 0;
export const HUMAN_STARTING_LINE_DIST = inch(24.0);
export const OUTPOST_AREA_WIDTH = inch(71.0);
export const ALLIANCE_AREA_DEPTH = inch(134);

// ---------------------------------------------------------------- HUB (§5.4)
export const HUB_SIZE = inch(47); // 47 × 47 in
/** Centro del HUB azul (tags 18–21, 24–27): x = 182.11 in, y = 158.84 in. */
export const HUB_CENTER_X_BLUE = inch(182.11 - FIELD_LENGTH_IN / 2);
export const HUB_OPENING_HEX = inch(41.7); // abertura hexagonal (supuesto: entre vértices)
export const HUB_RIM_HEIGHT = inch(72); // borde frontal de la abertura
/** Altura del cuerpo sólido bajo el embudo; el FUEL que cae aquí ya pasó el sensor. */
export const HUB_INNER_FLOOR = 1.32;
/** El FUEL se cuenta al cruzar este nivel dentro del hexágono (sensor array §6.5.1). */
export const HUB_SENSOR_HEIGHT = HUB_RIM_HEIGHT - 0.3;
export const HUB_NET_TOP = inch(102); // TODO: verificar con CAD oficial (supuesto 1, PLAN.md)
export const HUB_APRILTAG_HEIGHT = inch(44.25);
/** Salidas del HUB hacia la NEUTRAL ZONE (§5.4 fig. 5-8, aproximación). Offsets en Z (azul). */
export const HUB_EXIT_OFFSETS = [-0.45, -0.15, 0.15, 0.45];
export const HUB_EXIT_HEIGHT = 0.16;
/** Tiempo de procesamiento interno antes de expulsar (supuesto 3). */
export const HUB_PROCESS_MIN = 0.6;
export const HUB_PROCESS_MAX = 1.4;

// ---------------------------------------------------------------- BUMP (§5.5)
export const BUMP_WIDTH = inch(73.0); // a lo largo de Z
export const BUMP_DEPTH = inch(44.4); // a lo largo de X
export const BUMP_HEIGHT = inch(6.513);
export const BUMP_ANGLE_DEG = 15;
/** Centro Z de cada BUMP (azul): pegado al HUB. */
export const BUMP_CENTER_Z = HUB_SIZE / 2 + BUMP_WIDTH / 2;

// ---------------------------------------------------------------- TRENCH (§5.6)
export const TRENCH_WIDTH = inch(65.65);
export const TRENCH_DEPTH = inch(47.0);
export const TRENCH_HEIGHT = inch(40.25);
export const TRENCH_CLEAR_WIDTH = inch(50.34);
export const TRENCH_CLEAR_HEIGHT = inch(22.25);
/** Brazo horizontal: grosor en X (supuesto ≈ 6 in, de la vista superior de WPILib). */
export const TRENCH_ARM_DEPTH = inch(6);
export const TRENCH_ARM_TOP = inch(30); // TODO: verificar con CAD oficial
export const TRENCH_APRILTAG_HEIGHT = inch(35);
/** Borde interior del TRENCH (lado BUMP), en |Z|. */
export const TRENCH_INNER_Z = BUMP_CENTER_Z + BUMP_WIDTH / 2;

// ---------------------------------------------------------------- DEPOT (§5.7)
export const DEPOT_WIDTH = inch(42.0); // a lo largo de la pared (Z)
export const DEPOT_DEPTH = inch(27.0); // hacia el campo (X)
export const DEPOT_BARRIER_W = inch(3.0);
export const DEPOT_BARRIER_H = inch(1.125); // 1.0 in + hook fastener
/** Centro del DEPOT azul en y_WPILib ≈ 233 in (imagen de campo WPILib). TODO: verificar con CAD oficial */
export const DEPOT_CENTER_Y_IN = 233.5;

// ---------------------------------------------------------------- TOWER (§5.8)
export const TOWER_WIDTH = inch(49.25);
export const TOWER_DEPTH = inch(45.0);
export const TOWER_HEIGHT = inch(78.25);
export const TOWER_BASE_WIDTH = inch(39.0);
export const TOWER_BASE_DEPTH = inch(45.18);
export const TOWER_BASE_THICK = inch(0.3); // bordes 0.2–0.3 in
export const UPRIGHT_HEIGHT = inch(72.1);
export const UPRIGHT_THICK = inch(1.5); // a lo largo de Z
export const UPRIGHT_DEEP = inch(3.5); // a lo largo de X
export const UPRIGHT_GAP = inch(32.25); // distancia entre UPRIGHTS
export const RUNG_OD = inch(1.66);
export const RUNG_OVERHANG = inch(5.875);
export const RUNG_HEIGHTS = { LOW: inch(27.0), MID: inch(45.0), HIGH: inch(63.0) } as const;
export const TOWER_SUPPORT_LOW = inch(28.4);
export const TOWER_SUPPORT_HIGH = inch(43.38);
/** Centro de la TOWER azul en y_WPILib = 147.47 in (tag 31 centrado). */
export const TOWER_CENTER_Y_IN = 147.47;
/** Distancia pared→UPRIGHTS (vista superior WPILib ≈ 42 in). TODO: verificar con CAD oficial */
export const UPRIGHT_X_FROM_WALL = inch(42.0);

// ---------------------------------------------------------------- ALLIANCE WALL (§5.9)
export const DS_BASE_HEIGHT = inch(36.8);
export const DS_GLASS_HEIGHT = inch(42);
export const DS_TOTAL_HEIGHT = DS_BASE_HEIGHT + DS_GLASS_HEIGHT;
export const DS_SHELF_DEPTH = inch(12.25);
export const TOWER_WALL_Y_IN: [number, number] = [TOWER_CENTER_Y_IN - 49.25 / 2, TOWER_CENTER_Y_IN + 49.25 / 2];
/**
 * Rangos y_WPILib (in) de cada DRIVER STATION azul (vista superior WPILib), contiguos:
 * OUTPOST [0,53] · DS3 · TOWER WALL · DS2 · DS1. TODO: verificar con CAD oficial
 */
export const DS_RANGES_Y_IN: Record<1 | 2 | 3, [number, number]> = {
  1: [243.5, FIELD_WIDTH_IN],
  2: [TOWER_WALL_Y_IN[1], 243.5],
  3: [53.0, TOWER_WALL_Y_IN[0]],
};

// ---------------------------------------------------------------- OUTPOST (§5.9.2)
export const OUTPOST_CENTER_Y_IN = 26.219; // tag 29, centrado con CHUTE y CORRAL
export const OUTPOST_WALL_Y_IN: [number, number] = [0, 53.0];
export const OUTPOST_WALL_HEIGHT = inch(50); // TODO: verificar con CAD oficial
export const CHUTE_OPEN_W = inch(31.8);
export const CHUTE_OPEN_H = inch(7.0);
export const CHUTE_OPEN_BOTTOM = inch(28.1);
export const CHUTE_ANGLE_DEG = 15;
export const CHUTE_CAPACITY = 25;
export const CHUTE_START = 24;
export const CORRAL_OPEN_W = inch(32.0);
export const CORRAL_OPEN_H = inch(7.0);
export const CORRAL_OPEN_BOTTOM = inch(1.88);
export const CORRAL_PIPE_OD = inch(1.66);
export const CORRAL_W = inch(35.8);
export const CORRAL_D = inch(37.6);
export const CORRAL_PANEL_H = inch(8.13);
export const CORRAL_CAPACITY = 36; // supuesto 6 (PLAN.md)

// ---------------------------------------------------------------- FUEL (§5.10.1, §6.3.4)
export const FUEL_DIAMETER = inch(5.91);
export const FUEL_RADIUS = FUEL_DIAMETER / 2;
export const FUEL_MASS_MIN = 0.203;
export const FUEL_MASS_MAX = 0.227;
export const FUEL_TOTAL = 504;
export const FUEL_TOTAL_CHAMPS = 600;
export const FUEL_PER_DEPOT = 24;
export const FUEL_PER_CHUTE = 24;
export const FUEL_MAX_PRELOAD = 8;
export const NEUTRAL_BOX_W = inch(206.0); // a lo largo de Z
export const NEUTRAL_BOX_D = inch(72.0); // a lo largo de X
export const NEUTRAL_BOX_GAP = inch(2.0);

// ---------------------------------------------------------------- ROBOT (§8)
export const BUMPER_ZONE_LOW = inch(2.5); // R405
export const BUMPER_ZONE_HIGH = inch(5.75);
export const MAX_PERIMETER = inch(110); // R104
export const MAX_HEIGHT = inch(30); // R104/R107
export const MAX_EXTENSION = inch(12); // R105
export const PIN_SEPARATION = inch(72.0); // G418

// ---------------------------------------------------------------- AprilTags (WPILib welded, pulgadas)
/** id, x, y, z, rotación Z (grados) — coordenadas WPILib. */
export const APRILTAGS_IN: ReadonlyArray<[number, number, number, number, number]> = [
  [1, 467.637, 292.314, 35, 180], [2, 469.111, 182.6, 44.25, 90], [3, 445.349, 172.844, 44.25, 180],
  [4, 445.349, 158.844, 44.25, 180], [5, 469.111, 135.088, 44.25, 270], [6, 467.637, 25.374, 35, 180],
  [7, 470.586, 25.374, 35, 0], [8, 483.111, 135.088, 44.25, 270], [9, 492.881, 144.844, 44.25, 0],
  [10, 492.881, 158.844, 44.25, 0], [11, 483.111, 182.6, 44.25, 90], [12, 470.586, 292.314, 35, 0],
  [13, 650.918, 291.469, 21.75, 180], [14, 650.918, 274.469, 21.75, 180], [15, 650.904, 170.219, 21.75, 180],
  [16, 650.904, 153.219, 21.75, 180], [17, 183.586, 25.374, 35, 0], [18, 182.111, 135.088, 44.25, 270],
  [19, 205.873, 144.844, 44.25, 0], [20, 205.873, 158.844, 44.25, 0], [21, 182.111, 182.6, 44.25, 90],
  [22, 183.586, 292.314, 35, 0], [23, 180.637, 292.314, 35, 180], [24, 168.111, 182.6, 44.25, 90],
  [25, 158.341, 172.844, 44.25, 180], [26, 158.341, 158.844, 44.25, 180], [27, 168.111, 135.088, 44.25, 270],
  [28, 180.637, 25.374, 35, 180], [29, 0.305, 26.219, 21.75, 0], [30, 0.305, 43.219, 21.75, 0],
  [31, 0.318, 147.469, 21.75, 0], [32, 0.318, 164.469, 21.75, 0],
];
export const APRILTAG_SIZE = inch(8.125);
export const APRILTAG_PANEL = inch(10.5);

// ---------------------------------------------------------------- Helpers por alianza
/** Signo de la alianza: azul = −1 (lado −X), rojo = +1. */
export const allianceSign = (a: Alliance): 1 | -1 => (a === 'red' ? 1 : -1);

/** Rota un punto del lado azul al lado de la alianza indicada (simetría de 180°). */
export function sideXZ(a: Alliance, x: number, z: number): { x: number; z: number } {
  return a === 'blue' ? { x, z } : { x: -x, z: -z };
}

export function hubCenter(a: Alliance): { x: number; z: number } {
  return sideXZ(a, HUB_CENTER_X_BLUE, 0);
}

/** X de la pared de la alianza. */
export const allianceWallX = (a: Alliance): number => allianceSign(a) * HALF_L;

/** ¿El punto x está dentro de la ALLIANCE ZONE de `a`? */
export function inAllianceZoneX(a: Alliance, x: number): boolean {
  return a === 'blue' ? x <= STARTING_LINE_X_BLUE : x >= -STARTING_LINE_X_BLUE;
}

/** Centro de la TOWER (en la pared) y X de los UPRIGHTS. */
export function towerInfo(a: Alliance): { cx: number; cz: number; uprightX: number; facing: number } {
  const blueZ = -inch(TOWER_CENTER_Y_IN - FIELD_WIDTH_IN / 2);
  const p = sideXZ(a, -HALF_L, blueZ);
  const up = sideXZ(a, -HALF_L + UPRIGHT_X_FROM_WALL, blueZ);
  // facing = dirección (en X) hacia el campo desde la pared
  return { cx: p.x, cz: p.z, uprightX: up.x, facing: a === 'blue' ? 1 : -1 };
}

export function outpostInfo(a: Alliance): { x: number; z: number } {
  return sideXZ(a, -HALF_L, -inch(OUTPOST_CENTER_Y_IN - FIELD_WIDTH_IN / 2));
}

export function depotCenter(a: Alliance): { x: number; z: number } {
  return sideXZ(a, -HALF_L + DEPOT_DEPTH / 2, -inch(DEPOT_CENTER_Y_IN - FIELD_WIDTH_IN / 2));
}

/** Centro (Z) de una DRIVER STATION de la alianza, en la pared. */
export function driverStationCenter(a: Alliance, ds: 1 | 2 | 3): { x: number; z: number } {
  const [y0, y1] = DS_RANGES_Y_IN[ds];
  return sideXZ(a, -HALF_L, -inch((y0 + y1) / 2 - FIELD_WIDTH_IN / 2));
}
