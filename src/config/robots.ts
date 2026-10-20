/**
 * Especificación de robots, presets inventados y validación contra el manual.
 * R103 peso ≤ 115 lb sin BUMPERS ni batería · R104 perímetro ≤ 110 in y altura ≤ 30 in
 * R105 extensión ≤ 12 in · R106 un solo lado · R107 altura ≤ 30 in siempre.
 */
import { inch, MAX_EXTENSION, MAX_HEIGHT, MAX_PERIMETER, TRENCH_CLEAR_HEIGHT } from './field';
import { loadJSON, saveJSON } from './settings';

export type Drivetrain = 'swerve' | 'tank';

/**
 * Aspecto de los robots de la temporada ("bumper hopper"): caja de policarbonato sobre los
 * BUMPERS. Sin `look`, el robot usa el estilo genérico de placas.
 */
export interface RobotLook {
  walls: 'smoke' | 'clear' | 'black';
  /** Red encima del hopper (más capacidad). */
  net: boolean;
  /** Fracción del hopper cubierta por una tapa de policarbonato (desde atrás). */
  cover?: number;
  /** Color del marco (postes, rieles, placas). */
  frame: string;
  corners: 'tube' | 'truss';
  /** Intake por cremallera (se desliza) o slapdown/four-bar (pivota). */
  intake: 'rack' | 'pivot';
  /** Posición de la turret a lo largo del robot (0 = atrás, 1 = adelante). */
  turretAt?: number;
  /** Nombre del robot en las paredes. */
  label?: string;
}
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
  look?: RobotLook;
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

/**
 * Los mejores robots de REBUILT 2026, recreados (aspecto aproximado y rendimiento estimado).
 * Fuentes: ranking EPA de Statbotics y fichas de mecanismos del "FRC 2026 REBUILT Robot Study
 * Dashboard" (tech binders, CAD y videos "Behind the Bumpers"), fotos de The Blue Alliance y
 * Chief Delphi. Lo que ningún equipo publicó (altura exacta, nivel de climb) es estimado.
 * El perímetro respeta R104 (≤ 110 in) aunque el real use esquinas recortadas.
 */
