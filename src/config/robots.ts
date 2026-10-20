/**
 * Especificación de robots: robots reales de 2026 (con su CAD), presets genéricos y validación.
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
    /** FUEL a lo ancho del shooter ("dumper" de 3–5 carriles); 1 = un solo chorro. */
    lanes?: number;
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
  /** Modelo 3D real del equipo (public/robots/<file>), ver scripts/robots/. */
  cad?: { file: string };
  /** Robot real de la temporada: fuente de los datos (para la galería). */
  real?: { team: string; robot: string; note: { es: string; en: string } };
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

const NO_CLIMB = { maxLevel: 0 as const, timeL1: 99, timeL2: 99, timeL3: 99 };

const cadReal = (team: string, robot: string, es: string, en: string) => ({ team, robot, note: { es, en } });

/**
 * Robots de 2026 con su modelo 3D REAL (publicado por cada equipo en su repo de código como
 * asset de AdvantageScope; ver scripts/robots/ y public/robots/LICENSES.md). Medidas del
 * chasis y altura tomadas del CAD; rendimiento según sus tech binders / Robot Study Dashboard
 * y EPA de Statbotics (estimado donde no se publicó).
 */
export const CAD_ROBOTS: RobotSpec[] = [
  base({
    id: 'cad-1678',
    name: 'Limestone',
    teamNumber: 1678,
    widthIn: 27,
    lengthIn: 27,
    heightIn: 22,
    massKg: 63,
    maxSpeed: 4.8,
    traction: 1.25,
    intake: { widthIn: 26, extensionIn: 10, rate: 18 },
    hopperCapacity: 70,
    shooter: { type: 'fixed', rate: 22, maxSpeed: 13, minAngle: 40, maxAngle: 78, accuracy: 0.92, exitHeightIn: 21, backspin: 20, lanes: 4 },
    climb: NO_CLIMB,
    colors: { primary: '#c9cdd3', accent: '#2fbf4a' },
    cad: { file: '1678.glb' },
    real: cadReal('Citrus Circuits', 'Limestone', 'Ganador de la división Milstein, EPA #15. Flywheel con hood alimentado por un tambor de ancho completo; intake slapdown de ancho completo; hopper expandible.', 'Milstein division winner, #15 EPA. Hooded flywheel fed by a full-width drum; full-width slapdown intake; expanding hopper.'),
  }),
  base({
    id: 'cad-5000',
    name: 'Icarus',
    teamNumber: 5000,
    widthIn: 26,
    lengthIn: 28.5,
    heightIn: 22,
    massKg: 62,
    maxSpeed: 4.8,
    intake: { widthIn: 24, extensionIn: 10, rate: 14 }, // cremallera
    hopperCapacity: 50,
    shooter: { type: 'turret', rate: 14, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.93, exitHeightIn: 21, backspin: 20, lanes: 1 },
    climb: NO_CLIMB,
    colors: { primary: '#2b2f36', accent: '#00b3ff' },
    cad: { file: '5000.glb' },
    real: cadReal('Hammerheads', 'Icarus', 'EPA #34. Turret con visión que tira en movimiento, alimentada por un "dye rotor"; intake de cremallera.', '#34 EPA. Vision-tracking turret that shoots on the move, fed by a "dye rotor"; rack-and-pinion intake.'),
  }),
  base({
    id: 'cad-604',
    name: 'Toploader',
    teamNumber: 604,
    widthIn: 27,
    lengthIn: 27,
    heightIn: 20.5,
    massKg: 62,
    maxSpeed: 4.8,
    intake: { widthIn: 25, extensionIn: 10, rate: 15 },
    hopperCapacity: 50,
    shooter: { type: 'turret', rate: 15, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.93, exitHeightIn: 20, backspin: 20, lanes: 1 },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#ff8800' },
    cad: { file: '604.glb' },
    real: cadReal('Quixilver', 'Toploader', 'EPA #48. Turret de un chorro (~15 FUEL/s) alimentada por un "dye rotor" circular para tirar en movimiento; brazos de intake independientes.', '#48 EPA. Single-stream turret (~15 FUEL/s) fed by a circular "dye rotor" to shoot on the move; independent intake arms.'),
  }),
  base({
    id: 'cad-6328',
    name: 'Darwin',
    teamNumber: 6328,
    widthIn: 27,
    lengthIn: 28,
    heightIn: 22,
    massKg: 62,
    maxSpeed: 4.9,
    intake: { widthIn: 25, extensionIn: 10, rate: 12 },
    hopperCapacity: 40,
    shooter: { type: 'turret', rate: 10, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.94, exitHeightIn: 21, backspin: 25, lanes: 1 },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#1a5cff' },
    cad: { file: '6328.glb' },
    real: cadReal('Mechanical Advantage', 'Darwin', 'Turret con hood ajustable impreso en 3D y rueda Fairlane de 4 in; los creadores de AdvantageKit y AdvantageScope.', 'Turret with a 3D-printed adjustable hood and a 4 in Fairlane wheel; the makers of AdvantageKit and AdvantageScope.'),
  }),
  base({
    id: 'cad-971',
    name: 'Mixtape',
    teamNumber: 971,
    widthIn: 29,
    lengthIn: 26,
    heightIn: 19.5,
    massKg: 63,
    maxSpeed: 4.8,
    intake: { widthIn: 26, extensionIn: 10, rate: 16 },
    hopperCapacity: 45,
    shooter: { type: 'turret', rate: 18, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.92, exitHeightIn: 19, backspin: 20, lanes: 2 },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#b088b8' },
    cad: { file: '971.glb' },
    real: cadReal('Spartan Robotics', 'Mixtape', 'Doble turret: dos shooters con hood de tornillo, alimentados por un spindexer.', 'Double turret: two shooters with lead-screw hoods, fed by a spindexer.'),
  }),
  base({
    id: 'cad-341',
    name: 'Miss Daisy XXIV',
    teamNumber: 341,
    widthIn: 27,
    lengthIn: 27,
    heightIn: 27,
    massKg: 64,
    maxSpeed: 4.8,
    intake: { widthIn: 26, extensionIn: 10, rate: 12 }, // 4 FUEL de ancho
    hopperCapacity: 10, // sin hopper: camino directo 4-2-1 (~8 en tránsito)
    shooter: { type: 'turret', rate: 10, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.93, exitHeightIn: 26, backspin: 20, lanes: 1 },
    climb: { maxLevel: 1, timeL1: 3, timeL2: 99, timeL3: 99 },
    colors: { primary: '#30343b', accent: '#2340d0' },
    cad: { file: '341.glb' },
    real: cadReal('Miss Daisy', 'Miss Daisy XXIV', 'Sin hopper: intake de 4 FUEL de ancho que va directo (4-2-1) a una turret de 360°; climber L1 ligero.', 'Hopperless: a 4-wide intake feeding straight (4-2-1) into a 360° turret; lightweight L1 climber.'),
  }),
  base({
    id: 'cad-190',
    name: 'Turnover',
    teamNumber: 190,
    widthIn: 30.5,
    lengthIn: 22,
    heightIn: 22,
    massKg: 61,
    maxSpeed: 4.9,
    intake: { widthIn: 28, extensionIn: 10, rate: 14 },
    hopperCapacity: 40,
    shooter: { type: 'turret', rate: 12, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.92, exitHeightIn: 21, backspin: 20, lanes: 1 },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#c62828' },
    cad: { file: '190.glb' },
    real: cadReal('Gompei and the HERD', 'Doomspiral / Turnover', 'Turret con "kicker" de banda que comprime el FUEL contra la flywheel; intake de rodillos.', 'Turret with a belt "kicker" that compresses FUEL into the flywheel; roller intake.'),
  }),
  base({
    id: 'cad-4915',
    name: 'Artemis',
    teamNumber: 4915,
    widthIn: 28.5,
    lengthIn: 26.5,
    heightIn: 25,
    massKg: 63,
    maxSpeed: 4.6,
    intake: { widthIn: 26, extensionIn: 8.4, rate: 12 }, // 213 mm de extensión (código)
    hopperCapacity: 45,
    shooter: { type: 'turret', rate: 10, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.92, exitHeightIn: 24, backspin: 20, lanes: 1 },
    climb: { maxLevel: 1, timeL1: 3.2, timeL2: 99, timeL3: 99 },
    colors: { primary: '#30343b', accent: '#ef3e00' },
    cad: { file: '4915.glb' },
    real: cadReal('Spartronics', 'ARTEMIS', 'Ganador de división. Turret con hood ajustable sobre una superestructura que pivota; tiene climber.', 'Division winner. Turret with an adjustable hood on a pivoting superstructure; has a climber.'),
  }),
];

/** Presets genéricos (diseños inventados) + los mejores robots de la temporada. */
const GENERIC_PRESETS: RobotSpec[] = [
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
    colors: { primary: '#465462', accent: '#ff8a00' },
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
    colors: { primary: '#d5dae0', accent: '#19b5fe' },
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
    colors: { primary: '#6b3fd4', accent: '#a5ff3c' },
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

export const ROBOT_PRESETS: RobotSpec[] = [...CAD_ROBOTS, ...GENERIC_PRESETS];

export function presetById(id: string): RobotSpec {
  return structuredClone(ROBOT_PRESETS.find((p) => p.id === id) ?? GENERIC_PRESETS[1]);
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
  return structuredClone(allRobots().find((r) => r.id === id) ?? GENERIC_PRESETS[1]);
}
