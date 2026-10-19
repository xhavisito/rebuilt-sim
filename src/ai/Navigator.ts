/**
 * Navegación para la IA y las rutinas de AUTO.
 * La línea HUB + BUMPS + TRENCHES de cada alianza divide el campo en 3 zonas; para pasar de
 * una a otra hay que cruzar por un BUMP (cualquier robot) o por debajo de un TRENCH
 * (solo robots ≤ 22.25 in). El planificador inserta esos carriles y la dirección se
 * corrige localmente para evitar robots y estructuras.
 */
import * as F from '../config/field';
import { fitsUnderTrench } from '../config/robots';
import type { Robot } from '../game/Robot';
import type { DriveCommand } from '../physics/RobotPhysics';

export interface Pt {
  x: number;
  z: number;
}

const BARRIERS = [F.HUB_CENTER_X_BLUE, -F.HUB_CENTER_X_BLUE];
const BUMP_LANES = [F.BUMP_CENTER_Z, -F.BUMP_CENTER_Z];
const TRENCH_LANES = [F.HALF_W - F.TRENCH_CLEAR_WIDTH / 2, -(F.HALF_W - F.TRENCH_CLEAR_WIDTH / 2)];
const CROSS_MARGIN = 1.15;

/** Zona: 0 = lado azul, 1 = NEUTRAL ZONE, 2 = lado rojo. */
export const zoneOf = (x: number): number => (x < BARRIERS[0] ? 0 : x > BARRIERS[1] ? 2 : 1);

/** Obstáculos estáticos aproximados como círculos (para la repulsión local). */
const OBSTACLES: Array<{ x: number; z: number; r: number }> = (() => {
  const out: Array<{ x: number; z: number; r: number }> = [];
  for (const a of ['red', 'blue'] as const) {
    const h = F.hubCenter(a);
    out.push({ x: h.x, z: h.z, r: F.HUB_SIZE * 0.62 });
    const tw = F.towerInfo(a);
    out.push({ x: tw.uprightX - tw.facing * 0.3, z: tw.cz, r: 0.75 });
    const postZ = (F.TRENCH_INNER_Z + (F.HALF_W - F.TRENCH_CLEAR_WIDTH)) / 2;
    for (const s of [-1, 1]) out.push({ x: h.x, z: s * postZ, r: 0.3 });
  }
  return out;
})();

export class Navigator {
  path: Pt[] = [];
  private goal: Pt | null = null;
  private stuckT = 0;
  private escapeT = 0;
  private escapeDir = { x: 0, z: 0 };

  constructor(private r: Robot) {}

  /** Planifica hacia (x, z) insertando cruces de BUMP/TRENCH si hace falta. */
  plan(target: Pt): void {
    const p = this.r.phys.curPos;
    if (this.goal && Math.hypot(this.goal.x - target.x, this.goal.z - target.z) < 0.15 && this.path.length) return;
    this.goal = { ...target };
    const path: Pt[] = [];
    let zx = zoneOf(p.x);
    const zt = zoneOf(target.x);
    let cz = p.z;
    const lanes = fitsUnderTrench(this.r.spec) ? [...BUMP_LANES, ...TRENCH_LANES] : BUMP_LANES;
    while (zx !== zt) {
      const dir = zt > zx ? 1 : -1;
      const bx = BARRIERS[dir > 0 ? zx : zx - 1];
      let best = lanes[0];
      let bestC = Infinity;
      for (const l of lanes) {
        const c = Math.abs(cz - l) + Math.abs(l - target.z) + (TRENCH_LANES.includes(l) ? -0.4 : 0.3);
        if (c < bestC) {
          bestC = c;
          best = l;
        }
      }
      path.push({ x: bx - dir * CROSS_MARGIN, z: best }, { x: bx + dir * CROSS_MARGIN, z: best });
      cz = best;
      zx += dir;
    }
    path.push({ ...target });
    this.path = path;
  }

  clear(): void {
    this.path = [];
    this.goal = null;
  }

  get remaining(): number {
    let d = 0;
    let prev = this.r.phys.curPos as Pt;
    for (const q of this.path) {
      d += Math.hypot(q.x - prev.x, q.z - prev.z);
      prev = q;
    }
    return d;
  }

