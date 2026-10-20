/**
 * Articulación de los robots con CAD real: la pose de cada componente (c0, c1… del GLB, ver
 * scripts/robots/build-models.mjs) según el estado de los mecanismos del simulador.
 *
 * Igual que en AdvantageScope, cada componente se dibuja como `pose · zeroed · malla`, con la
 * pose en el marco WPILib del robot (X adelante, Y izquierda, Z arriba, metros). Las fórmulas
 * y constantes vienen del código de cada equipo (la clase que publica sus "component poses"),
 * citado en cada rig; donde el equipo no publica poses, el movimiento se dedujo del CAD.
 * Sin dependencias (lo usan RobotView y los scripts de verificación).
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export interface Pose {
  t: Vec3;
  q: Quat;
}

/** Estado de los mecanismos (lo que cambia la pose de los componentes). */
export interface MechState {
  /** Intake: 0 guardada – 1 desplegada. */
  intake: number;
  /** Hood: 0 tiro más bajo – 1 tiro más alto. */
  hood: number;
  /** Turret: rad, relativo al robot (+ = antihorario visto desde arriba, WPILib). */
  turret: number;
  /** Climber: 0 guardado – 1 extendido. */
  climb: number;
  /** Giro acumulado de spindexers/serializers (rad). */
  spin: number;
}

export interface CadRig {
  /**
   * Giro del modelo (grados, antihorario visto desde arriba) para que el frente del simulador
   * (+X) quede del lado de la intake.
   */
  yawDeg?: number;
  /** Pose de cada componente c0, c1… (marco WPILib del robot); null = oculto. */
  poses(m: MechState): Array<Pose | null>;
  /**
   * Volumen interior del hopper (WPILib, m) donde se dibuja el FUEL guardado. `maxDeployed`:
   * esquina máxima con la intake desplegada (el hopper crece hacia el frente, o la intake
   * guardada ocupa parte del hopper).
   */
  hopper?: { min: Vec3; max: Vec3; maxDeployed?: Vec3 };
  /**
   * Piezas que faltan en el CAD publicado (p. ej. el rodillo de la intake de 604): cilindros
   * entre `a` y `b` en el marco de la POSE del componente `comp`.
   */
  extras?: Array<{ comp: number; a: Vec3; b: Vec3; r: number; color: number }>;
  /** Componentes que se dibujan opacos aunque el CAD los marque translúcidos. */
  opaque?: number[];
}

// ------------------------------------------------------------------ álgebra mínima (WPILib)

const DEG = Math.PI / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const inch = (v: number) => v * 0.0254;

function qmul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function qrot(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

/** Rotation3d(roll, pitch, yaw) de WPILib: rotaciones extrínsecas X, luego Y, luego Z. */
export function rot(roll: number, pitch: number, yaw: number): Quat {
  const qx: Quat = [Math.sin(roll / 2), 0, 0, Math.cos(roll / 2)];
  const qy: Quat = [0, Math.sin(pitch / 2), 0, Math.cos(pitch / 2)];
  const qz: Quat = [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)];
  return qmul(qz, qmul(qy, qx));
}

export const pose = (t: Vec3, q: Quat = [0, 0, 0, 1]): Pose => ({ t, q });
const IDENTITY = pose([0, 0, 0]);

/** Pose3d.transformBy / Transform3d.plus: `b` expresada en el marco de `a`. */
export function compose(a: Pose, b: Pose): Pose {
  const r = qrot(a.q, b.t);
  return { t: [a.t[0] + r[0], a.t[1] + r[1], a.t[2] + r[2]], q: qmul(a.q, b.q) };
}

/** Pose3d.rotateAround(punto, rotación) (en el marco global). */
function rotateAround(p: Pose, c: Vec3, q: Quat): Pose {
  const r = qrot(q, [p.t[0] - c[0], p.t[1] - c[1], p.t[2] - c[2]]);
  return { t: [r[0] + c[0], r[1] + c[1], r[2] + c[2]], q: qmul(q, p.q) };
}

/** Giro alrededor de un pivote fijo (lo que hace un PivotingMechanism3d). */
const pivot = (p: Vec3, q: Quat): Pose => pose(p, q);

/**
 * Cuatro barras (FourBarLinkage.getLinkagePoses de 190): ángulos y puntos de cada eslabón para
 * la posición del motor. Longitudes AB (crank), BC (coupler), CD (follower), DA (ground).
 */
