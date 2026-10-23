/**
 * Cuerpo físico de un robot.
 *
 * Colisionadores: 4 esferas-rueda SIN fricción (la tracción la decide nuestro controlador; tocan
 * el campo y el FUEL que quede debajo, pero solo el piso da tracción), caja de BUMPERS (zona 2.5–5.75 in, R405)
 * y caja de la superestructura hasta la altura del robot (decide si cabe bajo el TRENCH
 * de 22.25 in). Un FUEL (5.91 in) tiene su centro apenas 0.45 in arriba del borde inferior
 * del BUMPER: con una inclinación mínima se metería abajo y levantaría al robot. Por eso:
 *  - un "faldón" que solo toca FUEL baja la cara vertical hasta 0.5 in del piso (en un robot
 *    real ese hueco lo cierran el chasis y la espuma de la pelota, que se comprime), y
 *  - sin grupo de dominancia: en Rapier 0.21 el cuerpo dominante cuenta como estático (velocidad
 *    cero) en el contacto, así que el BUMPER no empujaba al FUEL: lo atravesaba y la corrección de
 *    penetración lo escupía volando. 0.2 kg de espuma contra 55 kg casi no mueven al robot; la
 *    resistencia de empujar FUEL la modela `plow`.
 *  - el BUMPER (tela sobre espuma) absorbe el golpe: restitución 0.2 con la regla Min, así que el
 *    FUEL sale apenas un poco más rápido que el robot que lo empuja.
 *
 * Manejo: controlador de velocidad cuyo cambio de velocidad por paso está limitado por
 * min(aceleración del motor, μ·g)·(fracción de ruedas en el piso). Con eso los empujones
 * entre robots los decide la tracción y la masa, hay derrape al girar rápido y las rampas
 * de 15° del BUMP frenan e inclinan al robot por pura física.
 */
import { BUMPER_ZONE_LOW, inch } from '../config/field';
import type { RobotSpec } from '../config/robots';
import { GROUPS, RAPIER, type PhysicsWorld } from './PhysicsWorld';

export interface DriveCommand {
  /** Velocidad deseada en el marco del campo (m/s). */
  vx: number;
  vz: number;
  /** Velocidad angular deseada (rad/s, + = antihorario visto desde arriba). */
  omega: number;
}

const WHEEL_R = inch(2.0);
const BUMPER_TOP = inch(7.0);
/** Restitución FUEL–robot (BUMPER de tela y espuma; superestructura). */
const BUMPER_E = 0.2;

export class RobotPhysics {
  readonly body: RAPIER.RigidBody;
  readonly bumper: RAPIER.Collider;
  readonly frame: RAPIER.Collider;
  readonly wheels: RAPIER.Collider[] = [];
  /** Mitades (m) del marco y de la huella con BUMPERS. */
  readonly halfL: number;
  readonly halfW: number;
  readonly outerL: number;
  readonly outerW: number;
  readonly height: number;
  /** Fracción de ruedas con tracción (0–1). */
  grounded = 1;
  /** FUEL que el robot va empujando con los BUMPERS (ver `plowLoad`); lo frena. */
  plow = 0;
  /** Cara frontal de la intake desplegada (x local, m): donde el rodillo toca el FUEL. */
  readonly intakeFront: number;
  readonly intakeHalfW: number;
  /** Rodillo de la intake (solo FUEL), activo solo con la intake desplegada. */
  private intakeCol: RAPIER.Collider;
  /** Intake (y hopper que se extiende) fuera del perímetro: sólidos contra campo y robots. */
  readonly extension: RAPIER.Collider[] = [];
  /** Último mando aplicado (para detectar PIN: quiere moverse pero no puede). */
  lastCmd: DriveCommand = { vx: 0, vz: 0, omega: 0 };
  /** Interpolación: pose anterior y actual. */
  prevPos = { x: 0, y: 0, z: 0 };
  prevRot = { x: 0, y: 0, z: 0, w: 1 };
  curPos = { x: 0, y: 0, z: 0 };
  curRot = { x: 0, y: 0, z: 0, w: 1 };
  private wheelLocal: Array<[number, number]> = [];
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private kinematic = false;

