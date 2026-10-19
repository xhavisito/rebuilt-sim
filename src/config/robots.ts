/**
 * Especificación de robots, presets inventados y validación contra el manual.
 * R103 peso ≤ 115 lb sin BUMPERS ni batería · R104 perímetro ≤ 110 in y altura ≤ 30 in
 * R105 extensión ≤ 12 in · R106 un solo lado · R107 altura ≤ 30 in siempre.
 */
import { inch, MAX_EXTENSION, MAX_HEIGHT, MAX_PERIMETER, TRENCH_CLEAR_HEIGHT } from './field';
import { loadJSON, saveJSON } from './settings';

export type Drivetrain = 'swerve' | 'tank';
export type ShooterType = 'fixed' | 'turret';

export interface RobotSpec {
  id: string;
  name: string;
  teamNumber: number;
  /** Marco (sin BUMPERS), pulgadas. */
  widthIn: number;
  lengthIn: number;
  heightIn: number;
  /** Grosor de BUMPER (pulgadas). */
  bumperIn: number;
  /** Masa total con BUMPERS y batería (kg). */
  massKg: number;
  drivetrain: Drivetrain;
  /** Velocidad libre (m/s). */
  maxSpeed: number;
  /** Aceleración máxima del motor (m/s²); la tracción la limita aún más. */
  maxAccel: number;
  /** Coeficiente de fricción rueda-alfombra. */
  traction: number;
  /** Velocidad angular máxima (rad/s). */
  maxOmega: number;
  intake: {
    /** Ancho de entrada (pulgadas). */
    widthIn: number;
    /** Cuánto sobresale del perímetro al desplegarse (pulgadas). R105: ≤ 12. */
    extensionIn: number;
    /** FUEL por segundo. */
    rate: number;
  };
  hopperCapacity: number;
  shooter: {
    type: ShooterType;
    /** FUEL por segundo. */
    rate: number;
    /** Velocidad de salida máxima (m/s). */
    maxSpeed: number;
    /** Ángulo del hood: rango (grados sobre la horizontal). */
    minAngle: number;
    maxAngle: number;
    /** Precisión 0–1 (1 = sin dispersión). */
    accuracy: number;
    /** Altura de salida (pulgadas). */
    exitHeightIn: number;
    /** Backspin (rad/s) para efecto Magnus. */
    backspin: number;
  };
  climb: {
    maxLevel: 0 | 1 | 2 | 3;
    /** Segundos para alcanzar cada nivel desde el piso. */
    timeL1: number;
    timeL2: number;
    timeL3: number;
  };
  colors: { primary: string; accent: string };
  preload: number;
}

export interface ValidationIssue {
  rule: string;
  message: { es: string; en: string };
  fatal: boolean;
}

export const perimeterIn = (s: RobotSpec): number => 2 * (s.widthIn + s.lengthIn);
export const fitsUnderTrench = (s: RobotSpec): boolean => inch(s.heightIn) <= TRENCH_CLEAR_HEIGHT;

export function validateSpec(s: RobotSpec): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (inch(perimeterIn(s)) > MAX_PERIMETER + 1e-6)
    out.push({
      rule: 'R104',
      fatal: true,
      message: {
        es: `Perímetro de ${perimeterIn(s).toFixed(1)} in excede 110 in`,
        en: `Perimeter ${perimeterIn(s).toFixed(1)} in exceeds 110 in`,
      },
    });
  if (inch(s.heightIn) > MAX_HEIGHT + 1e-6)
    out.push({
      rule: 'R104/R107',
      fatal: true,
      message: { es: 'La altura excede 30 in', en: 'Height exceeds 30 in' },
    });
  if (inch(s.intake.extensionIn) > MAX_EXTENSION + 1e-6)
    out.push({
      rule: 'R105/G413',
      fatal: false,
      message: {
        es: 'La intake sobresale más de 12 in: el árbitro marcará G413 (MAJOR)',
        en: 'Intake extends more than 12 in: referee will call G413 (MAJOR)',
      },
    });
  // R103: 115 lb (52.16 kg) + BUMPERS (~15 lb) + batería (~13 lb) ≈ 64.9 kg
  if (s.massKg > 65.0)
    out.push({
      rule: 'R103',
      fatal: true,
      message: {
        es: 'Masa total > 65 kg (115 lb + BUMPERS + batería)',
        en: 'Total mass > 65 kg (115 lb + BUMPERS + battery)',
      },
    });
  if (s.preload > 8)
    out.push({ rule: 'G303', fatal: true, message: { es: 'Máximo 8 FUEL precargados', en: 'Max 8 preloaded FUEL' } });
  if (s.preload > s.hopperCapacity)
    out.push({
      rule: 'G303',
      fatal: true,
      message: { es: 'La precarga excede la capacidad del hopper', en: 'Preload exceeds hopper capacity' },
    });
  if (s.widthIn < 15 || s.lengthIn < 15)
    out.push({ rule: '—', fatal: true, message: { es: 'Dimensiones demasiado pequeñas', en: 'Dimensions too small' } });
  return out;
}

