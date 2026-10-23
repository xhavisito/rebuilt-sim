/**
 * Predicción del lado del cliente (modo en línea): el robot propio responde al instante a los
 * controles en vez de esperar la ida y vuelta al host.
 *
 * El host sigue mandando (es el único que simula). El cliente integra su chasis con el mismo
 * modelo de manejo que RobotPhysics.drive (velocidad objetivo con aceleración y giro limitados) y
 * lo reconcilia con cada estado del host: el host va `tau` s atrás (lo que tardan los controles en
 * llegarle más lo que tarda su estado en volver), así que el objetivo es la pose del host más lo
 * que el cliente predijo que se movió en esos `tau` s. El error se corrige poco a poco (no se nota)
 * y, si es grande (un choque, un PIN), de golpe.
 */

export interface DriveModel {
  /** Velocidad máxima (m/s). */
  maxSpeed: number;
  /** Aceleración máxima (m/s²): la del robot, limitada por la tracción. */
  aMax: number;
  /** Giro máximo (rad/s) y su aceleración (rad/s²). */
  maxOmega: number;
  alpha: number;
  /** Tank/west coast: solo avanza sobre su eje. */
  tank: boolean;
}

export interface Pose2 {
  x: number;
  z: number;
  /** Rumbo (rad, como RobotPhysics.heading). */
  h: number;
}

export interface DriveCmd {
  vx: number;
  vz: number;
  omega: number;
}

export const PREDICT = {
  /** Corrección continua hacia el host (1/s): ~95 % del error en medio segundo. */
  rate: 6,
  /** Error a partir del cual se salta directo a la pose del host (m, rad). */
  snapDist: 1.5,
  snapAngle: 1.2,
  /** Error que ya cuenta como "algo lo detuvo" (pared, otro robot): deja de empujar hacia allá (m). */
  blocked: 0.2,
  /** Historia de lo predicho que se guarda (s). */
  history: 1.5,
  /** Sin estados del host en este tiempo (s), está trabado: se deja de predecir. */
  maxSilence: 0.35,
  /** Retraso máximo que se compensa (s): con más, mejor se ve el robot como lo dibuja el host. */
  maxLag: 0.6,
};

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Modelo de manejo de un robot (mismas cuentas que RobotPhysics.drive, en suelo plano). */
export function driveModel(spec: { maxSpeed: number; maxAccel: number; traction: number; maxOmega: number; drivetrain: string }, halfL: number, halfW: number): DriveModel {
  const aMax = Math.max(0, Math.min(spec.maxAccel, spec.traction * 9.81));
  const tank = spec.drivetrain === 'tank';
  return { maxSpeed: spec.maxSpeed, aMax, maxOmega: spec.maxOmega, alpha: (aMax / Math.hypot(halfL, halfW)) * (tank ? 1.2 : 1.6), tank };
}

export class DrivePredictor {
  x = 0;
  z = 0;
  h = 0;
  vx = 0;
  vz = 0;
  w = 0;
  private time = 0;
  /** Lo que se movió en cada paso: [t, dx, dz, dh]. */
  private hist: number[][] = [];

  constructor(public model: DriveModel) {}

  reset(p: Pose2, vx = 0, vz = 0, w = 0): void {
    this.x = p.x;
    this.z = p.z;
    this.h = p.h;
    this.vx = vx;
    this.vz = vz;
    this.w = w;
    this.hist.length = 0;
  }

  /** Avanza `dt` con el mando de manejo (marco del campo). */
  step(cmd: DriveCmd, dt: number): void {
    const m = this.model;
    let tx = cmd.vx;
    let tz = cmd.vz;
    const mag = Math.hypot(tx, tz);
    if (mag > m.maxSpeed) {
      tx *= m.maxSpeed / mag;
      tz *= m.maxSpeed / mag;
    }
    if (m.tank) {
      const fx = Math.cos(this.h);
      const fz = -Math.sin(this.h);
      const along = tx * fx + tz * fz;
      tx = along * fx;
      tz = along * fz;
    }
    let dvx = tx - this.vx;
    let dvz = tz - this.vz;
    const dv = Math.hypot(dvx, dvz);
    const lim = m.aMax * dt;
    if (dv > lim) {
      dvx *= lim / dv;
      dvz *= lim / dv;
    }
    this.vx += dvx;
    this.vz += dvz;
    const omegaT = Math.max(-m.maxOmega, Math.min(m.maxOmega, cmd.omega));
    const wl = m.alpha * dt;
    this.w += Math.max(-wl, Math.min(wl, omegaT - this.w));
    const dx = this.vx * dt;
    const dz = this.vz * dt;
    const dh = this.w * dt;
    this.x += dx;
    this.z += dz;
    this.h = wrap(this.h + dh);
    this.time += dt;
    this.hist.push([this.time, dx, dz, dh]);
    while (this.hist.length && this.hist[0][0] < this.time - PREDICT.history) this.hist.shift();
  }

  /** Lo que se predijo que se movió en los últimos `tau` s. */
  recent(tau: number): { dx: number; dz: number; dh: number } {
    let dx = 0;
    let dz = 0;
    let dh = 0;
    const from = this.time - tau;
    for (let i = this.hist.length - 1; i >= 0 && this.hist[i][0] > from; i--) {
      dx += this.hist[i][1];
      dz += this.hist[i][2];
      dh += this.hist[i][3];
    }
    return { dx, dz, dh };
  }

  /**
   * Reconcilia con la pose del host, que va `tau` s atrás. Devuelve el error (m) antes de corregir.
   */
  correct(host: Pose2, tau: number, dt: number): number {
    const d = this.recent(tau);
    const ex = host.x + d.dx - this.x;
    const ez = host.z + d.dz - this.z;
    const eh = wrap(host.h + d.dh - this.h);
    const err = Math.hypot(ex, ez);
    if (err > PREDICT.snapDist || Math.abs(eh) > PREDICT.snapAngle) {
      // algo pasó en el host que aquí no se ve (choque fuerte, PIN): a su pose, sin historia
      this.x = host.x + d.dx;
      this.z = host.z + d.dz;
      this.h = wrap(host.h + d.dh);
      this.hist.length = 0;
      return err;
    }
    const k = 1 - Math.exp(-PREDICT.rate * dt);
    this.x += ex * k;
    this.z += ez * k;
    this.h = wrap(this.h + eh * k);
    // el host dice que no avanzó hacia allá (pared, otro robot): deja de empujar en esa dirección,
    // más entre más grande el error (uno chico es solo el jitter de la red)
    if (err > PREDICT.blocked) {
      const ux = ex / err;
      const uz = ez / err;
      const into = this.vx * ux + this.vz * uz;
      const f = Math.min(1, (err - PREDICT.blocked) / PREDICT.blocked);
      if (into < 0) {
        this.vx -= into * ux * f;
        this.vz -= into * uz * f;
      }
    }
    return err;
  }
}