function fourBar(position: number, offset: number, zeroOffset: number, AB: number, BC: number, CD: number, DA: number) {
  const theta1 = offset;
  const theta2 = -(position - zeroOffset) - theta1;
  const k1 = DA / AB;
  const k4 = DA / BC;
  const k5 = (-AB * AB - BC * BC + CD * CD - DA * DA) / (2 * AB * BC);
  const D = Math.cos(theta2) - k1 + k4 * Math.cos(theta2) + k5;
  const E = -2 * Math.sin(theta2);
  const F = k1 + (k4 - 1) * Math.cos(theta2) + k5;
  const theta3 = 2 * Math.atan2(-E - Math.sqrt(Math.max(0, E * E - 4 * D * F)), 2 * D);
  const x2 = AB * Math.cos(theta2 + theta1);
  const z2 = AB * Math.sin(theta2 + theta1);
  const x3 = x2 + BC * Math.cos(theta3 + theta1);
  const z3 = z2 + BC * Math.sin(theta3 + theta1);
  const x4 = DA * Math.cos(theta1);
  const z4 = DA * Math.sin(theta1);
  return {
    crank: theta2 + theta1,
    coupler: theta3 + theta1,
    follower: Math.atan2(z4 - z3, x4 - x3),
    couplerStart: [x2, 0, z2] as Vec3,
  };
}

// ------------------------------------------------------------------ rigs por equipo