const base = (o: Partial<RobotSpec> & Pick<RobotSpec, 'id' | 'name'>): RobotSpec => ({
  teamNumber: 9999,
  widthIn: 27,
  lengthIn: 27,
  heightIn: 24,
  bumperIn: 3.25,
  massKg: 62,
  drivetrain: 'swerve',
  maxSpeed: 4.8,
  maxAccel: 9,
  traction: 1.1,
  maxOmega: 9,
  intake: { widthIn: 24, extensionIn: 10, rate: 8 },
  hopperCapacity: 40,
  shooter: {
    type: 'fixed',
    rate: 6,
    maxSpeed: 12,
    minAngle: 45,
    maxAngle: 75,
    accuracy: 0.85,
    exitHeightIn: 22,
    backspin: 30,
  },
  climb: { maxLevel: 1, timeL1: 3, timeL2: 6, timeL3: 9 },
  colors: { primary: '#5b6470', accent: '#f2b705' },
  preload: 8,
  ...o,
});

/** Presets inventados (no copian diseños reales de equipos). */
export const ROBOT_PRESETS: RobotSpec[] = [
  base({
    id: 'tank',
    name: 'Tanque de FUEL',
    teamNumber: 1001,
    widthIn: 28,
    lengthIn: 27,
    heightIn: 27,
    massKg: 63,
    maxSpeed: 4.6,
    intake: { widthIn: 26, extensionIn: 11, rate: 12 },
    hopperCapacity: 70,
    shooter: {
      type: 'fixed',
      rate: 12,
      maxSpeed: 13,
      minAngle: 50,
      maxAngle: 72,
      accuracy: 0.86,
      exitHeightIn: 25,
      backspin: 35,
    },
    climb: { maxLevel: 0, timeL1: 99, timeL2: 99, timeL3: 99 },
    colors: { primary: '#3d4a57', accent: '#ff8a00' },
  }),
  base({
    id: 'balanced',
    name: 'Equilibrado',
    teamNumber: 2002,
    heightIn: 24,
    massKg: 61,
    maxSpeed: 4.9,
    hopperCapacity: 40,
    intake: { widthIn: 24, extensionIn: 10, rate: 9 },
    shooter: {
      type: 'turret',
      rate: 7,
      maxSpeed: 12.5,
      minAngle: 45,
      maxAngle: 78,
      accuracy: 0.9,
      exitHeightIn: 23,
      backspin: 30,
    },
    climb: { maxLevel: 2, timeL1: 2.5, timeL2: 5.5, timeL3: 99 },
    colors: { primary: '#6d7480', accent: '#19b5fe' },
  }),
  base({
    id: 'climber',
    name: 'Escalador',
    teamNumber: 3003,
    widthIn: 26,
    lengthIn: 26,
    heightIn: 21.5, // < 22.25 in → cabe bajo el TRENCH
    massKg: 58,
    maxSpeed: 5.2,
    hopperCapacity: 20,
    intake: { widthIn: 22, extensionIn: 9, rate: 7 },
    shooter: {
      type: 'fixed',
      rate: 5,
      maxSpeed: 12,
      minAngle: 48,
      maxAngle: 75,
      accuracy: 0.84,
      exitHeightIn: 19,
      backspin: 25,
    },
    climb: { maxLevel: 3, timeL1: 2.2, timeL2: 4.8, timeL3: 7.5 },
    colors: { primary: '#2e3138', accent: '#a5ff3c' },
  }),
  base({
    id: 'defender',
    name: 'Defensor',
    teamNumber: 4004,
    widthIn: 30,
    lengthIn: 25, // perímetro 110 in
    heightIn: 20,
    massKg: 64.8,
    traction: 1.35,
    maxSpeed: 4.4,
    maxAccel: 11,
    hopperCapacity: 15,
    intake: { widthIn: 26, extensionIn: 6, rate: 6 },
    shooter: {
      type: 'fixed',
      rate: 4,
      maxSpeed: 11,
      minAngle: 50,
      maxAngle: 70,
      accuracy: 0.75,
      exitHeightIn: 17,
      backspin: 20,
    },
    climb: { maxLevel: 1, timeL1: 3.5, timeL2: 99, timeL3: 99 },
    colors: { primary: '#1d1f24', accent: '#ff3b30' },
    preload: 8,
  }),
];

export function presetById(id: string): RobotSpec {
  return structuredClone(ROBOT_PRESETS.find((p) => p.id === id) ?? ROBOT_PRESETS[1]);
}

// ------------------------------------------------------------------ robots personalizados

const CUSTOM_KEY = 'rebuilt-sim.robots.v1';

export function loadCustomRobots(): RobotSpec[] {
  return loadJSON<RobotSpec[]>(CUSTOM_KEY, []);
}

export function saveCustomRobots(list: RobotSpec[]): void {
  saveJSON(CUSTOM_KEY, list);
}

/** Presets + robots del editor. */
export function allRobots(): RobotSpec[] {
  return [...ROBOT_PRESETS, ...loadCustomRobots()];
}

/** Busca por id en presets y personalizados (copia). */
export function robotById(id: string): RobotSpec {
  return structuredClone(allRobots().find((r) => r.id === id) ?? ROBOT_PRESETS[1]);
}
