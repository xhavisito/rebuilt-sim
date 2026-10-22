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
  /** Volumen interior del hopper, donde se dibuja el FUEL guardado (ver `HopperBox`). */
  hopper?: HopperBox[];
  /**
   * Piezas que faltan en el CAD publicado (p. ej. el rodillo de la intake de 604): cilindros
   * entre `a` y `b` en el marco de la POSE del componente `comp`.
   */
  extras?: Array<{ comp: number; a: Vec3; b: Vec3; r: number; color: number }>;
  /** Componentes que se dibujan opacos aunque el CAD los marque translúcidos. */
  opaque?: number[];
  /**
   * Paredes de policarbonato del hopper que el CAD publicado no trae (604, 4915: sin ellas el
   * FUEL se veía flotando): los 4 lados de cada caja; con `maxDeployed`, el frente se recorre
   * con la intake.
   */
  walls?: HopperBox[];
}

/**
 * Caja del hopper (marco WPILib del robot, m, con los mecanismos guardados; `max[2]` = borde de
 * las paredes: la capa de arriba asoma media pelota sobre él). `maxDeployed`:
 * esquina máxima con la intake desplegada (el hopper crece hacia el frente, o la intake guardada
 * ocupa esa parte); entonces el FUEL guardado mantiene la intake abierta lo necesario para caber.
 * `comp`: la caja va montada en ese componente y se mueve con él (bandejas de 5000).
 */
export interface HopperBox {
  min: Vec3;
  max: Vec3;
  maxDeployed?: Vec3;
  /** Esquina mínima desplegada: el hopper crece hacia −X o −Y del CAD (robots girados 180° o 90°). */
  minDeployed?: Vec3;
  comp?: number;
  /**
   * Anillo alrededor de un spindexer/rotor (centro x, y y radio del círculo de centros): los
   * FUEL van en fila alrededor del eje, en capas entre min[2] y max[2] (x, y de min/max se ignoran).
   */
  ring?: [number, number, number];
}

/** Lugar de un FUEL en el hopper: caja y centro (marco WPILib, mecanismos guardados). */
export interface HopperSlot {
  box: number;
  p: Vec3;
}

/** Opacidad mínima de las piezas transparentes del CAD (policarbonato) para que se vean en el campo. */
export const CLEAR_MIN_OPACITY = 0.55;
export const FUEL_D = 0.150114; // 5.91 in

/**
 * Lugares del FUEL en las cajas del hopper: capas de abajo hacia arriba (cada capa corrida medio
 * FUEL, como se acomodan las pelotas) y, en cada capa, de atrás hacia adelante. El orden es el
 * orden de llenado.
 */
export function hopperSlots(boxes: HopperBox[], max = 80): HopperSlot[] {
  const out: HopperSlot[] = [];
  const d = FUEL_D;
  const r = d / 2;
  boxes.forEach((b, box) => {
    if (b.ring) {
      const [cx, cy, rr] = b.ring;
      const n = Math.max(1, Math.floor((2 * Math.PI * rr) / (d * 1.02)));
      const nz = Math.floor(Math.max(0, b.max[2] - b.min[2] - d) / (d * 0.82)) + 1;
      for (let z = 0; z < nz; z++)
        for (let k = 0; k < n; k++) {
          const a = ((k + (z % 2) * 0.5) / n) * 2 * Math.PI;
          out.push({ box, p: [cx + rr * Math.cos(a), cy + rr * Math.sin(a), b.min[2] + r + 0.003 + z * d * 0.82] });
        }
      return;
    }
    const lo = b.minDeployed ?? b.min;
    const hi = b.maxDeployed ?? b.max;
    const sx = hi[0] - lo[0] - d;
    const sy = hi[1] - lo[1] - d;
    const sz = hi[2] - lo[2] - d;
    if (sx < -0.02 || sy < -0.02 || sz < -0.02) return;
    // En las cajas que crecen al desplegar, el FUEL se acomoda desde el lado que no se mueve
    const fromHi = (k: number) => !!b.minDeployed && b.minDeployed[k] < b.min[k] - 1e-6;
    const fromLo = (k: number) => !!b.maxDeployed && b.maxDeployed[k] > b.max[k] + 1e-6;
    // Empaque hexagonal: filas a 0.866·d con media pelota de corrimiento, y cada capa corrida
    // sobre los huecos de la de abajo (como se acomodan las pelotas de verdad).
    // La capa de arriba puede asomar media pelota sobre las paredes (hopper lleno "copeteado")
    const dy = d * 0.866;
    const nz = Math.floor(Math.max(0, sz + r) / (d * 0.82)) + 1;
    const place = (k: number, span: number, n: number, step: number, off: number, i: number) => {
      if (fromHi(k)) return hi[k] - r - off - i * step;
      if (fromLo(k)) return lo[k] + r + off + i * step;
      return lo[k] + r + off + (Math.max(0, span - off) - (n - 1) * step) / 2 + i * step;
    };
    for (let z = 0; z < nz; z++) {
      const lx = z % 2 ? r * 0.5 : 0;
      const ly = z % 2 ? dy * 0.5 : 0;
      const ny = Math.floor(Math.max(0, sy - ly) / dy) + 1;
      for (let j = 0; j < ny; j++) {
        const off = lx + (j % 2) * r;
        const nx = Math.floor(Math.max(0, sx - off) / d) + 1;
        const y = place(1, sy, ny, dy, ly, j);
        for (let i = 0; i < nx; i++) out.push({ box, p: [place(0, sx, nx, d, off, i), y, lo[2] + r + 0.003 + z * d * 0.82] });
      }
    }
  });
  // Orden de llenado: capa por capa y, en cada capa, primero lo que cabe con la intake guardada
  out.sort((a, b) => a.p[2] - b.p[2] || slotNeed(boxes[a.box], a) - slotNeed(boxes[b.box], b) || a.p[0] - b.p[0] || a.box - b.box);
  return out.slice(0, max);
}