export const CAD_RIGS: Record<string, CadRig> = {
  /**
   * 6328 Darwin — DarwinMechanism3d.java. Componentes: hood, slamtake (intake), frente del
   * hopper (lo empuja la intake por una ranura a 70°) y "trash compactor". Slam: 145.8° guardada,
   * 17.4° desplegada (Slam.java); hood 10°–41.2° (Hood.java). Shooter fijo hacia atrás
   * (LauncherConstants.robotToLauncher: yaw π).
   */
  '6328.glb': {
    poses(m) {
      const hood = lerp(10, 41.2, m.hood) * DEG;
      const a = lerp(145.8170667799, 17.4088627799, m.intake) * DEG;
      const robotToPivotX = inch(12.48);
      const pivotToWasherNorm = inch(7.204);
      const pivotToSlotYOffset = inch(2.393);
      const slotStartToHopperX = inch(6.789);
      const slotAngle = 70 * DEG;
      const slotToWasherY = pivotToWasherNorm * Math.sin(a) - pivotToSlotYOffset;
      const robotToHopperX = robotToPivotX + pivotToWasherNorm * Math.cos(a) + slotToWasherY / Math.tan(slotAngle) + slotStartToHopperX;
      const robotToLauncher = pose([-0.151, 0, 0.486], rot(0, 0, Math.PI));
      return [
        compose(robotToLauncher, pose([0.122, 0, 0], rot(0, -hood, Math.PI))),
        pivot([robotToPivotX, 0, 0.186], rot(0, -a, 0)),
        pose([robotToHopperX, 0, 0.37]),
        pose([0.01, 0, 0.554692]),
      ];
    },
    hopper: { min: [-0.13, -0.29, 0.2], max: [0.07, 0.29, 0.5], maxDeployed: [0.5, 0.29, 0.5] },
  },

  /**
   * 1678 Limestone (asset "Beta") — BigChungusConstants / BigChungusIntakeMechanism3dHandler.
   * c0 climber (sube en Z), c1 intake (pivote, 130° guardada → 0° desplegada,
   * IntakeDeployConstants), c2 hood (17.5°–52.5°, HoodConstants), c3 extensión del hopper
   * (sale 0.167 m con la intake: HopperTracker), c4 piso del hopper (gira 40/130 de la intake).
   * Shooter fijo hacia atrás (DriveConstants.SHOOTER_OFFSET: yaw π).
   */
  '1678.glb': {
    poses(m) {
      const deploy = lerp(130, 0, m.intake);
      const maxExt = 0.16725;
      const ext = maxExt - (maxExt / 130) * deploy;
      const floor = (deploy * 40) / 130;
      const hood = lerp(17.5, 52.5, m.hood);
      return [
        pose([0, 0, m.climb * inch(8.25)]),
        pivot([0.309296, 0, 0.16901], rot(0, -deploy * DEG, 0)),
        pivot([-0.295275, 0, 0.45095], rot(0, -(hood - 17.5) * DEG, 0)),
        pose([ext, 0, 0]),
        pivot([-0.063648, 0, 0.131363], rot(0, -floor * DEG, 0)),
      ];
    },
    hopper: { min: [-0.12, -0.31, 0.17], max: [0.05, 0.31, 0.5], maxDeployed: [0.48, 0.31, 0.5] },
  },

  /**
   * 190 Doomspiral — V1_DoomSpiralMechanism3d + FourBarLinkage. c0 spindexer (gira en Z),
   * c1 climber, c2 parte fija de la intake, c3–c5 cuatro barras (crank, coupler, follower),
   * c6 cubierta del hopper (sin pose en el código: queda en su lugar del CAD).
   * Intake: 9° guardada → 176.1° desplegada; longitudes y offsets de IntakeConstants
   * (V1_DOOMSPIRAL). Shooter fijo hacia la derecha (SHOOTER_POSE: yaw −90°).
   */
  '190.glb': {
    poses(m) {
      const pos = lerp(9, 168.134766 + 8, m.intake) * DEG;
      const L = fourBar(pos, -30.9603232217 * DEG, Math.PI, inch(6.94305), inch(8.809879), inch(8.284456), inch(6.4213032));
      const crankT: Vec3 = [0.142476, 0, 0.278075];
      return [
        pose([-0.009525, 0, 0.067589], rot(0, 0, m.spin)),
        pose([-0.202788, 0.090048, 0.477077], rot(-m.climb * 1.6, 0, 0)),
        IDENTITY,
        pose(crankT, rot(0, -(L.crank - 171 * DEG), 0)),
        pose([crankT[0] + L.couplerStart[0], 0, crankT[2] + L.couplerStart[2]], rot(0, -(L.coupler - 18.88 * DEG), 0)),
        pose([0.278238, 0, 0.196629], rot(0, -(L.follower + 60.909742 * DEG), 0)),
        pose([-0.009856, 0, 0.304569]),
      ];
    },
    hopper: { min: [-0.2, -0.36, 0.13], max: [-0.06, 0.36, 0.5], maxDeployed: [0.25, 0.36, 0.5] },
  },

  /**
   * 604 Toploader — RobotContainer.robotPeriodic (mechanismPoses) y Constants. c0/c1 brazos de
   * la intake (80° guardada → −5° desplegada), c2 serializer (gira en Z), c3 base de la turret
   * (27.5 in de alto), c4 hood (15°–35°). El CAD publicado solo trae las placas de los brazos:
   * el rodillo se dibuja aparte (`extras`).
   */
  '604.glb': {
    poses(m) {
      const wrist = lerp(80, -5, m.intake) * DEG;
      const base = pose([0, inch(-1), inch(27.5)], rot(0, 0, m.turret));
      return [
        pose([inch(12), inch(13), inch(8.125)], rot(0, -wrist, 0)),
        pose([inch(12), inch(-13), inch(8.125)], rot(0, -wrist, 0)),
        pose([0, 0, 0], rot(0, 0, -m.spin)),
        base,
        compose(compose(base, pose([inch(2.931), 0, inch(-3.5)])), pose([0, 0, 0], rot(0, lerp(15, 35, m.hood) * DEG, 0))),
      ];
    },
    extras: [{ comp: 0, a: [0.27, 0.0, -0.04], b: [0.27, -0.66, -0.04], r: inch(1.1), color: 0x2a6b3a }],
    opaque: [0, 1], // las placas de los brazos vienen casi transparentes en el CAD

  },

  /**
   * 971 Mixtape — Visualization.java: dos turrets con su hood (hood = 1.3096 − ángulo) y el
   * "ground pivot" de la intake (0° desplegada, 120° guardada: SetpointGoal). La intake está
   * atrás en el CAD: el modelo se gira 180° para que quede al frente del simulador.
   */
  '971.glb': {
    yawDeg: 180,
    poses(m) {
      const hood = 1.30959265358 - lerp(1.05, 1.3, m.hood);
      const tl = pose([0.1624076 - 0.0144525, 0.224003 - 0.0144525, 0.2761615], rot(0, 0, m.turret));
      const tr = pose([0.1624076 - 0.0144525, -0.195097 - 0.0144525, 0.272987], rot(0, 0, m.turret));
      const toHood = pose([0.219786 - 0.1624076, 0, 0.445927 - 0.2761615]);
      return [
        tl,
        compose(compose(tl, toHood), pose([0, 0, 0], rot(0, hood, 0))),
        tr,
        compose(compose(tr, toHood), pose([0, 0, 0], rot(0, hood, 0))),
        IDENTITY,
        pose([-0.156033, 0, 0.132797], rot(0, lerp(120, 0, m.intake) * DEG, 0)),
      ];
    },
    hopper: { min: [-0.6, -0.36, 0.14], max: [-0.21, 0.36, 0.46] },
  },

  /**
   * 341 Miss Daisy XXIV — RobotVisualizer.java: climber, intake (44° arriba → 149° desplegada,
   * IntakeConstants), turret y hood (con el yaw de la turret).
   */
  '341.glb': {
    poses(m) {
      const intake = lerp(44, 149, m.intake);
      const climber = lerp(0, 90, m.climb);
      const turretDeg = m.turret / DEG;
      const hood = lerp(0, 25, m.hood);
      return [
        pose([-0.065, -0.99, 0.445], rot(0, (climber - 90) * DEG, 0)),
        pose([0.25, 0, 0.326], rot(0, (intake - 115) * DEG, 0)),
        pose([-0.1, 0.0765, 0.325], rot(0, 0, turretDeg * DEG)),
        pose([-0.1, 0.08, 0.38], rot(0, (hood - 90) * DEG, turretDeg * DEG)),
      ];
    },
  },

  /**
   * 5000 Icarus — TurretVisualizer, IntakeVisualizer, IndexerVisualizer. Turret al centro, hood
   * 6.24°–47° a 18 in (Constants), indexer que gira y DOS intakes de cremallera que salen en
   * diagonal hacia los lados (21° hacia abajo, 0.2 → 11.5 in). El modelo se gira −90° para que
   * la intake izquierda quede al frente del simulador; la derecha se queda guardada.
   */
  '5000.glb': {
    yawDeg: -90,
    poses(m) {
      const az = m.turret;
      const hood = lerp(6.24, 47, m.hood) * DEG;
      const h = rotateAround(pose([0.1, 0, 0], rot(0, hood, 0)), [0, 0, 0], rot(0, 0, az));
      const left = lerp(inch(0.2), inch(11.5), m.intake);
      const right = inch(0.2);
      return [
        pose([0, 0, 0], rot(0, 0, az)),
        pose([h.t[0], h.t[1], h.t[2] + inch(18)], h.q),
        pose([0, 0, 0], rot(0, 0, -m.spin)),
        pose([0, left * Math.cos(-21 * DEG), left * Math.sin(-21 * DEG)]),
        pose([0, right * Math.cos(201 * DEG), right * Math.sin(201 * DEG)]),
      ];
    },
  },

  /**
   * 4915 ARTEMIS — su código no publica poses de componentes: los movimientos se dedujeron del
   * CAD. Turret en (−0.1185, −0.1568) (SuperstructureConstants.turretTranslation2D) con el hood
   * encima, spindexer y la intake que pivota (PivotConstants: −2°…132°; en el CAD, desplegada).
   * Los componentes vienen exportados girados 180° respecto al robot (zeroed sin la rotación
   * del modelo): `flip` los regresa a su lugar.
   */
  '4915.glb': {
    poses(m) {
      const flip = rot(0, Math.PI, 0); // rotación del modelo (y: 180°)
      const turretC: Vec3 = [-0.1185, -0.1568, 0];
      const spinC: Vec3 = [0.05, 0, 0];
      const turret = rotateAround(pose([0, 0, 0], flip), turretC, rot(0, 0, m.turret));
      // Intake: pivote en la catarina del extremo interior de los brazos; guardada casi vertical
      const ip: Vec3 = [0.272, 0, 0.178];
      const intake = rotateAround(pose([0, 0, 0], flip), ip, rot(0, -lerp(105, 0, m.intake) * DEG, 0));
      // Hood: gira con la turret y sube con el ángulo de tiro
      const hp: Vec3 = [-0.13, -0.1568, 0.47];
      const hood = rotateAround(rotateAround(pose([0, 0, 0], flip), hp, rot(0, lerp(10, -15, m.hood) * DEG, 0)), turretC, rot(0, 0, m.turret));
      return [hood, turret, rotateAround(pose([0, 0, 0], flip), spinC, rot(0, 0, m.spin)), pose([0, 0, 0], flip), intake];
    },
    hopper: { min: [-0.04, -0.28, 0.12], max: [0.2, 0.24, 0.38], maxDeployed: [0.3, 0.24, 0.38] },
  },
};
