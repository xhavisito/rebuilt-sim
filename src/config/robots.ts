/**
 * Especificación de robots: robots reales de 2026 (con su CAD), robots propios y validación.
 * R103 peso ≤ 115 lb sin BUMPERS ni batería · R104 perímetro ≤ 110 in y altura ≤ 30 in
 * R105 extensión ≤ 12 in · R106 un solo lado · R107 altura ≤ 30 in siempre.
 */
import { inch, MAX_EXTENSION, MAX_HEIGHT, MAX_PERIMETER, TRENCH_CLEAR_HEIGHT } from './field';
import { loadJSON, saveJSON } from './settings';

export type Drivetrain = 'swerve' | 'tank';
export type ShooterType = 'fixed' | 'turret';
/** Acabado de la pintura de las placas (solo el robot procedural; el CAD trae sus materiales). */
export type PaintFinish = 'satin' | 'matte' | 'metallic' | 'candy' | 'carbon';
/** LEDs del marco: 'status' reacciona a lo que hace el robot, 'rainbow' cicla colores. */
export type LedMode = 'status' | 'rainbow' | 'off';

/** Estética del robot (no cambia la física). */
export interface RobotLook {
  finish: PaintFinish;
  /** Luz bajo el chasis: 'alliance', un color '#rrggbb' u 'off'. */
  underglow: string;
  leds: LedMode;
}

export const DEFAULT_LOOK: RobotLook = { finish: 'satin', underglow: 'alliance', leds: 'status' };
export const PAINT_FINISHES: PaintFinish[] = ['satin', 'matte', 'metallic', 'candy', 'carbon'];
export const LED_MODES: LedMode[] = ['status', 'rainbow', 'off'];

