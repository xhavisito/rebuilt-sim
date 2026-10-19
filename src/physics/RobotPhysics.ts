/**
 * Cuerpo físico de un robot.
 *
 * Colisionadores: 4 esferas-rueda SIN fricción (la tracción la decide nuestro
 * controlador; solo tocan el campo, no el FUEL), caja de BUMPERS (zona 2.5–5.75 in, R405)
 * y caja de la superestructura hasta la altura del robot (decide si cabe bajo el TRENCH
 * de 22.25 in). Un FUEL (5.91 in) tiene su centro arriba del borde inferior del BUMPER,
 * así que la cara vertical lo empuja de lado: el robot lo arrastra, no se sube.
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
        .setRestitution(0.08)
        .setCollisionGroups(GROUPS.robot)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(400),
      this.body,
    );
    pw.tag(this.bumper, { kind: 'robot', robot: index, part: 'bumper' });
    // Superestructura dentro del perímetro (hasta la altura del robot)
    const fy0 = BUMPER_TOP;
    const fhy = Math.max(0.02, (this.height - fy0) / 2);
    this.frame = w.createCollider(
      RAPIER.ColliderDesc.cuboid(this.halfL * 0.98, fhy, this.halfW * 0.98)
        .setTranslation(0, fy0 + fhy, 0)
        .setMass(superMass)
        .setFriction(0.3)
        .setRestitution(0.1)
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
    // Empujar un montón de FUEL cuesta: las pelotas se atoran entre sí y se arrastran sobre la
    // alfombra. Supuesto 13: −3.5 % de velocidad por FUEL empujado, hasta 40 % de la máxima.
    const vMax = s.maxSpeed * Math.max(0.4, 1 - 0.035 * this.plow);
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
    const lim = aMax * dt;
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
  }

  /** Raycast bajo cada rueda: ¿toca piso? (solo campo: las ruedas no tocan el FUEL) */
  private senseGround(): void {
    let g = 0;
    const p = this.body.translation();
    const r = this.body.rotation();
    for (const [lx, lz] of this.wheelLocal) {
      const wp = rotate(r, lx, WHEEL_R, lz);
      this.ray.origin = { x: p.x + wp.x, y: p.y + wp.y, z: p.z + wp.z };
      if (this.pw.world.castRay(this.ray, WHEEL_R + 0.03, true, undefined, GROUPS.wheel, undefined, this.body)) g++;
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