/**
 * FUEL que se dibujan en un hopper con `slots` lugares visibles: todos si caben; si el hopper real
 * guarda más de los que caben a la vista, la cantidad dibujada es proporcional al llenado (lleno
 * se ve lleno), y nunca cero si hay FUEL.
 */
export function shownFuel(n: number, slots: number, capacity: number): number {
  if (n <= 0 || slots <= 0) return 0;
  if (capacity <= slots) return Math.min(n, slots);
  return Math.min(slots, Math.max(1, Math.round((n * slots) / capacity)));
}

/** Despliegue mínimo (0–1) con el que el lugar cabe en su caja (las que crecen al desplegar). */
export function slotNeed(b: HopperBox, s: HopperSlot): number {
  const R = FUEL_D / 2;
  let need = 0;
  for (let k = 0; k < 2; k++) {
    if (b.maxDeployed && b.maxDeployed[k] > b.max[k] + 1e-6) need = Math.max(need, (s.p[k] + R - b.max[k] - 0.012) / (b.maxDeployed[k] - b.max[k]));
    if (b.minDeployed && b.minDeployed[k] < b.min[k] - 1e-6) need = Math.max(need, (b.min[k] - (s.p[k] - R) - 0.012) / (b.min[k] - b.minDeployed[k]));
  }
  // hopper que sube al desplegar (8214): la capa de arriba llega al borde (asoma media pelota)
  if (b.maxDeployed && b.maxDeployed[2] > b.max[2] + 1e-6) need = Math.max(need, (s.p[2] - b.max[2] - 0.012) / (b.maxDeployed[2] - b.max[2]));
  return Math.min(1, Math.max(0, need));
}

/** ¿El lugar cabe con la intake desplegada `e` (0–1)? (cajas que crecen al desplegar) */
export function slotFits(b: HopperBox, s: HopperSlot, e: number): boolean {
  return slotNeed(b, s) <= e + 1e-9;
}

