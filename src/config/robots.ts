/**
 * Especificación de robots: robots reales de 2026 (con su CAD), robots propios y validación.
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
    /**
     * FUEL que salen a la vez, a lo ancho del shooter ("dumper" de 3–5 carriles, o una turret
     * doble); 1 = un solo chorro.
     */
    lanes?: number;
    /** Separación entre carriles (pulgadas); por omisión, un FUEL (p. ej. 16.5 = dos turrets). */
    laneSpacingIn?: number;
    /** Shooter fijo: hacia dónde tira respecto al frente (grados, + = a la izquierda; 180 = atrás). */
    yawDeg?: number;
    /** Posición del shooter en el robot (pulgadas: x adelante, y a la izquierda). */
    posIn?: [number, number];
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
  /** Modelo 3D real del equipo (public/robots/<file>), ver scripts/robots/ y src/render/cadRigs.ts. */
  cad?: { file: string };
  /** Superestructura que sobresale del chasis hacia el frente, arriba de los BUMPERS (pulgadas). */
  overhangIn?: number;
  /**
   * Hopper que se extiende con la intake: [frente, borde de arriba] en pulgadas desde el centro
   * del robot y el piso (medido en el CAD desplegado). Choca con el campo y los robots.
   */
  deployedHopperIn?: [number, number];
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
 * asset de AdvantageScope; ver scripts/robots/ y public/robots/LICENSES.md), articulado como en
 * el código de cada equipo (src/render/cadRigs.ts). Chasis, altura, extensión y ancho de la
 * intake medidos sobre el CAD armado (guardado y desplegado); hacia dónde y desde dónde tira el
 * shooter, del código. Rendimiento según sus tech binders / Robot Study Dashboard y EPA de
 * Statbotics (estimado donde no se publicó).
 */