  constructor(
    private pw: PhysicsWorld,
    readonly spec: RobotSpec,
    readonly index: number,
    x: number,
    z: number,
    heading: number,
  ) {
    const w = pw.world;
    this.halfL = inch(spec.lengthIn) / 2;
    this.halfW = inch(spec.widthIn) / 2;
    const bump = inch(spec.bumperIn);
    this.outerL = this.halfL + bump;
    this.outerW = this.halfW + bump;
    this.height = inch(spec.heightIn);
    const q = yawQuat(heading);
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, 0.002, z)
        .setRotation(q)
        .setLinearDamping(0.2)
        .setAngularDamping(1.5)
        .setCanSleep(false),
    );
    this.body.userData = { robot: index };
    const wheelMass = 0.6;
    const superMass = spec.massKg * 0.22;
    const bumperMass = spec.massKg - 4 * wheelMass - superMass;
    // BUMPERS: caja que llena la BUMPER ZONE (R405) y un poco más. Redondeo mínimo: un
    // borde inferior redondeado actuaría como rampa y el robot se treparía al FUEL.
    const rr = 0.004;
    const by0 = BUMPER_ZONE_LOW;
    const bhy = (BUMPER_TOP - by0) / 2;
    this.bumper = w.createCollider(
      RAPIER.ColliderDesc.roundCuboid(this.outerL - rr, bhy - rr, this.outerW - rr, rr)
        .setTranslation(0, by0 + bhy, 0)
        .setMass(bumperMass)
        .setFriction(0.4)
        .setRestitution(BUMPER_E)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(GROUPS.robot)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(400),
      this.body,
    );
    pw.tag(this.bumper, { kind: 'robot', robot: index, part: 'bumper' });
    const skirtY0 = inch(0.5);
    const skirt = w.createCollider(
      RAPIER.ColliderDesc.cuboid(this.outerL, (by0 + 0.01 - skirtY0) / 2, this.outerW)
        .setTranslation(0, (skirtY0 + by0 + 0.01) / 2, 0)
        .setMass(0)
        .setFriction(0.4)
        .setRestitution(BUMPER_E)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(GROUPS.skirt),
      this.body,
    );
    pw.tag(skirt, { kind: 'robot', robot: index, part: 'bumper' });
    // Intake "over the bumper": el rodillo (frente a 0.25 in de la extensión R105) empuja el
    // FUEL ahí mismo, donde se ve; lo que toca se captura (Mechanisms.runIntake).
    this.intakeFront = this.halfL + inch(spec.intake.extensionIn) - inch(0.25);
    this.intakeHalfW = Math.min(inch(spec.intake.widthIn), 2 * this.halfW) / 2;
    const iLen = Math.max(0.02, this.intakeFront - this.outerL + 0.02);
    this.intakeCol = w.createCollider(
      RAPIER.ColliderDesc.cuboid(iLen / 2, (inch(5) - skirtY0) / 2, this.intakeHalfW)
        .setTranslation(this.intakeFront - iLen / 2, (inch(5) + skirtY0) / 2, 0)
        .setMass(0)
        .setFriction(0.2)
        .setRestitution(0.05)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(GROUPS.skirt)
        .setEnabled(false),
      this.body,
    );
    pw.tag(this.intakeCol, { kind: 'robot', robot: index, part: 'bumper' });
    // Lo desplegado como sólido (R105: hasta 12 in fuera del perímetro): la intake, de la altura
    // de los BUMPERS hasta sus brazos sobre ellos, y el hopper que se extiende con ella. Sin esto
    // se atravesaban el TRENCH, las paredes y los otros robots con la intake abajo.
    const extBox = (x0: number, x1: number, y0: number, y1: number, hw: number) => {
      const c = w.createCollider(
        RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, hw)
          .setTranslation((x0 + x1) / 2, (y0 + y1) / 2, 0)
          .setMass(0)
          .setFriction(0.3)
          .setRestitution(0.1)
          .setCollisionGroups(GROUPS.extension)
          .setEnabled(false),
        this.body,
      );
      pw.tag(c, { kind: 'robot', robot: index, part: 'extension' });
      this.extension.push(c);
    };
    if (this.intakeFront > this.outerL + 0.01) extBox(this.outerL - 0.02, this.intakeFront, by0, inch(10), this.intakeHalfW);
    if (spec.deployedHopperIn) {
      const [fIn, topIn] = spec.deployedHopperIn;
      if (inch(fIn) > this.halfL) extBox(this.halfL * 0.9, inch(fIn), BUMPER_TOP, inch(topIn), this.halfW * 0.98);
    }
    // Superestructura dentro del perímetro (hasta la altura del robot), más lo que sobresalga
    // hacia el frente por encima de los BUMPERS (p. ej. el hopper de 971)
    const fy0 = BUMPER_TOP;
    const fhy = Math.max(0.02, (this.height - fy0) / 2);
    const fx0 = -this.halfL * 0.98;
    const fx1 = this.halfL * 0.98 + inch(spec.overhangIn ?? 0);
    this.frame = w.createCollider(
      RAPIER.ColliderDesc.cuboid((fx1 - fx0) / 2, fhy, this.halfW * 0.98)
        .setTranslation((fx0 + fx1) / 2, fy0 + fhy, 0)
        .setMass(superMass)
        .setFriction(0.3)
        .setRestitution(BUMPER_E)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(GROUPS.robot)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    pw.tag(this.frame, { kind: 'robot', robot: index, part: 'frame' });
    // Ruedas
    const ix = this.halfL - inch(3);
    const iz = this.halfW - inch(3);
    this.wheelLocal = [
      [ix, iz],
      [ix, -iz],
      [-ix, iz],
      [-ix, -iz],
    ];
    for (const [lx, lz] of this.wheelLocal) {
      const c = w.createCollider(
        RAPIER.ColliderDesc.ball(WHEEL_R)
          .setTranslation(lx, WHEEL_R, lz)
          .setMass(wheelMass)
          .setFriction(0)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setRestitution(0)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setCollisionGroups(GROUPS.wheel),
        this.body,
      );
      pw.tag(c, { kind: 'robot', robot: index, part: 'wheel' });
      this.wheels.push(c);
    }
    this.snapshot(true);
  }

  /** Rumbo (rad): adelante = (cos θ, −sin θ) en (x, z). */
  heading(): number {
    const r = this.body.rotation();
    const fx = 1 - 2 * (r.y * r.y + r.z * r.z);
    const fz = 2 * (r.x * r.z - r.w * r.y);
    return Math.atan2(-fz, fx);
  }

  /** Inclinación respecto a la vertical (rad). */
  tilt(): number {
    const r = this.body.rotation();
    // eje Y local en mundo: componente y
    const uy = 1 - 2 * (r.x * r.x + r.z * r.z);
    return Math.acos(Math.max(-1, Math.min(1, uy)));
  }

  position(): { x: number; y: number; z: number } {
    return this.body.translation();
  }

  velocity(): { x: number; y: number; z: number } {
    return this.body.linvel();
  }

  /** Transforma un punto local (x adelante, z a la derecha… del marco) a mundo (solo yaw). */
  localToWorld(lx: number, lz: number, h = this.heading()): { x: number; z: number } {
    const p = this.curPos;
    const c = Math.cos(h);
    const s = Math.sin(h);
    // eje local X → (c, −s); eje local Z → (s, c)
    return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
  }

  worldToLocal(x: number, z: number, h = this.heading()): { lx: number; lz: number } {
    const dx = x - this.curPos.x;
    const dz = z - this.curPos.z;
    const c = Math.cos(h);
    const s = Math.sin(h);
    return { lx: dx * c - dz * s, lz: dx * s + dz * c };
  }

  /** Aplica el mando de manejo (llamar antes de cada `world.step`). */
  drive(cmd: DriveCommand, dt: number): void {
    this.lastCmd = cmd;
    if (this.kinematic) return;
    this.senseGround();
    const s = this.spec;
    const b = this.body;
    const v = b.linvel();
    const h = this.heading();
    const fx = Math.cos(h);
    const fz = -Math.sin(h);
    let tx = cmd.vx;
    let tz = cmd.vz;
    const mag = Math.hypot(tx, tz);
    // Empujar un montón de FUEL cuesta un poco: las pelotas ruedan y se arrastran sobre la
    // alfombra, pero 0.2 kg de espuma casi no frenan a un robot de 55 kg. Supuesto 13: −1 % de
    // velocidad por FUEL empujado, a lo más −15 %.
    const vMax = s.maxSpeed * Math.max(0.85, 1 - 0.01 * this.plow);
    if (mag > vMax) {
      tx *= vMax / mag;
      tz *= vMax / mag;
    }
    if (s.drivetrain === 'tank') {
      // Tank/west coast: solo avanza sobre su eje; la tracción resiste el deslizamiento lateral.
      const along = tx * fx + tz * fz;
      tx = along * fx;
      tz = along * fz;
    }
    // Tracción efectiva: solo las ruedas apoyadas empujan
    const mu = s.traction * this.grounded;
    const aMax = Math.max(0, Math.min(s.maxAccel, mu * 9.81));
    let dvx = tx - v.x;
    let dvz = tz - v.z;
    const dv = Math.hypot(dvx, dvz);
    // Curva par-velocidad del motor: al acelerar, el par disponible cae con la velocidad (a tope
    // queda ~45 %), así que arranca fuerte y llega a la velocidad máxima en ~0.6 s en vez de
    // pegarle de golpe. Frenar o cambiar de dirección (Δv contra la velocidad) solo lo limita la
    // tracción: el swerve frena en seco hasta lo que aguanten las ruedas.
    const speed = Math.hypot(v.x, v.z);
    const along = dv > 1e-5 && speed > 1e-3 ? (dvx * v.x + dvz * v.z) / (dv * speed) : 0;
    const motor = 1 - 0.55 * Math.min(1, speed / Math.max(0.1, s.maxSpeed)) * Math.max(0, along);
    const lim = (along > 0 ? aMax * motor : Math.max(0, Math.min(mu * 9.81, s.maxAccel * 1.3))) * dt;
    if (dv > lim) {
      dvx *= lim / dv;
      dvz *= lim / dv;
    }
    const m = b.mass();
    if (dv > 1e-5) b.applyImpulse({ x: dvx * m, y: 0, z: dvz * m }, true);
    // Giro: aceleración angular limitada por la tracción en las ruedas
    const w = b.angvel();
    const omegaT = Math.max(-s.maxOmega, Math.min(s.maxOmega, cmd.omega));
    const rad = Math.hypot(this.halfL, this.halfW);
    const alpha = (aMax / rad) * (s.drivetrain === 'tank' ? 1.2 : 1.6);
    let dw = omegaT - w.y;
    const wl = alpha * dt;
    if (dw > wl) dw = wl;
    else if (dw < -wl) dw = -wl;
    if (Math.abs(dw) > 1e-5) b.setAngvel({ x: w.x, y: w.y + dw, z: w.z }, true);
    this.keepUpright(dt);
  }

  /**
   * El robot real tiene el centro de masa muy bajo (batería, motores y BUMPERS) y aterriza plano
   * al pasar el BUMP a toda velocidad; la caja simulada, en cambio, podía voltearse al caer
   * girando. Más allá de 20° de inclinación (la rampa del BUMP es de 15°: no se toca), se frena
   * el giro de cabeceo/alabeo y un par lo regresa hacia la vertical.
   */
  private keepUpright(dt: number): void {
    const LIMIT = (20 * Math.PI) / 180;
    const r = this.body.rotation();
    // eje Y local en mundo
    const ux = 2 * (r.x * r.y - r.w * r.z);
    const uy = 1 - 2 * (r.x * r.x + r.z * r.z);
    const uz = 2 * (r.y * r.z + r.w * r.x);
    const tilt = Math.acos(Math.max(-1, Math.min(1, uy)));
    if (tilt <= LIMIT) return;
    // eje de giro que endereza: up_local × up_mundo = (−uz, 0, ux)
    const am = Math.hypot(uz, ux) || 1;
    const ax = -uz / am;
    const az = ux / am;
    const w = this.body.angvel();
    const damp = Math.max(0, 1 - 10 * dt);
    const k = 40 * (tilt - LIMIT) * dt;
    this.body.setAngvel({ x: w.x * damp + ax * k, y: w.y, z: w.z * damp + az * k }, true);
  }

  /** Raycast bajo cada rueda: ¿toca piso? (solo campo: las ruedas no tocan el FUEL) */
  private senseGround(): void {
    let g = 0;
    const p = this.body.translation();
    const r = this.body.rotation();
    for (const [lx, lz] of this.wheelLocal) {
      const wp = rotate(r, lx, WHEEL_R, lz);
      this.ray.origin = { x: p.x + wp.x, y: p.y + wp.y, z: p.z + wp.z };
      if (this.pw.world.castRay(this.ray, WHEEL_R + 0.03, true, undefined, GROUPS.wheelRay, undefined, this.body)) g++;
    }
    this.grounded = g / 4;
  }

  /** Guarda la pose para interpolar el render. */
  snapshot(snap = false): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    if (snap) {
      this.prevPos = { ...t };
      this.prevRot = { x: r.x, y: r.y, z: r.z, w: r.w };
    } else {
      this.prevPos = this.curPos;
      this.prevRot = this.curRot;
    }
    this.curPos = { x: t.x, y: t.y, z: t.z };
    this.curRot = { x: r.x, y: r.y, z: r.z, w: r.w };
  }

  teleport(x: number, z: number, heading: number, y = 0.002): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation(yawQuat(heading), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.snapshot(true);
  }

  /** Activa/desactiva el rodillo físico de la intake (desplegada o guardada). */
  setIntakeDeployed(on: boolean): void {
    this.intakeDeployed = on;
    if (this.intakeCol.isEnabled() !== on) this.intakeCol.setEnabled(on);
  }

  intakeDeployed = false;

  /** Intake/hopper fuera del perímetro (sólidos) según el despliegue. */
  setExtended(on: boolean): void {
    this.extended = on;
    for (const c of this.extension) if (c.isEnabled() !== on) c.setEnabled(on);
  }

  extended = false;

  /**
   * Dirección horizontal (unitaria) para alejarse de lo sólido que toca: paredes, estructuras u
   * otros robots (no FUEL, alfombra ni BUMPS). null si no toca nada. La usa la IA para
   * desatorarse.
   */
  awayFromContacts(): { x: number; z: number } | null {
    const w = this.pw.world;
    let x = 0;
    let z = 0;
    for (const col of this.solids()) {
      w.contactPairsWith(col, (other) => {
        const tag = this.pw.tagOf(other.handle);
        if (!tag || tag.kind === 'fuel' || tag.kind === 'floor' || (tag.kind === 'field' && tag.part === 'bump')) return;
        if (tag.kind === 'robot' && tag.robot === this.index) return;
        w.contactPair(col, other, (man, flipped) => {
          if (man.numContacts() === 0) return;
          // la normal sale de la primera forma del par: si es la nuestra, alejarse es −normal
          const n = man.normal();
          const s = flipped ? 1 : -1;
          x += s * n.x;
          z += s * n.z;
        });
      });
    }
    const m = Math.hypot(x, z);
    return m > 1e-3 ? { x: x / m, z: z / m } : null;
  }

  /** Colisionadores que chocan con el campo y los robots (para el árbitro). */
  solids(): RAPIER.Collider[] {
    return this.extended ? [this.bumper, this.frame, ...this.extension] : [this.bumper, this.frame];
  }

  /** Cambia a cinemático (climb) o de vuelta a dinámico. */
  setKinematic(on: boolean): void {
    if (on === this.kinematic) return;
    this.kinematic = on;
    this.body.setBodyType(
      on ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic,
      true,
    );
  }

  isKinematic(): boolean {
    return this.kinematic;
  }

  /** Mueve el cuerpo cinemático (climb). */
  setKinematicPose(x: number, y: number, z: number, heading: number): void {
    this.body.setNextKinematicTranslation({ x, y, z });
    this.body.setNextKinematicRotation(yawQuat(heading));
  }
}

export function yawQuat(h: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) };
}

/** Rota el vector (x,y,z) por el cuaternión q. */
export function rotate(
  q: { x: number; y: number; z: number; w: number },
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number } {
  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}