/** Despliegue mínimo de la intake para que quepan `n` FUEL (el FUEL la mantiene abierta). */
export function openingFor(boxes: HopperBox[], slots: HopperSlot[], n: number): number {
  if (!boxes.some((b) => b.maxDeployed || b.minDeployed)) return 0;
  const want = Math.min(n, slots.length);
  for (let e = 0; e <= 1.0001; e += 0.05) {
    let k = 0;
    for (const s of slots) if (slotFits(boxes[s.box], s, e)) k++;
    if (k >= want) return e;
  }
  return 1;
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

/**
 * 3478: cuánto sale el frente del hopper con la intake desplegada (m): 0.25 m de la primera
 * versión + 25 mm que pidió el equipo.
 */
const HOPPER_EXT_3478 = 0.275;

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
    hopper: [{ min: [-0.13, -0.29, 0.2], max: [0.07, 0.29, 0.56], maxDeployed: [0.62, 0.29, 0.56] }],
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
    hopper: [{ min: [-0.12, -0.32, 0.18], max: [0.05, 0.32, 0.55], maxDeployed: [0.49, 0.32, 0.55] }],
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
    // Sobre el spindexer y bajo la cubierta; arriba, sin invadir el shooter (lado izquierdo)
    hopper: [
      { min: [-0.22, -0.25, 0.125], max: [-0.06, 0.25, 0.27], maxDeployed: [0.22, 0.25, 0.27] },
      { min: [-0.22, -0.37, 0.25], max: [-0.06, 0.09, 0.53], maxDeployed: [0.22, 0.09, 0.53] },
    ],
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
    // Sin paredes de hopper en el CAD: el FUEL se dibuja sobre el chasis, alrededor de la torre
    // del serializer (al frente, a los lados y atrás de ella)
    walls: [{ min: [-0.335, -0.335, 0.17], max: [0.335, 0.335, 0.47] }],
    hopper: [
      { min: [0.11, -0.33, 0.17], max: [0.335, 0.33, 0.47] },
      { min: [-0.11, 0.12, 0.17], max: [0.11, 0.335, 0.47] },
      { min: [-0.11, -0.335, 0.17], max: [0.11, -0.12, 0.47] },
      { min: [-0.335, -0.33, 0.21], max: [-0.11, 0.33, 0.47] },
    ],
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
    hopper: [{ min: [-0.6, -0.36, 0.13], max: [-0.03, 0.36, 0.5] }],
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
    // Sin hopper: el FUEL en tránsito (4 de ancho tras la intake) sobre el piso del embudo
    hopper: [{ min: [0.13, -0.31, 0.17], max: [0.3, 0.31, 0.47] }],
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
    // El FUEL da vueltas en fila alrededor del "dye rotor" (indexer central), en la tina circular
    hopper: [{ min: [0, 0, 0.12], max: [0, 0, 0.41], ring: [0.005, -0.005, 0.185] }],
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
    // Sobre el spindexer; la segunda capa solo al frente (atrás queda la base de la turret)
    walls: [{ min: [-0.21, -0.33, 0.12], max: [0.21, 0.31, 0.43], maxDeployed: [0.32, 0.31, 0.43] }],
    hopper: [
      { min: [-0.2, -0.32, 0.12], max: [0.2, 0.3, 0.27], maxDeployed: [0.31, 0.3, 0.27] },
      { min: [0.03, -0.32, 0.25], max: [0.03, 0.3, 0.42], maxDeployed: [0.31, 0.3, 0.42] },
    ],
  },

  /**
   * 3478 Bocho (LamBot) — CAD de SolidWorks mandado por el equipo, sin código de poses: los
   * componentes son subensambles separados por nombre (sources.mjs `parts`, zeroed nulo) y los
   * movimientos se dedujeron del CAD y de lo que contó el equipo. c0 intake (guardada dentro del
   * hopper; gira 140° sobre su pivote al frente del chasis hasta el piso), c1 shooter de la
   * turret (atrás a la derecha), c2 spindexer y c3 frente del hopper: la intake lo empuja al
   * salir (`HOPPER_EXT_3478`) y sus paredes laterales se deslizan en las placas fijas.
   */
  '3478.glb': {
    poses(m) {
      const ip: Vec3 = [0.31, 0, 0.2];
      const turretC: Vec3 = [-0.155, -0.168, 0];
      const spinC: Vec3 = [0.0985, -0.004, 0];
      return [
        rotateAround(IDENTITY, ip, rot(0, lerp(0, 140, m.intake) * DEG, 0)),
        // En el CAD el shooter (flywheels y hood) queda atrás del eje: turret 0 = tirar hacia atrás
        rotateAround(IDENTITY, turretC, rot(0, 0, m.turret + Math.PI)),
        rotateAround(IDENTITY, spinC, rot(0, 0, m.spin)),
        pose([HOPPER_EXT_3478 * m.intake, 0, 0]),
      ];
    },
    // Todo el hopper (mitad del frente, de la pared del elevador/turret a la pared del frente y de
    // lado a lado, hasta arriba): el FUEL da vueltas alrededor del cono del spindexer, se apila
    // arriba de la intake guardada y ocupa el hueco que ella deja al salir; con la intake
    // desplegada el hopper crece hasta su nuevo frente. Lleno se ve lleno (75 FUEL).
    hopper: [
      { min: [0, 0, 0.11], max: [0, 0, 0.26], ring: [0.0985, -0.004, 0.16] },
      { min: [0.02, -0.31, 0.27], max: [0.12, 0.31, 0.44], maxDeployed: [0.12 + HOPPER_EXT_3478, 0.31, 0.44] },
      { min: [0.02, -0.31, 0.44], max: [0.33, 0.31, 0.72], maxDeployed: [0.33 + HOPPER_EXT_3478, 0.31, 0.72] },
    ],
  },

  /**
   * 401 (Copperhead) — RobotContainer.updateRobotModel y deploy/constants/comp/*.json. Orden de
   * reference.txt: c0 base del shooter (gira con la turret: heading − 180°), c1 indexer + hopper,
   * c2 intake (pivote: −8° desplegada → 90° guardada, IntakeConstants), c3 soporte de la turret,
   * c4 carro del climber (sube en Z), c5 hood (−pitch + 50°; 13.75°–65°, HoodConstants).
   */
  '401.glb': {
    poses(m) {
      const shooterBase = pose([-0.058, 0.245, 0.37], rot(0, 0, -Math.PI / 2));
      const so = pose([0.1045, -0.039, 0]);
      const shooter = compose(compose(compose(shooterBase, so), pose([0, 0, 0], rot(0, 0, m.turret - Math.PI))), pose([-0.1045, 0.039, 0]));
      const hoodRef = pose([0, 0.021, 0.101]);
      const hood = lerp(13.7532108812, 65, m.hood) * DEG;
      const iRef = pose([0.352, 0.158, 0.034]);
      const intake = lerp(90, -8, m.intake) * DEG;
      return [
        shooter,
        pose([0.121, 0.025, 0], rot(Math.PI / 2, 0, Math.PI / 2)),
        compose(compose(compose(pose([0.35, 0, 0], rot(Math.PI / 2, 0, -Math.PI / 2)), iRef), pose([0, 0, 0], rot(intake, 0, 0))), pose([-0.352, -0.158, -0.034])),
        pose([-0.099, 0.138, 0.331], rot(Math.PI / 2, 0, -Math.PI / 2)),
        pose([-0.18, -0.218, -0.19 + m.climb * 0.3], rot(Math.PI / 2, 0, Math.PI)),
        compose(compose(compose(compose(shooter, pose([0.1875, -0.04, 0.033], rot(Math.PI / 2, 0, 0))), hoodRef), pose([0, 0, 0], rot(-hood + 50 * DEG, 0, 0))), pose([0, -0.021, -0.101])),
      ];
    },
    // Hopper sobre el indexer (c1), entre la turret (atrás a la izquierda) y la intake
    hopper: [{ min: [-0.08, -0.3, 0.13], max: [0.28, 0.3, 0.42] }],
  },

  /**
   * 2601 (Steel Hawks) "Kirin" — SuperstructureVisualizer e IntakeVisualizer. c0 turret en
   * ROBOT_TO_TURRET (−5, 0, 17 in) con yaw turret + π, c1 hood (pitch −(80° − ángulo), 40°–80°:
   * SimBot.HOOD), c2 intake de cremallera a −19° (Intake.RACK_ANGLE) que sale 12.125 in.
   */
  '2601.glb': {
    poses(m) {
      const t: Vec3 = [inch(-5), 0, inch(17)];
      const yaw = m.turret + Math.PI;
      const hood = lerp(80, 40, m.hood) * DEG;
      const rack = lerp(0, inch(12.125), m.intake);
      const a = -19 * DEG;
      return [
        pose(t, rot(0, 0, yaw)),
        pose([t[0], t[1] + inch(-4.358), t[2] + inch(-2.642)], rot(0, -(80 * DEG - hood), yaw)),
        pose([rack * Math.cos(a), 0, rack * Math.sin(a)]),
      ];
    },
    // Hopper de todo el robot: alto al frente, bajo atrás (debajo de la turret)
    hopper: [
      { min: [-0.02, -0.3, 0.12], max: [0.3, 0.3, 0.55], maxDeployed: [0.58, 0.3, 0.55] },
      { min: [-0.32, -0.3, 0.12], max: [-0.02, 0.3, 0.3] },
    ],
  },

  /**
   * 4201 (Vitruvian Bots) "Threepeater" — simulation/Robot2d.java. c0 intake que pivota en
   * SIM.intakeOrigin (0° guardada → 105° desplegada: pitch −(105° − ángulo)), c1 hopper que sale
   * con la intake hasta 12 in. Shooter fijo hacia el frente (FuelSim.launchFuel con yaw 0).
   */
  '4201.glb': {
    poses(m) {
      const a = lerp(0, 105, m.intake);
      return [pivot([0.06, 0, 0.13], rot(0, -(105 - a) * DEG, 0)), pose([inch((a * 12) / 105), 0, 0])];
    },
    // Hopper alto (el robot mide casi 30 in) que crece 12 in al frente con la intake
    hopper: [{ min: [-0.22, -0.3, 0.16], max: [0.2, 0.3, 0.6], maxDeployed: [0.5, 0.3, 0.6] }],
  },

  /**
   * 6357 (The Spring Konstant) — SK26Turret.telemeterize: c0 turret que gira alrededor de
   * (−7.05, 7.05 in); su ángulo = estándar − 90° (kTurretCoordinateOffset). c1 intake "four
   * slaps" (subensamble separado por nombre, sources.mjs `parts`; desplegada en el CAD): sin poses
   * en el código, se levanta 60° sobre el eje de sus brazos (deducido del CAD).
   */
  '6357.glb': {
    poses(m) {
      return [
        rotateAround(IDENTITY, [inch(-7.05), inch(7.05), 0], rot(0, 0, m.turret - Math.PI / 2)),
        rotateAround(IDENTITY, [0.2, 0, 0.19], rot(0, -lerp(60, 0, m.intake) * DEG, 0)),
      ];
    },
    // Hopper al frente, abajo de las paredes naranjas que sobresalen del chasis
    hopper: [{ min: [-0.05, -0.3, 0.2], max: [0.5, 0.3, 0.6] }],
  },

  /**
   * 6657 (Arborbotics) — Superstructure.get3DComponents y TurretConstants. c0 turret en
   * TURRET_CENTER (yaw = heading relativo + 90°, getRelativeTurretHeading), c1 hood (roll de
   * 10°–40°, HoodConstants) desplazado HOOD_OFFSET con la turret, c2 intake de cremallera hacia
   * atrás a 0.2229 rad (0–12.375 in, IntakeConstants) con las paredes del hopper. La intake está
   * atrás en el CAD: el modelo se gira 180°.
   */
  '6657.glb': {
    yawDeg: 180,
    poses(m) {
      const center: Vec3 = [0.118317, -0.105617, 0.511175];
      const q = rot(0, 0, m.turret + Math.PI / 2);
      const off = qrot(q, [0, inch(-4.7), inch(0.95)]);
      const ext = lerp(0, inch(12.375), m.intake);
      return [
        pose(center, q),
        pose([center[0] + off[0], center[1] + off[1], center[2] + off[2]], qmul(q, rot(lerp(10, 40, m.hood) * DEG, 0, 0))),
        pose([-Math.cos(0.2229) * ext, 0, -Math.sin(0.2229) * ext]),
      ];
    },
    // Hopper atrás en el CAD, montado en la intake (sus paredes salen con ella)
    hopper: [{ min: [-0.38, -0.3, 0.26], max: [0.02, 0.3, 0.62], comp: 2 }],
  },

  /**
   * 7130 "BataBot" — Telemetry.telemeterizeIntake/ShooterAngle/Climber (poses absolutas de
   * componente). c0 intake: pitch (−0.05 + p) rot, p entre los límites de IntakeConstants (en
   * este asset −0.347 la deja guardada y −0.01 desplegada); c1 indexer que sale con ella hasta 0.28 m; c2 shooter (hood): pitch
   * (−0.0675 + s) rot, s 0–0.055 (ShooterConstants); c3 climber que sube.
   */
  '7130.glb': {
    poses(m) {
      const p = lerp(-0.347412, -0.01, m.intake);
      const s = lerp(0, 0.055, m.hood);
      const R = 2 * Math.PI;
      return [
        pose([0.312, 0, 0.222], rot(0, (-0.05 + p) * R, 0)),
        pose([0.35 + Math.min((p + 0.39) * 1.4, 0.28), 0, 0.37]),
        pose([-0.075, 0, 0.472], rot(0, (-0.0675 + s) * R, 0)),
        pose([-0.1, 0.282, 0.17 + m.climb * 0.3]),
      ];
    },
    // Bandeja (verde) que sale al frente con la intake
    hopper: [{ min: [-0.15, -0.27, 0.33], max: [0.22, 0.27, 0.56], maxDeployed: [0.55, 0.27, 0.56] }],
  },

  /**
   * 2713 (Red Hawk Robotics) — KinematicsManager: poses locales encadenadas (padre ∘
   * initialTransform ∘ movimiento). c0 intake que sale 0–11.5 in en +X (IntakeConstants), c1
   * dye rotor (spindexer) en (0.5, 0.5, 0) in, c2 turret en (0.5, 0.5, 18.48) in con offset de
   * 180° (manualOffset), c3 hood montado en la turret (2.45, 0, 1.03 in), 0°–30°.
   */
  '2713.glb': {
    poses(m) {
      const turret = pose([inch(0.5), inch(0.5), inch(18.484119)], rot(0, 0, m.turret + Math.PI));
      return [
        pose([lerp(0, inch(11.5), m.intake), 0, 0]),
        pose([inch(0.5), inch(0.5), 0], rot(0, 0, m.spin)),
        turret,
        compose(turret, pose([inch(2.452807), 0, inch(1.026032)], rot(0, lerp(0, 30, m.hood) * DEG, 0))),
      ];
    },
    hopper: [{ min: [-0.25, -0.3, 0.12], max: [0.25, 0.3, 0.42], maxDeployed: [0.5, 0.3, 0.42] }],
  },

  /**
   * 2412 (Robototes) "Corner Turret" — asset sin componentes: la turret (c0) y la cabeza de la
   * intake (c1) se separan por nombre (sources.mjs `parts`). La turret gira sobre su anillo
   * (centro deducido del CAD; en el CAD el hood apunta a −140°, así que se suma 140° para que turret 0 = al frente); la intake se guarda encima del robot y baja hacia atrás
   * (IntakePivot.DEPLOYED_POS = −0.43 rot ≈ 155°; aquí 140° para que quede sobre el piso).
   * La intake está atrás en el CAD: el modelo se gira 180°.
   */
  '2412.glb': {
    yawDeg: 180,
    poses(m) {
      return [
        rotateAround(IDENTITY, [0.15, 0.2, 0], rot(0, 0, m.turret + 140 * DEG)),
        rotateAround(IDENTITY, [-0.3, 0, 0.22], rot(0, -lerp(0, 140, m.intake) * DEG, 0)),
      ];
    },
    hopper: [{ min: [-0.32, -0.3, 0.12], max: [0.05, 0.3, 0.5] }],
  },

  /**
   * 2826 (Wave Robotics) — asset sin componentes: el hopper extensible con la intake (c0) y la
   * turret "V4 Azimuth" (c1, subsystems/turret) se separan por nombre (sources.mjs `parts`). En el
   * CAD el hopper está desplegado hacia atrás; guardado entra 0.3 m. La turret gira en el centro
   * de sus anillos y en el CAD su hood apunta a −90° (deducido del CAD). El modelo se gira 180°.
   */
  '2826.glb': {
    yawDeg: 180,
    poses(m) {
      return [pose([lerp(0.3, 0, m.intake), 0, 0]), rotateAround(IDENTITY, [0.106, -0.019, 0], rot(0, 0, m.turret + Math.PI / 2))];
    },
    hopper: [{ min: [-0.22, -0.28, 0.12], max: [0.22, 0.28, 0.5], comp: 0 }],
  },

  /**
   * 2363 (Triple Helix) "Rho" — asset de una pieza: la intake de cuatro barras (c0) y la turret
   * (c1, LauncherConstants.TurretConstants: −95°…175°) se separan por nombre (sources.mjs `parts`,
   * NAUO… del STEP). Intake desplegada en el CAD; guardada sube 100° sobre su pivote. La turret
   * gira sobre el centro de su placa (deducido del CAD) y en el CAD apunta a −45° (el lado alto del hood, sobre el flywheel, es la salida).
   */
  '2363.glb': {
    poses(m) {
      return [
        rotateAround(IDENTITY, [0.345, 0, 0.195], rot(0, -lerp(100, 0, m.intake) * DEG, 0)),
        rotateAround(IDENTITY, [-0.055, -0.13, 0], rot(0, 0, m.turret + Math.PI / 4)),
      ];
    },
    hopper: [{ min: [-0.3, -0.28, 0.1], max: [0.25, 0.28, 0.52] }],
  },

  /**
   * 9584 (WCP Competitive Concept, 971) — el asset es una sola malla sin partes, con los colores
   * en una textura de paleta y los BUMPERS fundidos (ver `bumperClip`). Viene girado: los
   * flywheels miran a +Y del CAD y la intake a −Y. Su código apunta el frente al HUB
   * (AimAndDriveCommand) y en el simulador la intake va al frente: se gira 90°. Los hoods del
   * shooter se curvan hacia la intake: tira hacia el frente, por encima del hopper. Partes
   * recortadas por triángulo (`clipComp`): la pared del hopper (c0) sale 0.3 m hacia −Y al
   * desplegar y la intake de abajo (c1) sale con ella y baja 8 cm, al nivel del FUEL.
   */
  '9584.glb': {
    yawDeg: 90,
    poses(m) {
      const out = -lerp(0, 0.3, Math.min(1, m.intake * 1.4));
      return [pose([0, out, 0]), pose([0, out, -lerp(0, 0.08, Math.max(0, m.intake * 3.5 - 2.5))])];
    },
    hopper: [{ min: [-0.3, -0.32, 0.14], max: [0.3, 0.15, 0.62], minDeployed: [-0.3, -0.6, 0.14] }],
  },

  /**
   * 180 (S.P.A.M.) "Batman" — TurretSubsystem.getVisPose (VIS_TRANSFORM: ROBOT_TO_TURRET
   * (−3.91, 6.03 in) a 0.32 m, yaw −ángulo − 90°) e IntakeExtensionSubsystem.getVisPose (la
   * intake sale 0.2 m en +X; desplegada en el CAD).
   */
  '180.glb': {
    poses(m) {
      return [pose([inch(-3.9119), inch(6.0301), 0.32], rot(0, 0, m.turret - Math.PI / 2)), pose([lerp(-0.2, 0, m.intake), 0, 0])];
    },
    hopper: [{ min: [-0.3, -0.28, 0.1], max: [0.25, 0.28, 0.4], maxDeployed: [0.42, 0.28, 0.4] }],
  },

  /**
   * 8214 (Next Innovation) — Visualizer (TransformTree): todo cuelga de "swerve" = raíz a
   * 0.047 m con Rotation3d(90°, 0, 90°) (Swerve.getRobotToSwerveTransform; el asset viene sin
   * rotaciones). c1 shooter: pitch alrededor de (0, 0.43, −0.275) con giro inicial de −80°;
   * c2 intake: −pivote alrededor de (0, 0.14, 0.28), 0° desplegada y 100° guardada
   * (IntakeGoal SAFE_IDLE); c3 hopper que sube 0.3 m cuando no lo cubre la intake
   * (HOPPER_UNCOVERED_METERS). Visualizer.applyRotationCenter: t + c − R·c.
   */
  '8214.glb': {
    poses(m) {
      const swerve = pose([0, 0, 0.047], rot(Math.PI / 2, 0, Math.PI / 2));
      const around = (c: Vec3, q: Quat): Pose => {
        const r = qrot(q, c);
        return pose([c[0] - r[0], c[1] - r[1], c[2] - r[2]], q);
      };
      const shooter = qmul(rot(lerp(0, 25, m.hood) * DEG, 0, 0), rot(-80 * DEG, 0, 0));
      const intake = rot(-lerp(100, 0, m.intake) * DEG, 0, 0);
      return [
        swerve,
        compose(swerve, around([0, 0.43, -0.275], shooter)),
        compose(swerve, around([0, 0.14, 0.28], intake)),
        compose(swerve, pose([0, 0, lerp(0, 0.3, m.intake)])),
      ];
    },
    hopper: [{ min: [-0.05, -0.3, 0.14], max: [0.33, 0.3, 0.32], maxDeployed: [0.33, 0.3, 0.6] }],
  },

  /**
   * 9410 — MechanismSimManager.publishComponentPoses: rotateAboutPivot(pivote, Δ desde el CAD) =
   * Pose3d(pivote, pitch −Δ) ∘ −pivote. c0 intake en INTAKE_PIVOT (12.866, 0, 9.101 in): −7.5°
   * abajo (INTAKE_MAX) a ≈122.5° arriba (INTAKE_MIN, 0.362 rot más), CAD a −2°; c1 hood en
   * (−0.272, 0, 0.517) desde 22.1° hasta 0.11 rot × 24/46 más; c2 hopper cuyo frente va de 14 a
   * 27.2 in (en el CAD a 37.2 in); c3–c6 ruedas del swerve.
   */
  '9410.glb': {
    poses(m) {
      const intake = (lerp(-7.5 + 0.362 * 360, -7.5, m.intake) + 2) * DEG;
      const hood = lerp(0, 0.11 * 360 * (24 / 46), m.hood) * DEG;
      return [
        rotateAround(IDENTITY, [inch(12.866), 0, inch(9.101)], rot(0, -intake, 0)),
        rotateAround(IDENTITY, [-0.272, 0, 0.517], rot(0, -hood, 0)),
        pose([inch(27.2 - 37.2) - (1 - m.intake) * inch(27.2 - 14), 0, 0]),
        IDENTITY,
        IDENTITY,
        IDENTITY,
        IDENTITY,
      ];
    },
    // MechanismSimConstants: HOPPER_BACK_X_M −5.4 in, frente 14 → 27.2 in, ±11.6 in
    hopper: [{ min: [inch(-5.4), inch(-11.6), 0.15], max: [inch(14), inch(11.6), 0.68], maxDeployed: [inch(27.2), inch(11.6), 0.68] }],
  },

  /**
   * 7419 — Robot.robotPeriodic (ComponentPoses) y Constants: c0 turret en turretBasePose con su
   * yaw, c1 hood en turretToHood con pitch π/2 − hood − 0.3054 (hood 30°–64°, HoodConstants),
   * c2 intake con pitch −muñeca (0°–120°, 120° desplegada: IntakeConstants.kMaxWristAngle),
   * c3 hopper que sale hasta 0.301625 m hacia −X con la intake. La intake está atrás en el CAD:
   * el modelo se gira 180°.
   */
  '7419.glb': {
    yawDeg: 180,
    poses(m) {
      const turret = pose([0.15875, 0.15875, 0.298454], rot(0, 0, m.turret));
      const hood = lerp(30, 64, m.hood) * DEG;
      const wrist = lerp(0, 120, m.intake) * DEG;
      return [
        turret,
        compose(compose(turret, pose([0.252158 - 0.15875, 0.1546565 - 0.15875, 0.4318 - 0.298454])), pose([0, 0, 0], rot(0, Math.PI / 2 - hood - 0.3054325, 0))),
        pose([-0.29464, 0, 0.193312], rot(0, -wrist, 0)),
        pose([-0.317817 - m.intake * 0.301625, 0, 0.427038]),
      ];
    },
    hopper: [{ min: [-0.3, -0.28, 0.12], max: [0.05, 0.28, 0.52], minDeployed: [-0.6, -0.28, 0.12] }],
  },

  /**
   * 10021 (Guerin Catholic) "Omega" — RobotModelVisualizer: c0 intake con pitch −ángulo en
   * INTAKE_PIVOT (0.2858, 0, 0.1429), 0 desplegada y 0.4 rot guardada
   * (softwareUpperRotationLimit); c1 hood y c2 tambor en el eje del shooter (−0.2762, 0, 0.415);
   * c3 hopper que entra 9 in al guardar la intake (HOPPER_STOWED_TRAVEL).
   */
  '10021.glb': {
    poses(m) {
      const axis: Vec3 = [-0.2762, 0, 0.415];
      const stow = 1 - m.intake;
      return [
        pose([0.2858, 0, 0.1429], rot(0, -stow * 0.4 * 2 * Math.PI, 0)),
        pose(axis, rot(0, lerp(0, 62, m.hood) * DEG, 0)),
        pose(axis, rot(0, m.spin, 0)),
        pose([inch(-9) * stow, 0, 0]),
      ];
    },
    hopper: [{ min: [-0.3, -0.28, 0.15], max: [0.1, 0.28, 0.52], maxDeployed: [0.58, 0.28, 0.52] }],
  },

  /**
   * 5024 (Raider Robotics) — MechanismVisualizer: c0 intake en (0.29, 0, 0.21) con pitch
   * (brazo − 105°) (brazo 0° al arrancar: guardada), c1 climber, c2 turret en (−0.15, 0.16,
   * 0.37) con yaw −ángulo, c3 spindexer, c4 feeder, c5–c8 módulos del swerve.
   */
  '5024.glb': {
    poses(m) {
      const wheel = (x: number, y: number) => pose([x, y, 0.02]);
      return [
        pose([0.29, 0, 0.21], rot(0, lerp(-105, 0, m.intake) * DEG, 0)),
        pose([-0.29, -0.05, 0.11 + m.climb * 0.25]),
        pose([-0.15, 0.16, 0.37], rot(0, 0, m.turret)),
        pose([0.09, 0, 0.055], rot(0, 0, m.spin)),
        pose([-0.09, 0, 0.275]),
        wheel(0.27, 0.27),
        wheel(-0.27, 0.27),
        wheel(-0.27, -0.27),
        wheel(0.27, -0.27),
      ];
    },
    hopper: [{ min: [-0.28, -0.28, 0.1], max: [0.25, 0.28, 0.42] }],
  },

  /**
   * 8324 (MECO) "Remy" — sin código de poses: deducido del CAD. c0 rodillos del shooter que giran
   * y c1 hood (0°–28°) sobre el eje del shooter; c2 intake que sale 0.3 m (baja 7.5°), c3 y c4
   * piezas del hopper extensible que salen con ella; c5 climber que gira atrás.
   */
  '8324.glb': {
    poses(m) {
      const so: Vec3 = [-0.10331, 0, 0.423];
      const e = lerp(0, 0.3, m.intake);
      const ex = e * Math.cos(7.5 * DEG);
      return [
        rotateAround(IDENTITY, so, rot(0, m.spin * 4, 0)),
        rotateAround(IDENTITY, so, rot(0, -lerp(0, 28, m.hood) * DEG, 0)),
        pose([ex, 0, -e * Math.sin(7.5 * DEG)]),
        pose([ex, 0, 0]),
        pose([ex, 0, 0]),
        rotateAround(IDENTITY, [-0.29, 0, 0.512], rot(0, -m.climb * 1.6, 0)),
      ];
    },
    hopper: [{ min: [-0.33, -0.34, 0.18], max: [0, 0.34, 0.6], maxDeployed: [0.29, 0.34, 0.6] }],
  },

  /**
   * 339 (Kilroy Robotics) "Kilroy26" — Actuator, Roller, Serializer, Kicker, Flywheel y Drive
   * (Components/…): c0 hopper que sale −sin(θ)·0.311658 m, c1 paredes de la intake con pitch −θ
   * en (−0.193, 0, 0.2) (θ 0° guardada – 115° desplegada: ActuatorConstants.kExtendedDegs),
   * c2 rodillo en la punta del brazo, c3–c4 serializer, c5–c7 kickers, c8 flywheel (giran) y
   * c9–c12 ruedas del swerve (±10.875 in). La intake está atrás en el CAD: el modelo se gira 180°.
   */
  '339.glb': {
    yawDeg: 180,
    poses(m) {
      const th = lerp(0, 115, m.intake) * DEG;
      const walls: Vec3 = [-0.193, 0, 0.2];
      const spinAt = (t: Vec3, k = 1) => pose(t, rot(0, m.spin * k, 0));
      const wheel = (x: number, y: number) => pose([inch(x), inch(y), 0.09]);
      return [
        pose([-Math.sin(th) * 0.311658, 0, 0]),
        pose(walls, rot(0, -th, 0)),
        pose([walls[0] + 0.031 * Math.cos(th) - 0.393 * Math.sin(th), 0, walls[2] + 0.031 * Math.sin(th) + 0.393 * Math.cos(th)], rot(0, -th, 0)),
        spinAt([0.0545, 0, 0.111]),
        spinAt([0.08, 0, 0.297], -1),
        spinAt([0.1195, 0, 0.1295]),
        spinAt([0.207, 0, 0.181]),
        spinAt([0.2505, 0, 0.2735]),
        spinAt([0.2657602, 0, 0.3731006], 3),
        wheel(10.875, 10.875),
        wheel(10.875, -10.875),
        wheel(-10.875, 10.875),
        wheel(-10.875, -10.875),
      ];
    },
    hopper: [{ min: [-0.3, -0.28, 0.12], max: [0.05, 0.28, 0.52], minDeployed: [-0.6, -0.28, 0.12] }],
  },

  /**
   * 1757 (Westwood Robotics) "Orion" — robotmechanism.py RobotMechanism.getPoses: c0 turret en
   * kTurretLocation (−0.102, 0.178, 0.368) con yaw turret − π/2, c1 pared del hopper que sale
   * 0.298 m con la intake desplegada, c2 intake con pitch −pivote en (0.252, 0, 0.184)
   * (0° desplegada – 125.5° guardada).
   */
  '1757.glb': {
    poses(m) {
      const pivot = lerp(125.5, 0, m.intake) * DEG;
      return [
        pose([-0.102, 0.178, 0.368], rot(0, 0, m.turret - Math.PI / 2)),
        pose([lerp(0, 0.298, m.intake), 0, 0]),
        pose([0.252, 0, 0.184], rot(0, -pivot, 0)),
      ];
    },
    hopper: [{ min: [-0.28, -0.28, 0.12], max: [0.25, 0.28, 0.55], maxDeployed: [0.5, 0.28, 0.55] }],
  },
};