export const CAD_ROBOTS: RobotSpec[] = [
  base({
    id: 'cad-1678',
    name: 'Limestone',
    teamNumber: 1678,
    widthIn: 27.5,
    lengthIn: 27.5,
    heightIn: 22,
    massKg: 63,
    maxSpeed: 4.8,
    traction: 1.25,
    intake: { widthIn: 27, extensionIn: 11.2, rate: 18 },
    hopperCapacity: 70,
    deployedHopperIn: [19.3, 20.5],
    // Dumper de 4 FUEL de ancho (hood de lado a lado en el CAD) que tira hacia atrás desde 11.28 in
    // detrás del centro (DriveConstants.SHOOTER_OFFSET)
    shooter: { type: 'fixed', rate: 22, maxSpeed: 13, minAngle: 40, maxAngle: 78, accuracy: 0.92, exitHeightIn: 21, backspin: 20, lanes: 4, yawDeg: 180, posIn: [-11.28, 0] },
    climb: NO_CLIMB,
    colors: { primary: '#c9cdd3', accent: '#2fbf4a' },
    cad: { file: '1678.glb' },
    real: cadReal('Citrus Circuits', 'Limestone', 'Ganador de la división Milstein, EPA #15. Dumper de 4 FUEL de ancho hacia atrás, alimentado por un tambor de ancho completo; intake slapdown de ancho completo; hopper que se extiende.', 'Milstein division winner, #15 EPA. Rear-facing 4-wide dumper fed by a full-width drum; full-width slapdown intake; extending hopper.'),
  }),
  base({
    id: 'cad-5000',
    name: 'Icarus',
    teamNumber: 5000,
    // El modelo va girado −90°: su intake izquierda es el frente del simulador
    widthIn: 28.5,
    lengthIn: 26,
    heightIn: 21.7,
    massKg: 62,
    maxSpeed: 4.8,
    intake: { widthIn: 27.5, extensionIn: 10.6, rate: 14 }, // cremallera en diagonal
    hopperCapacity: 50,
    shooter: { type: 'turret', rate: 14, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.93, exitHeightIn: 21, backspin: 20, lanes: 1 },
    climb: NO_CLIMB,
    colors: { primary: '#2b2f36', accent: '#00b3ff' },
    cad: { file: '5000.glb' },
    real: cadReal('Hammerheads', 'Icarus', 'EPA #34. Turret con visión que tira en movimiento, alimentada por un "dye rotor"; dos intakes de cremallera que salen en diagonal hacia los lados.', '#34 EPA. Vision-tracking turret that shoots on the move, fed by a "dye rotor"; two rack-and-pinion intakes that slide out diagonally to the sides.'),
  }),
  base({
    id: 'cad-604',
    name: 'Toploader',
    teamNumber: 604,
    widthIn: 27,
    lengthIn: 27,
    heightIn: 28.8, // turret arriba de la torre del serializer (27.5 in, Constants.Turret)
    massKg: 62,
    maxSpeed: 4.8,
    intake: { widthIn: 26, extensionIn: 10.5, rate: 15 },
    hopperCapacity: 50,
    shooter: { type: 'turret', rate: 15, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.93, exitHeightIn: 28, backspin: 20, lanes: 1, posIn: [0, -1] },
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
    heightIn: 21.8,
    massKg: 62,
    maxSpeed: 4.9,
    intake: { widthIn: 25.5, extensionIn: 11.6, rate: 12 },
    hopperCapacity: 40,
    deployedHopperIn: [19.7, 19.7], // la slamtake empuja el frente del hopper
    // Launcher fijo hacia atrás (LauncherConstants.robotToLauncher: x −0.151 m, yaw π): el chasis
    // apunta. Dumper: flywheel y hood de lado a lado (0.63 m en el CAD, 4 Kraken) → 4 FUEL de ancho.
    shooter: { type: 'fixed', rate: 16, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.94, exitHeightIn: 21, backspin: 25, lanes: 4, yawDeg: 180, posIn: [-5.9, 0] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#1a5cff' },
    cad: { file: '6328.glb' },
    real: cadReal('Mechanical Advantage', 'Darwin', 'Dumper fijo de 4 FUEL de ancho hacia atrás, con hood ajustable impreso en 3D; la "slamtake" empuja el frente del hopper al desplegarse. Los creadores de AdvantageKit y AdvantageScope.', 'Rear-facing 4-wide fixed dumper with a 3D-printed adjustable hood; the "slamtake" pushes the hopper front out as it deploys. The makers of AdvantageKit and AdvantageScope.'),
  }),
  base({
    id: 'cad-971',
    name: 'Mixtape',
    teamNumber: 971,
    widthIn: 29,
    lengthIn: 26,
    heightIn: 21.4,
    massKg: 63,
    maxSpeed: 4.8,
    // El modelo va girado 180°: la intake (atrás en el CAD) es el frente del simulador
    intake: { widthIn: 28, extensionIn: 10.8, rate: 16 },
    overhangIn: 11, // el hopper sobresale del chasis sobre la intake
    hopperCapacity: 45,
    // Dos turrets separadas 16.5 in (Visualization.robotToLeft/RightTurret): un FUEL por turret
    shooter: { type: 'turret', rate: 18, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.92, exitHeightIn: 21, backspin: 20, lanes: 2, laneSpacingIn: 16.5, posIn: [-5.8, 0] },
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
    heightIn: 24.6, // con la intake levantada
    massKg: 64,
    maxSpeed: 4.8,
    intake: { widthIn: 26.4, extensionIn: 5.5, rate: 12 }, // 4 FUEL de ancho
    hopperCapacity: 10, // sin hopper: camino directo 4-2-1 (~8 en tránsito)
    shooter: { type: 'turret', rate: 10, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.93, exitHeightIn: 21, backspin: 20, lanes: 1, posIn: [-3.9, 3] },
    climb: { maxLevel: 1, timeL1: 3, timeL2: 99, timeL3: 99 },
    colors: { primary: '#30343b', accent: '#2340d0' },
    cad: { file: '341.glb' },
    real: cadReal('Miss Daisy', 'Miss Daisy XXIV', 'Sin hopper: intake de 4 FUEL de ancho que va directo (4-2-1) a una turret de 360°; climber L1 ligero.', 'Hopperless: a 4-wide intake feeding straight (4-2-1) into a 360° turret; lightweight L1 climber.'),
  }),
  base({
    id: 'cad-190',
    name: 'Doomspiral',
    teamNumber: 190,
    widthIn: 32,
    lengthIn: 23,
    heightIn: 21.7,
    massKg: 61,
    maxSpeed: 4.9,
    intake: { widthIn: 30, extensionIn: 11.6, rate: 14 }, // cuatro barras
    hopperCapacity: 40,
    // Doomspiral: shooter fijo de un solo chorro (flywheel y hood de ~1 FUEL de ancho en el CAD)
    // hacia la derecha (V1_DoomSpiralShooterConstants.SHOOTER_POSE: yaw −90°)
    shooter: { type: 'fixed', rate: 12, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.92, exitHeightIn: 21, backspin: 20, lanes: 1, yawDeg: -90, posIn: [-0.6, 10] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#c62828' },
    cad: { file: '190.glb' },
    real: cadReal('Gompei and the HERD', 'Doomspiral', 'Shooter fijo de lado alimentado por un spindexer ("doom spiral"); intake de cuatro barras que se mete bajo el hopper.', 'Side-firing fixed shooter fed by a spindexer (the "doom spiral"); four-bar intake that tucks under the hopper.'),
  }),
  base({
    id: 'cad-4915',
    name: 'Artemis',
    teamNumber: 4915,
    widthIn: 28.5,
    lengthIn: 26.5,
    heightIn: 25.6,
    massKg: 63,
    maxSpeed: 4.6,
    intake: { widthIn: 26.8, extensionIn: 10.9, rate: 12 }, // pivote de −2° a 132° (PivotConstants)
    hopperCapacity: 45,
    shooter: { type: 'turret', rate: 10, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.92, exitHeightIn: 24, backspin: 20, lanes: 1, posIn: [-4.7, -6.2] },
    climb: { maxLevel: 1, timeL1: 3.2, timeL2: 99, timeL3: 99 },
    colors: { primary: '#30343b', accent: '#ef3e00' },
    cad: { file: '4915.glb' },
    real: cadReal('Spartronics', 'ARTEMIS', 'Ganador de división. Turret con hood ajustable sobre un spindexer; intake que pivota; tiene climber.', 'Division winner. Turret with an adjustable hood over a spindexer; pivoting intake; has a climber.'),
  }),
  base({
    id: 'cad-3478',
    name: 'Bocho',
    teamNumber: 3478,
    // CAD de SolidWorks que mandó el equipo (no viene de un repo de AdvantageScope): medidas del
    // ensamble; rendimiento estimado. Movimientos deducidos del CAD (cadRigs.ts).
    widthIn: 28.2,
    lengthIn: 26.7,
    heightIn: 29.9,
    massKg: 63,
    maxSpeed: 4.6,
    intake: { widthIn: 27.2, extensionIn: 10, rate: 12 },
    hopperCapacity: 75, // dato del equipo
    // La intake empuja el frente del hopper 0.25 m (cadRigs, intakeSwing3478): 0.594 m del
    // centro, 0.73 m de alto
    deployedHopperIn: [23.4, 28.7],
    // Turret atrás a la derecha (centro del shooter en el ensamble)
    shooter: { type: 'turret', rate: 10, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.92, exitHeightIn: 25, backspin: 20, lanes: 1, posIn: [-6, -6.6] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#2e9e44' },
    cad: { file: '3478.glb' },
    real: cadReal('LamBot', 'Bocho', 'Turret con hood alimentada por un spindexer; swerve MK4i con Krakens. CAD enviado por el equipo; rendimiento estimado.', 'Turret with a hood fed by a spindexer; MK4i swerve with Krakens. CAD provided by the team; estimated performance.'),
  }),
];

/** Robots incluidos (solo robots reales con su CAD; los diseños propios se hacen en el editor). */
export const ROBOT_PRESETS: RobotSpec[] = CAD_ROBOTS;
export const DEFAULT_ROBOT_ID = CAD_ROBOTS[0].id;

export function presetById(id: string): RobotSpec {
  return structuredClone(ROBOT_PRESETS.find((p) => p.id === id) ?? CAD_ROBOTS[0]);
}

/** Punto de partida de un robot nuevo en el editor: diseño propio, sin modelo CAD. */
export function newRobotTemplate(): RobotSpec {
  return base({
    id: `custom-${Date.now().toString(36)}`,
    name: 'Mi robot',
    teamNumber: 9999,
    shooter: { type: 'turret', rate: 8, maxSpeed: 12.5, minAngle: 45, maxAngle: 78, accuracy: 0.9, exitHeightIn: 21, backspin: 30 },
    heightIn: 21.5,
  });
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
  return structuredClone(allRobots().find((r) => r.id === id) ?? CAD_ROBOTS[0]);
}