export const TOP_ROBOTS: RobotSpec[] = [
  base({
    id: 'top-4414',
    name: 'Rip Current',
    teamNumber: 4414,
    widthIn: 30.5, // 25 × 32 in con esquinas traseras recortadas (binder)
    lengthIn: 24.5,
    heightIn: 22,
    massKg: 63,
    maxSpeed: 4.75, // WCP X2 7.67:1
    traction: 1.2,
    maxAccel: 10,
    intake: { widthIn: 28, extensionIn: 10, rate: 18 },
    hopperCapacity: 60,
    shooter: { type: 'turret', rate: 16, maxSpeed: 13, minAngle: 40, maxAngle: 75, accuracy: 0.95, exitHeightIn: 22, backspin: 20, lanes: 1 },
    climb: NO_CLIMB,
    colors: { primary: '#1d8fa3', accent: '#e8eef0' },
    look: { walls: 'smoke', net: false, cover: 0.7, frame: '#1d8fa3', corners: 'truss', intake: 'rack', turretAt: 0.32, label: 'Rip Current' },
    real: {
      team: 'HighTide',
      robot: 'Rip Current',
      note: {
        es: 'Campeón mundial 2026 (capitán de la alianza Daly) y EPA #1 de la temporada. Turret de un solo chorro con alimentación tipo "dye rotor", tiro en movimiento.',
        en: '2026 World Champion (Daly alliance captain) and #1 EPA of the season. Single-stream turret fed by a "dye rotor", shoots on the move.',
      },
    },
  }),
  base({
    id: 'top-254',
    name: 'Overload',
    teamNumber: 254,
    widthIn: 28,
    lengthIn: 27,
    heightIn: 22,
    massKg: 63.5,
    maxSpeed: 4.9,
    traction: 1.2,
    maxAccel: 10,
    intake: { widthIn: 26, extensionIn: 10, rate: 22 }, // cremallera, 3 rodillos
    hopperCapacity: 78, // "bumper hopper" de 8 in + red: 75–80 FUEL
    shooter: { type: 'fixed', rate: 26, maxSpeed: 12.5, minAngle: 42, maxAngle: 80, accuracy: 0.93, exitHeightIn: 21, backspin: 15, lanes: 4 },
    climb: NO_CLIMB,
    colors: { primary: '#202227', accent: '#2f6df6' },
    look: { walls: 'smoke', net: false, cover: 0.85, frame: '#1b1c20', corners: 'tube', intake: 'rack', label: 'Overload' },
    real: {
      team: 'The Cheesy Poofs',
      robot: 'Overload',
      note: {
        es: 'EPA #2. "Dumper" de 4 FUEL de ancho con hood articulado: ~25–28 FUEL/s. Hopper de policarbonato que sale de los BUMPERS.',
        en: '#2 EPA. 4-wide dumper with an articulating hood: ~25–28 FUEL/s. Polycarbonate hopper rising from the BUMPERS.',
      },
    },
  }),
  base({
    id: 'top-7769',
    name: 'CHUNK',
    teamNumber: 7769,
    widthIn: 28,
    lengthIn: 27,
    heightIn: 22,
    massKg: 64,
    maxSpeed: 4.7,
    traction: 1.2,
    intake: { widthIn: 26, extensionIn: 10, rate: 18 }, // slapdown lineal (cremallera)
    hopperCapacity: 70,
    shooter: { type: 'fixed', rate: 20, maxSpeed: 13, minAngle: 45, maxAngle: 78, accuracy: 0.95, exitHeightIn: 21, backspin: 20, lanes: 3 },
    climb: { maxLevel: 1, timeL1: 3, timeL2: 99, timeL3: 99 }, // tiene climber; nivel no publicado
    colors: { primary: '#3a3d44', accent: '#2d6be0' },
    look: { walls: 'smoke', net: false, frame: '#3a3d44', corners: 'tube', intake: 'rack', label: 'CHUNK' },
    real: {
      team: 'The CREW',
      robot: 'CHUNK',
      note: {
        es: 'EPA #3. Dumper ancho de un chorro, elogiado por su alcance y precisión; ~70 FUEL. Tiene climber.',
        en: '#3 EPA. Wide single-stream dumper praised for range and accuracy; ~70 FUEL. Has a climber.',
      },
    },
  }),
  base({
    id: 'top-1323',
    name: 'MadTown',
    teamNumber: 1323,
    widthIn: 28,
    lengthIn: 27,
    heightIn: 26,
    massKg: 63,
    maxSpeed: 4.8,
    traction: 1.2,
    intake: { widthIn: 26, extensionIn: 10, rate: 16 }, // four-bar
    hopperCapacity: 70,
    shooter: { type: 'turret', rate: 14, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.94, exitHeightIn: 26, backspin: 20, lanes: 1 },
    climb: NO_CLIMB,
    colors: { primary: '#15161a', accent: '#2f6df6' },
    look: { walls: 'black', net: true, frame: '#15161a', corners: 'tube', intake: 'pivot', turretAt: 0.5, label: 'MadTown' },
    real: {
      team: 'MadTown Robotics',
      robot: 'MadTown',
      note: {
        es: 'Campeón mundial 2026 (alianza Daly), EPA #4. Turret con tambor ("dye rotor") e intake de four-bar; hopper negro con red.',
        en: '2026 World Champion (Daly alliance), #4 EPA. Drum ("dye rotor") turret and four-bar intake; black hopper with a net.',
      },
    },
  }),
  base({
    id: 'top-2056',
    name: 'Desperate Measures',
    teamNumber: 2056,
    widthIn: 29.5, // 25.5 × 29.5 in (binder)
    lengthIn: 25.5,
    heightIn: 27,
    massKg: 63,
    maxSpeed: 4.57, // 15 ft/s, MK5n R1
    traction: 1.25, // ruedas "spike"
    intake: { widthIn: 27, extensionIn: 10, rate: 14 }, // cremallera de un motor
    hopperCapacity: 62,
    shooter: { type: 'turret', rate: 12, maxSpeed: 13, minAngle: 39.5, maxAngle: 73.5, accuracy: 0.93, exitHeightIn: 27, backspin: 25, lanes: 1 },
    climb: NO_CLIMB,
    colors: { primary: '#c0c4ca', accent: '#e53935' },
    look: { walls: 'clear', net: true, frame: '#b9bec5', corners: 'truss', intake: 'rack', turretAt: 0.3, label: 'Desperate Measures' },
    real: {
      team: 'OP Robotics',
      robot: 'Desperate Measures',
      note: {
        es: 'EPA #5, reconstruido a media temporada. Turret con hood continuo (73.5°–39.5°), piso de rodillos y hopper con red de ~62 FUEL.',
        en: '#5 EPA, rebuilt mid-season. Turret with a continuous hood (73.5°–39.5°), roller floor and a ~62-FUEL net hopper.',
      },
    },
  }),
  base({
    id: 'top-1690',
    name: 'Kepler',
    teamNumber: 1690,
    widthIn: 29.5, // el lado ancho es el de la intake
    lengthIn: 24.5,
    heightIn: 21.5, // "trench-runner": pasa bajo el TRENCH
    massKg: 62,
    maxSpeed: 5.0,
    traction: 1.25,
    intake: { widthIn: 28, extensionIn: 10, rate: 16 },
    hopperCapacity: 60,
    shooter: { type: 'turret', rate: 14, maxSpeed: 13, minAngle: 40, maxAngle: 75, accuracy: 0.95, exitHeightIn: 21, backspin: 5, lanes: 1 },
    climb: NO_CLIMB,
    colors: { primary: '#2b2f36', accent: '#3fa9ff' },
    look: { walls: 'clear', net: true, frame: '#2b2f36', corners: 'tube', intake: 'rack', turretAt: 0.22, label: 'Kepler' },
    real: {
      team: 'Orbit',
      robot: 'Kepler',
      note: {
        es: 'EPA #6. Robot bajo que pasa por el TRENCH, turret de 640° que tira en movimiento y hopper transparente con red (~60 FUEL).',
        en: '#6 EPA. Low-profile trench runner with a 640° shoot-on-the-move turret and a clear net hopper (~60 FUEL).',
      },
    },
  }),
  base({
    id: 'top-2481',
    name: 'Roboteers',
    teamNumber: 2481,
    widthIn: 29,
    lengthIn: 26,
    heightIn: 28,
    massKg: 64.5,
    maxSpeed: 4.3, // engranado lento por la carga de FUEL
    traction: 1.2,
    intake: { widthIn: 29, extensionIn: 10, rate: 24 }, // 5 FUEL de ancho, "touch and take"
    hopperCapacity: 115,
    shooter: { type: 'fixed', rate: 20, maxSpeed: 12.5, minAngle: 48, maxAngle: 72, accuracy: 0.9, exitHeightIn: 27, backspin: 25, lanes: 4 },
    climb: NO_CLIMB,
    colors: { primary: '#c9cdd3', accent: '#ff8a00' },
    look: { walls: 'clear', net: false, frame: '#c9cdd3', corners: 'tube', intake: 'pivot', label: 'Roboteers' },
    real: {
      team: 'Roboteers',
      robot: 'Roboteers',
      note: {
        es: 'EPA #9. El "big dumper": hopper de 115 FUEL, intake de 5 de ancho y shooter fijo de 4 carriles (~20 FUEL/s).',
        en: '#9 EPA. The "big dumper": 115-FUEL hopper, 5-wide intake and a fixed 4-lane shooter (~20 FUEL/s).',
      },
    },
  }),
  base({
    id: 'top-2910',
    name: 'ReBlitz',
    teamNumber: 2910,
    widthIn: 28,
    lengthIn: 27,
    heightIn: 22,
    massKg: 63,
    maxSpeed: 4.8,
    traction: 1.2,
    intake: { widthIn: 26, extensionIn: 10, rate: 20 },
    hopperCapacity: 55,
    shooter: { type: 'fixed', rate: 30, maxSpeed: 12.5, minAngle: 45, maxAngle: 76, accuracy: 0.9, exitHeightIn: 21, backspin: 20, lanes: 3 },
    climb: NO_CLIMB,
    colors: { primary: '#bfc4ca', accent: '#3bb54a' },
    look: { walls: 'clear', net: false, frame: '#bfc4ca', corners: 'truss', intake: 'pivot', label: 'ReBlitz' },
    real: {
      team: 'Jack in the Bot',
      robot: 'Blitz → ReBlitz',
      note: {
        es: 'Finalista mundial 2026 (alianza Newton), EPA #11. Reconstruido a media temporada como dumper: más de 30 FUEL/s.',
        en: '2026 World Finalist (Newton alliance), #11 EPA. Rebuilt mid-season into a dumper: over 30 FUEL/s.',
      },
    },
  }),
  base({
    id: 'top-1678',
    name: 'Limestone',
    teamNumber: 1678,
    widthIn: 27, // MK5n, 27 × 27 in
    lengthIn: 27,
    heightIn: 26,
    massKg: 63,
    maxSpeed: 4.8,
    traction: 1.25,
    intake: { widthIn: 26, extensionIn: 10, rate: 18 }, // slapdown de ancho completo
    hopperCapacity: 70,
    shooter: { type: 'fixed', rate: 22, maxSpeed: 13, minAngle: 40, maxAngle: 78, accuracy: 0.92, exitHeightIn: 25, backspin: 20, lanes: 4 },
    climb: NO_CLIMB,
    colors: { primary: '#c9cdd3', accent: '#2fbf4a' },
    look: { walls: 'clear', net: true, frame: '#c9cdd3', corners: 'truss', intake: 'pivot', label: 'Limestone' },
    real: {
      team: 'Citrus Circuits',
      robot: 'Limestone',
      note: {
        es: 'Ganador de la división Milstein. Flywheel con hood alimentado por un tambor de 3.5 in de ancho completo; hopper expandible con red.',
        en: 'Milstein division winner. Hooded flywheel fed by a full-width 3.5 in drum; expanding hopper with a net.',
      },
    },
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

export const ROBOT_PRESETS: RobotSpec[] = [...TOP_ROBOTS, ...GENERIC_PRESETS];

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