/** Completa y valida la estética de una ficha (archivos, galería, robots viejos sin `look`). */
export function resolveLook(raw: unknown): RobotLook {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const finish = PAINT_FINISHES.includes(o.finish as PaintFinish) ? (o.finish as PaintFinish) : DEFAULT_LOOK.finish;
  const leds = LED_MODES.includes(o.leds as LedMode) ? (o.leds as LedMode) : DEFAULT_LOOK.leds;
  const u = o.underglow;
  const underglow = u === 'alliance' || u === 'off' || (typeof u === 'string' && /^#[0-9a-f]{6}$/i.test(u)) ? u : DEFAULT_LOOK.underglow;
  return { finish, underglow, leds };
}

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
  /** Estética opcional (acabado, luz inferior, LEDs); ver `resolveLook`. */
  look?: RobotLook;
  preload: number;
  /** Modelo 3D real del equipo (public/robots/<file>), ver scripts/robots/ y src/render/cadRigs.ts. */
  cad?: { file: string };
  /** Modelo 3D propio importado en el editor (GLB guardado en IndexedDB, ver src/render/customCad.ts). */
  customCad?: CustomCad;
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

/**
 * CAD propio (.glb / .gltf) importado en el taller. Solo es visual: la física usa el marco, la
 * intake y el shooter de la ficha. Se centra sobre el marco y se apoya en el piso.
 */
export interface CustomCad {
  /** Clave del archivo en IndexedDB. */
  id: string;
  /** Nombre del archivo original. */
  name: string;
  /** Metros por unidad del modelo (1 = m, 0.01 = cm, 0.001 = mm, 0.0254 = in). */
  unit: number;
  /** Ajuste fino de escala (%). */
  scalePct: number;
  /** Eje "arriba" del modelo: glTF usa Y; los assets de AdvantageScope y muchos CAD, Z. */
  upAxis: 'y' | 'z';
  /** Giro para que el frente del modelo quede al frente del robot (0/90/180/270°). */
  yawDeg: number;
  /** Corrimiento (pulgadas): adelante, a la izquierda y arriba. */
  offsetIn: [number, number, number];
  /** Nodo del modelo que gira como turret (sobre su eje vertical). */
  turretNode?: string;
  /** Nodo del modelo que sale con la intake (se desliza hacia el frente `intake.extensionIn`). */
  intakeNode?: string;
  /**
   * Robot de la galería de la comunidad: GLB público (src/net/robotHub.ts). Si el archivo no está
   * en el dispositivo (p. ej. el robot de otro jugador en línea) se descarga de ahí.
   */
  url?: string;
}

export const CAD_UNITS = [1, 0.01, 0.001, 0.0254] as const;

/**
 * Unidad más probable de un modelo: la que deja su lado horizontal más largo (en unidades del
 * modelo) más cerca del tamaño del marco. Los exportadores de CAD suelen dejar mm o pulgadas.
 */
export function guessCadUnit(modelSpan: number, frameSpanM: number): number {
  if (!(modelSpan > 0) || !(frameSpanM > 0)) return 1;
  let best = 1;
  let err = Infinity;
  for (const u of CAD_UNITS) {
    const e = Math.abs(Math.log((modelSpan * u) / frameSpanM));
    if (e < err) {
      err = e;
      best = u;
    }
  }
  return best;
}

/** Escala (%) para que la huella del modelo (largo × ancho, en metros con escala 100%) quepa en el marco. */
export function fitScalePct(lengthM: number, widthM: number, frameLengthM: number, frameWidthM: number): number {
  const r = Math.min(frameLengthM / Math.max(1e-6, lengthM), frameWidthM / Math.max(1e-6, widthM));
  return Math.round(r * 1000) / 10;
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
  maxAccel: 12, // swerve con 4 motores: la tracción (μ·g ≈ 10.8 m/s²) es la que limita
  traction: 1.1,
  maxOmega: 11,
  intake: { widthIn: 24, extensionIn: 10, rate: 13 },
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
    intake: { widthIn: 27, extensionIn: 11.2, rate: 29 },
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
    intake: { widthIn: 27.5, extensionIn: 10.6, rate: 22 }, // cremallera en diagonal
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
    intake: { widthIn: 26, extensionIn: 10.5, rate: 24 },
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
    intake: { widthIn: 25.5, extensionIn: 11.6, rate: 19 },
    hopperCapacity: 44, // lo que cabe a escala en su hopper (cadRigs)
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
    intake: { widthIn: 28, extensionIn: 10.8, rate: 26 },
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
    intake: { widthIn: 26.4, extensionIn: 5.5, rate: 19 }, // 4 FUEL de ancho
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
    intake: { widthIn: 30, extensionIn: 11.6, rate: 22 }, // cuatro barras
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
    intake: { widthIn: 26.8, extensionIn: 10.9, rate: 19 }, // pivote de −2° a 132° (PivotConstants)
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
    // Dato del equipo: pasa por debajo de los soportes de la TOWER (§5.8: desde 28.40 in del piso)
    heightIn: 27.5,
    massKg: 63,
    maxSpeed: 4.6,
    intake: { widthIn: 27.2, extensionIn: 10, rate: 19 },
    hopperCapacity: 75, // dato del equipo
    // La intake empuja el frente del hopper 0.275 m (cadRigs, HOPPER_EXT_3478): 0.619 m del
    // centro; alto como el robot (también pasa bajo los soportes de la TOWER)
    deployedHopperIn: [24.4, 27.5],
    // Turret atrás a la derecha (centro del shooter en el ensamble)
    shooter: { type: 'turret', rate: 10, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.92, exitHeightIn: 25, backspin: 20, lanes: 1, posIn: [-6, -6.6] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#2e9e44' },
    cad: { file: '3478.glb' },
    real: cadReal('LamBot', 'Bocho', 'Turret con hood alimentada por un spindexer; swerve MK4i con Krakens. CAD enviado por el equipo; rendimiento estimado.', 'Turret with a hood fed by a spindexer; MK4i swerve with Krakens. CAD provided by the team; estimated performance.'),
  }),
  // ---- Robots con CAD de equipos de distintos niveles (variedad): sus modelos y rigs vienen de
  // sus repos (ver cadRigs.ts). Sin binders ni EPA verificable: el rendimiento es un estimado a
  // partir del diseño (capacidad, shooter, si tira en movimiento) y de los récords publicados.
  base({
    id: 'cad-401',
    name: 'Copperhead',
    teamNumber: 401,
    widthIn: 27.5,
    lengthIn: 27.5,
    heightIn: 21,
    massKg: 62,
    maxSpeed: 4.7,
    intake: { widthIn: 25, extensionIn: 10.5, rate: 18 }, // pivote −8°…90° (IntakeConstants.json)
    hopperCapacity: 45,
    // Turret con hood (RobotInfo.json robotToShooter: −0.099, 0.138, 0.379 m)
    shooter: { type: 'turret', rate: 11, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.91, exitHeightIn: 15, backspin: 20, lanes: 1, posIn: [-3.9, 5.4] },
    climb: { maxLevel: 1, timeL1: 3.4, timeL2: 99, timeL3: 99 },
    colors: { primary: '#30343b', accent: '#c46a2b' },
    cad: { file: '401.glb' },
    real: cadReal('Copperhead Robotics', 'Copperhead 2026', 'Nivel alto-medio: 35-30 en 2026, Excellence in Engineering en el campeonato. Turret de 352° con hood, intake que pivota y climber; rendimiento estimado.', 'Upper-mid tier: 35-30 in 2026, Excellence in Engineering at Championship. 352° turret with a hood, pivoting intake and a climber; estimated performance.'),
  }),
  base({
    id: 'cad-4201',
    name: 'Threepeater',
    teamNumber: 4201,
    widthIn: 30,
    lengthIn: 24,
    heightIn: 29.8, // hopper alto: no pasa bajo el TRENCH
    massKg: 63,
    maxSpeed: 4.6,
    intake: { widthIn: 28, extensionIn: 11, rate: 19 }, // pivote 0°…105° (INTAKE.PIVOT)
    hopperCapacity: 60, // SIM.MAX_FUEL
    deployedHopperIn: [24, 29.8], // el hopper sale 12 in con la intake (Robot2d)
    // Tres flywheels arriba del hopper que tiran hacia el frente (launchFuel con yaw 0)
    shooter: { type: 'fixed', rate: 12, maxSpeed: 13, minAngle: 50, maxAngle: 78, accuracy: 0.88, exitHeightIn: 27, backspin: 25, lanes: 3, yawDeg: 0, posIn: [-6, 0] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#2fa84f' },
    cad: { file: '4201.glb' },
    real: cadReal('Vitruvian Bots', 'Threepeater', 'Nivel medio-alto: dumper fijo de 3 flywheels hacia el frente sobre un hopper alto que crece 12 in con la intake; rendimiento estimado.', 'Upper-mid tier: fixed 3-flywheel dumper firing forward over a tall hopper that grows 12 in with the intake; estimated performance.'),
  }),
  base({
    id: 'cad-2601',
    name: 'Kirin',
    teamNumber: 2601,
    widthIn: 27,
    lengthIn: 29,
    heightIn: 21.4,
    massKg: 62,
    maxSpeed: 4.5,
    intake: { widthIn: 26, extensionIn: 11.4, rate: 16 }, // cremallera a −19° (Intake.RACK_ANGLE)
    hopperCapacity: 50,
    // Turret en ROBOT_TO_TURRET (−5, 0, 17 in)
    shooter: { type: 'turret', rate: 8, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.87, exitHeightIn: 19, backspin: 20, lanes: 1, posIn: [-5, 0] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#2f6fd6' },
    cad: { file: '2601.glb' },
    real: cadReal('Steel Hawks', 'Kirin', 'Nivel medio: turret con hood sobre un hopper grande; intake de cremallera inclinada; rendimiento estimado.', 'Mid tier: turret with a hood over a big hopper; angled rack-and-pinion intake; estimated performance.'),
  }),
  base({
    id: 'cad-6657',
    name: 'Arbor26',
    teamNumber: 6657,
    widthIn: 27.5,
    lengthIn: 27.5,
    heightIn: 23.9,
    massKg: 62,
    maxSpeed: 4.5,
    // El modelo va girado 180°: la intake (atrás en el CAD) es el frente del simulador
    intake: { widthIn: 26, extensionIn: 11.5, rate: 14 }, // cremallera 0–12.375 in (IntakeConstants)
    hopperCapacity: 45,
    // Turret en TURRET_CENTER (0.118, −0.106, 0.511 m del CAD; girado 180°)
    shooter: { type: 'turret', rate: 8, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.86, exitHeightIn: 21, backspin: 20, lanes: 1, posIn: [-4.7, 4.2] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#3c8d40' },
    cad: { file: '6657.glb' },
    real: cadReal('Arborbotics', 'Arbor26', 'Nivel medio: turret de 370° con hood; intake de cremallera que saca las paredes del hopper; rendimiento estimado.', 'Mid tier: 370° turret with a hood; rack-and-pinion intake that pulls the hopper walls out; estimated performance.'),
  }),

  base({
    id: 'cad-6357',
    name: 'SKBot',
    teamNumber: 6357,
    widthIn: 27,
    lengthIn: 27,
    heightIn: 21.5,
    massKg: 60,
    maxSpeed: 4.2,
    traction: 1.0,
    intake: { widthIn: 22, extensionIn: 6, rate: 11 },
    overhangIn: 10, // el hopper sobresale al frente arriba de los BUMPERS
    hopperCapacity: 35,
    // Turret de ±170° que gira alrededor de (−7.05, 7.05 in) (SK26Turret)
    shooter: { type: 'turret', rate: 6, maxSpeed: 12.5, minAngle: 45, maxAngle: 76, accuracy: 0.8, exitHeightIn: 19, backspin: 25, lanes: 1, posIn: [-7, 7] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#7c4dbd' },
    cad: { file: '6357.glb' },
    real: cadReal('The Spring Konstant', '2026 SKBot', 'Nivel bajo: 4-8 y 5-7 en sus eventos de 2026. Turret de ±170° atrás a la izquierda y hopper que sobresale al frente; rendimiento estimado.', 'Lower tier: 4-8 and 5-7 at its 2026 events. ±170° turret at the back left and a hopper that overhangs the front; estimated performance.'),
  }),

  // Todos los demás assets de AdvantageScope 2026 que publicaron los equipos en GitHub (de alto a
  // bajo nivel estimado). Rigs en src/render/cadRigs.ts.
  base({
    id: 'cad-180',
    name: 'Batman',
    teamNumber: 180,
    widthIn: 27,
    lengthIn: 27,
    heightIn: 20,
    massKg: 62,
    maxSpeed: 4.8,
    // Turret en ROBOT_TO_TURRET (−3.91, 6.03 in), intake de cremallera (IntakeExtensionSubsystem)
    intake: { widthIn: 26, extensionIn: 8, rate: 19 },
    hopperCapacity: 50,
    shooter: { type: 'turret', rate: 11, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.9, exitHeightIn: 18, backspin: 20, lanes: 1, posIn: [-3.9, 6] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#2b2b2b' },
    cad: { file: '180.glb' },
    real: cadReal('S.P.A.M.', 'Batman', 'Nivel alto: turret sobre un spindexer e intake de cremallera que sale 0.2 m; rendimiento estimado.', 'Upper tier: turret over a spindexer and a rack intake that slides out 0.2 m; estimated performance.'),
  }),
  base({
    id: 'cad-2713',
    name: 'Red Hawk 2026',
    teamNumber: 2713,
    widthIn: 27,
    lengthIn: 27,
    heightIn: 22.7,
    massKg: 62,
    maxSpeed: 4.6,
    // Turret sobre el dye rotor (LauncherConstants: 0.5, 0.5 in), intake de 0–11.5 in (IntakeConstants)
    intake: { widthIn: 28, extensionIn: 11.5, rate: 18 },
    hopperCapacity: 55,
    shooter: { type: 'turret', rate: 10, maxSpeed: 13, minAngle: 50, maxAngle: 80, accuracy: 0.88, exitHeightIn: 21, backspin: 20, lanes: 1, posIn: [0.5, 0.5] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#c8102e' },
    cad: { file: '2713.glb' },
    real: cadReal('Red Hawk Robotics', 'Robot 2026', 'Nivel medio-alto: turret de 360° con hood sobre un dye rotor y una intake que sale 11.5 in; rendimiento estimado.', 'Upper-mid tier: 360° turret with a hood over a dye rotor and an intake that slides out 11.5 in; estimated performance.'),
  }),
  base({
    id: 'cad-1757',
    name: 'Orion',
    teamNumber: 1757,
    widthIn: 30.5,
    lengthIn: 24.3,
    heightIn: 21,
    massKg: 61,
    maxSpeed: 4.6,
    // Turret en kTurretLocation (−0.102, 0.178 m), pared del hopper que sale 0.298 m (robotmechanism.py)
    deployedHopperIn: [23.7, 16.5],
    intake: { widthIn: 28, extensionIn: 11.7, rate: 18 },
    hopperCapacity: 50,
    shooter: { type: 'turret', rate: 10, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.89, exitHeightIn: 19, backspin: 20, lanes: 1, posIn: [-4, 7] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#1f6fb2' },
    cad: { file: '1757.glb' },
    real: cadReal('Westwood Robotics', 'Orion', 'Nivel medio-alto: turret atrás a la izquierda y pared del hopper que sale 0.298 m con la intake; rendimiento estimado.', 'Upper-mid tier: turret at the back left and a hopper wall that slides out 0.298 m with the intake; estimated performance.'),
  }),
  base({
    id: 'cad-2363',
    name: 'Rho',
    teamNumber: 2363,
    widthIn: 26,
    lengthIn: 26,
    heightIn: 21.6,
    massKg: 62,
    maxSpeed: 4.7,
    // Asset de una pieza: la intake y la turret se separan por nombre (sources.mjs `parts`)
    intake: { widthIn: 25, extensionIn: 12, rate: 18 },
    hopperCapacity: 45,
    shooter: { type: 'turret', rate: 10, maxSpeed: 13, minAngle: 45, maxAngle: 76, accuracy: 0.87, exitHeightIn: 20, backspin: 25, lanes: 1, posIn: [-2.2, -5.1] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#d4a017' },
    cad: { file: '2363.glb' },
    real: cadReal('Triple Helix', 'Rho', 'Nivel medio-alto: turret de 270° sobre un spindexer grande e intake de cuatro barras al frente; rendimiento estimado.', 'Upper-mid tier: 270° turret over a big spindexer and a front four-bar intake; estimated performance.'),
  }),
  base({
    id: 'cad-2412',
    name: 'Corner Turret',
    teamNumber: 2412,
    widthIn: 30,
    lengthIn: 27,
    heightIn: 22.4,
    massKg: 62,
    maxSpeed: 4.5,
    // Girado 180°: la intake (atrás en el CAD) al frente; turret en la esquina (LauncherConstants)
    intake: { widthIn: 28, extensionIn: 12, rate: 16 },
    hopperCapacity: 40,
    shooter: { type: 'turret', rate: 9, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.86, exitHeightIn: 20, backspin: 20, lanes: 1, posIn: [-5.9, -7.9] },
    climb: { maxLevel: 1, timeL1: 3.6, timeL2: 99, timeL3: 99 },
    colors: { primary: '#30343b', accent: '#6a3d9a' },
    cad: { file: '2412.glb' },
    real: cadReal('Robototes', '2026 Corner Turret', 'Nivel medio: turret en una esquina, intake que se guarda encima del robot y climber; rendimiento estimado.', 'Mid tier: corner turret, an intake that folds on top of the robot and a climber; estimated performance.'),
  }),
  base({
    id: 'cad-7419',
    name: '7419 Rebuilt',
    teamNumber: 7419,
    widthIn: 27.4,
    lengthIn: 27.6,
    heightIn: 21.4,
    massKg: 61,
    maxSpeed: 4.5,
    // Girado 180°: turretBasePose (0.159, 0.159 m) y hopper hasta 0.301625 m (Constants)
    deployedHopperIn: [25.6, 19],
    intake: { widthIn: 26, extensionIn: 11.9, rate: 14 },
    hopperCapacity: 45,
    shooter: { type: 'turret', rate: 8, maxSpeed: 13, minAngle: 30, maxAngle: 64, accuracy: 0.85, exitHeightIn: 20, backspin: 20, lanes: 1, posIn: [-6.25, -6.25] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#e07b00' },
    cad: { file: '7419.glb' },
    real: cadReal('Team 7419', 'Rebuilt 2026', 'Nivel medio: turret con hood de 30°–64° y hopper que sale 0.3 m con la intake; rendimiento estimado.', 'Mid tier: turret with a 30°–64° hood and a hopper that slides out 0.3 m with the intake; estimated performance.'),
  }),
  base({
    id: 'cad-5024',
    name: 'Raider 2026',
    teamNumber: 5024,
    widthIn: 27,
    lengthIn: 27,
    heightIn: 24.1,
    massKg: 62,
    maxSpeed: 4.5,
    // Turret en (−0.15, 0.16 m) (MechanismVisualizer)
    intake: { widthIn: 26, extensionIn: 11, rate: 14 },
    hopperCapacity: 40,
    shooter: { type: 'turret', rate: 8, maxSpeed: 13, minAngle: 40, maxAngle: 76, accuracy: 0.84, exitHeightIn: 22, backspin: 20, lanes: 1, posIn: [-5.9, 6.3] },
    climb: { maxLevel: 1, timeL1: 3.8, timeL2: 99, timeL3: 99 },
    colors: { primary: '#30343b', accent: '#b22222' },
    cad: { file: '5024.glb' },
    real: cadReal('Raider Robotics', 'Rebuilt 2026', 'Nivel medio: turret, spindexer, intake que pivota y climber; rendimiento estimado.', 'Mid tier: turret, spindexer, pivoting intake and a climber; estimated performance.'),
  }),
  base({
    id: 'cad-8214',
    name: '8214 2026',
    teamNumber: 8214,
    widthIn: 27,
    lengthIn: 27,
    heightIn: 22,
    massKg: 62,
    maxSpeed: 4.6,
    // Shooter atrás (Visualizer: centro (0, 0.43, −0.275) del marco del swerve)
    deployedHopperIn: [25, 20],
    intake: { widthIn: 26, extensionIn: 10, rate: 14 },
    hopperCapacity: 45,
    shooter: { type: 'fixed', rate: 8, maxSpeed: 13, minAngle: 45, maxAngle: 75, accuracy: 0.85, exitHeightIn: 20, backspin: 25, lanes: 2, yawDeg: 180, posIn: [-8, 0] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#00a3a3' },
    cad: { file: '8214.glb' },
    real: cadReal('Next Innovation', 'Offseason 2026', 'Nivel medio: shooter con hood atrás y hopper que se corre 0.3 m sobre la intake; rendimiento estimado.', 'Mid tier: hooded shooter at the back and a hopper that slides 0.3 m over the intake; estimated performance.'),
  }),
  base({
    id: 'cad-2826',
    name: 'Wave 2026',
    teamNumber: 2826,
    widthIn: 30,
    lengthIn: 24,
    heightIn: 28.3,
    massKg: 62,
    maxSpeed: 4.4,
    // Girado 180°: el hopper con la intake (desplegado atrás en el CAD) sale 0.3 m
    deployedHopperIn: [24, 18],
    intake: { widthIn: 28, extensionIn: 11.8, rate: 14 },
    hopperCapacity: 50,
    shooter: { type: 'turret', rate: 8, maxSpeed: 13, minAngle: 45, maxAngle: 75, accuracy: 0.84, exitHeightIn: 22, backspin: 25, lanes: 1, posIn: [-4.2, 0.75] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#0077be' },
    cad: { file: '2826.glb' },
    real: cadReal('Wave Robotics', 'Rebuilt 2026', 'Nivel medio: turret V4 con hood, hopper extensible con la intake (no pasa bajo el TRENCH); rendimiento estimado.', 'Mid tier: V4 turret with a hood, hopper that extends with the intake (does not fit under the TRENCH); estimated performance.'),
  }),
  base({
    id: 'cad-8324',
    name: 'Remy',
    teamNumber: 8324,
    widthIn: 27.5,
    lengthIn: 27.5,
    heightIn: 22.2,
    massKg: 61,
    maxSpeed: 4.5,
    // Shooter fijo de rodillos a lo ancho (eje en x = −0.103 m del CAD)
    deployedHopperIn: [22.4, 22.2],
    intake: { widthIn: 26, extensionIn: 11.8, rate: 14 },
    hopperCapacity: 54,
    shooter: { type: 'fixed', rate: 8, maxSpeed: 12.5, minAngle: 45, maxAngle: 73, accuracy: 0.8, exitHeightIn: 20, backspin: 25, lanes: 4, yawDeg: 0, posIn: [-4.1, 0] },
    climb: { maxLevel: 1, timeL1: 4, timeL2: 99, timeL3: 99 },
    colors: { primary: '#30343b', accent: '#d6338f' },
    cad: { file: '8324.glb' },
    real: cadReal('MECO Robotics', 'Remy', 'Nivel medio-bajo: dumper fijo de 4 carriles hacia el frente, hopper extensible y climber; rendimiento estimado.', 'Lower-mid tier: fixed 4-lane dumper firing forward, extending hopper and a climber; estimated performance.'),
  }),
  base({
    id: 'cad-7130',
    name: 'BataBot',
    teamNumber: 7130,
    widthIn: 28.5,
    lengthIn: 27,
    heightIn: 21.8,
    massKg: 60,
    maxSpeed: 4.3,
    // Shooter en (−0.075, 0, 0.472 m) con pitch (Telemetry.telemeterizeShooterAngle)
    deployedHopperIn: [24, 20],
    intake: { widthIn: 26, extensionIn: 11, rate: 13 },
    hopperCapacity: 35,
    shooter: { type: 'fixed', rate: 6, maxSpeed: 12.5, minAngle: 45, maxAngle: 70, accuracy: 0.78, exitHeightIn: 20, backspin: 25, lanes: 2, yawDeg: 180, posIn: [-9, 0] }, // el hood sube hacia atrás en el CAD
    climb: { maxLevel: 1, timeL1: 4.2, timeL2: 99, timeL3: 99 },
    colors: { primary: '#30343b', accent: '#5a7d2a' },
    cad: { file: '7130.glb' },
    real: cadReal('Team 7130', 'BataBot', 'Nivel medio-bajo: shooter de dos rodillos con pitch que tira hacia atrás, bandeja que sale con la intake y climber; rendimiento estimado.', 'Lower-mid tier: two-roller pitching shooter firing backward, a tray that slides out with the intake and a climber; estimated performance.'),
  }),
  base({
    id: 'cad-9410',
    name: '9410 2026',
    teamNumber: 9410,
    widthIn: 26.4,
    lengthIn: 27.6,
    heightIn: 29.1,
    massKg: 63,
    maxSpeed: 4.3,
    // Hood en HOOD_PIVOT (−0.272 m), hopper hasta 27.2 in (MechanismSimConstants)
    deployedHopperIn: [27.2, 23],
    intake: { widthIn: 24, extensionIn: 11, rate: 13 },
    hopperCapacity: 68, // lo que cabe a escala en su hopper (cadRigs)
    shooter: { type: 'fixed', rate: 7, maxSpeed: 12.5, minAngle: 45, maxAngle: 70, accuracy: 0.8, exitHeightIn: 27, backspin: 25, lanes: 1, yawDeg: 180, posIn: [-10.7, 0] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#3d5a80' },
    cad: { file: '9410.glb' },
    real: cadReal('Team 9410', 'Robot 2026', 'Nivel medio-bajo: hood atrás, hopper alto que sale de 14 a 27.2 in (no pasa bajo el TRENCH); rendimiento estimado.', 'Lower-mid tier: hood at the back, tall hopper that slides from 14 to 27.2 in (does not fit under the TRENCH); estimated performance.'),
  }),
  base({
    id: 'cad-9584',
    name: 'WCP CC',
    teamNumber: 9584,
    widthIn: 27,
    lengthIn: 27,
    heightIn: 29.9,
    massKg: 58,
    maxSpeed: 4.2,
    intake: { widthIn: 24, extensionIn: 8, rate: 11 },
    hopperCapacity: 60, // lo que cabe a escala en su hopper (cadRigs)
    shooter: { type: 'fixed', rate: 8, maxSpeed: 12, minAngle: 45, maxAngle: 70, accuracy: 0.84, exitHeightIn: 25, backspin: 25, lanes: 3, posIn: [-7, 0] }, // 3 flywheels (Shooter.java) atrás; sus hoods tiran hacia el frente sobre el hopper
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#7a7a7a' },
    cad: { file: '9584.glb' },
    real: cadReal('Team 9584 (WCP, con 971)', 'Competitive Concept', 'Nivel medio: el robot de concepto de WCP, intake al frente que sale con el hopper y tres flywheels atrás que tiran por encima del hopper; rendimiento estimado.', 'Mid tier: the WCP concept robot, front intake that slides out with the hopper and three rear flywheels shooting over the hopper; estimated performance.'),
  }),
  base({
    id: 'cad-339',
    name: 'Kilroy26',
    teamNumber: 339,
    widthIn: 27,
    lengthIn: 27,
    heightIn: 20.4,
    massKg: 60,
    maxSpeed: 4.2,
    // Girado 180°: el flywheel (FlywheelConstants, x = 0.266 m) queda atrás
    deployedHopperIn: [25.8, 18],
    intake: { widthIn: 25, extensionIn: 12, rate: 11 },
    hopperCapacity: 39, // lo que cabe a escala en su hopper (cadRigs)
    shooter: { type: 'fixed', rate: 5, maxSpeed: 12, minAngle: 50, maxAngle: 70, accuracy: 0.75, exitHeightIn: 15, backspin: 30, lanes: 1, yawDeg: 180, posIn: [-10.5, 0] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#2e8b57' },
    cad: { file: '339.glb' },
    real: cadReal('Kilroy Robotics', 'Kilroy26', 'Nivel bajo: flywheel fijo atrás con serializer y kickers, hopper que sale con la intake; rendimiento estimado.', 'Lower tier: fixed flywheel at the back with a serializer and kickers, hopper that slides out with the intake; estimated performance.'),
  }),
  base({
    id: 'cad-10021',
    name: 'Omega',
    teamNumber: 10021,
    widthIn: 27.6,
    lengthIn: 27.6,
    heightIn: 19.8,
    massKg: 58,
    maxSpeed: 4.1,
    // Shooter en SHOOTER_AXIS_POSITION (−0.2762, 0, 0.415 m) (RobotModelVisualizer)
    intake: { widthIn: 25, extensionIn: 10, rate: 11 },
    hopperCapacity: 55, // lo que cabe a escala en su hopper (cadRigs)
    shooter: { type: 'fixed', rate: 5, maxSpeed: 12, minAngle: 40, maxAngle: 62, accuracy: 0.74, exitHeightIn: 17, backspin: 30, lanes: 2, yawDeg: 180, posIn: [-10.9, 0] },
    climb: NO_CLIMB,
    colors: { primary: '#30343b', accent: '#8b1e3f' },
    cad: { file: '10021.glb' },
    real: cadReal('Guerin Catholic Robotics', 'Omega', 'Nivel bajo: tambor con hood atrás e intake que pivota; rendimiento estimado.', 'Lower tier: drum shooter with a hood at the back and a pivoting intake; estimated performance.'),
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