  /**
   * Sigue la ruta. Devuelve el mando y si llegó al objetivo final.
   * @param heading rumbo deseado (null = mirar hacia donde avanza, útil para la intake)
   */
  follow(
    dt: number,
    others: Robot[],
    opts: { speed: number; heading: number | null; tol?: number; avoidRobots?: boolean },
  ): { cmd: DriveCommand; arrived: boolean } {
    const r = this.r;
    const p = r.phys.curPos;
    const tol = opts.tol ?? 0.18;
    while (this.path.length > 1 && Math.hypot(this.path[0].x - p.x, this.path[0].z - p.z) < 0.4) this.path.shift();
    const wp = this.path[0];
    if (!wp) return { cmd: this.turnOnly(opts.heading), arrived: true };
    const dx = wp.x - p.x;
    const dz = wp.z - p.z;
    const d = Math.hypot(dx, dz);
    const final = this.path.length === 1;
    if (final && d < tol) {
      const cmd = this.turnOnly(opts.heading);
      return { cmd, arrived: Math.abs(cmd.omega) < 0.4 };
    }
    let vmax = r.spec.maxSpeed * opts.speed;
    // Más lento sobre el BUMP y al llegar
    if (BARRIERS.some((bx) => Math.abs(p.x - bx) < 1.0) && BUMP_LANES.some((l) => Math.abs(p.z - l) < 1.0)) vmax *= 0.7;
    const v = final ? Math.min(vmax, 0.4 + 2.2 * d) : vmax;
    let vx = (dx / d) * v;
    let vz = (dz / d) * v;
    // Repulsión local (robots y estructuras)
    const avoid = (ox: number, oz: number, rad: number, k: number) => {
      const ax = p.x - ox;
      const az = p.z - oz;
      const dist = Math.hypot(ax, az);
      const clear = dist - rad;
      if (clear < 0.9 && dist > 1e-3) {
        const f = (k * (0.9 - Math.max(0.05, clear))) / 0.9;
        // componente lateral para rodear en vez de frenar
        const side = Math.sign(ax * (dz / d) - az * (dx / d)) || 1;
        vx += (ax / dist) * f + side * (-dz / d) * f * 0.6;
        vz += (az / dist) * f + side * (dx / d) * f * 0.6;
      }
    };
    const crossing = BARRIERS.some((bx) => Math.abs(p.x - bx) < CROSS_MARGIN + 0.2);
    if (!crossing) for (const o of OBSTACLES) avoid(o.x, o.z, o.r + r.phys.outerW, 2.2);
    if (opts.avoidRobots !== false)
      for (const o of others) if (o !== r) avoid(o.phys.curPos.x, o.phys.curPos.z, o.phys.outerW + r.phys.outerW, 1.6);
    const vm = Math.hypot(vx, vz);
    if (vm > vmax) {
      vx *= vmax / vm;
      vz *= vmax / vm;
    }
    // Atorado: retrocede y se desliza de lado un momento
    const real = r.phys.velocity();
    if (Math.hypot(vx, vz) > 1 && Math.hypot(real.x, real.z) < 0.15) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 1.3) {
      this.stuckT = 0;
      this.escapeT = 0.8;
      const s = Math.random() < 0.5 ? -1 : 1;
      this.escapeDir = { x: (-dx / d) * 0.6 + s * (-dz / d), z: (-dz / d) * 0.6 + s * (dx / d) };
    }
    if (this.escapeT > 0) {
      this.escapeT -= dt;
      vx = this.escapeDir.x * vmax * 0.6;
      vz = this.escapeDir.z * vmax * 0.6;
    }
    // Rumbo: el pedido, o hacia donde avanza (tank siempre hacia donde avanza)
    let want = opts.heading;
    if (want === null || r.spec.drivetrain === 'tank') want = Math.hypot(vx, vz) > 0.3 ? Math.atan2(-vz, vx) : r.phys.heading();
    if (r.spec.drivetrain === 'tank') {
      const h = r.phys.heading();
      const err = Math.abs(Math.atan2(Math.sin(want - h), Math.cos(want - h)));
      if (err > 0.6) {
        vx *= 0.15;
        vz *= 0.15;
      }
    }
    return { cmd: { vx, vz, omega: this.omegaTo(want) }, arrived: false };
  }

  private turnOnly(heading: number | null): DriveCommand {
    return { vx: 0, vz: 0, omega: heading === null ? 0 : this.omegaTo(heading) };
  }

  omegaTo(want: number): number {
    const h = this.r.phys.heading();
    const d = Math.atan2(Math.sin(want - h), Math.cos(want - h));
    return Math.max(-this.r.spec.maxOmega, Math.min(this.r.spec.maxOmega, d * 6));
  }
}
