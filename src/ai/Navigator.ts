/**
 * Navegación para la IA y las rutinas de AUTO.
 * La línea HUB + BUMPS + TRENCHES de cada alianza divide el campo en 3 zonas; para pasar de
 * una a otra hay que cruzar por un BUMP (cualquier robot) o por debajo de un TRENCH
 * (solo robots ≤ 22.25 in). El planificador inserta esos carriles y la dirección se
 * corrige localmente para evitar robots y estructuras.
 */
import * as F from '../config/field';
import { fitsUnderTrench } from '../config/robots';
import type { Alliance } from '../core/types';
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

/**
 * TOWER detrás de cuya línea de UPRIGHTS está (x, z) (o hasta `front` delante), a lo ancho de la
 * TOWER más `extra`; null si ninguna. Entre la TOWER, la pared y la base de la DRIVER STATION el
 * robot se mete por una pelota y se acuña; adentro (entre UPRIGHTS y pared) el hueco entre
 * UPRIGHTS es más angosto que un robot: se sale por un costado.
 */
export function behindTower(x: number, z: number, extra = 0, front = 0): Alliance | null {
  for (const a of ['red', 'blue'] as const) {
    const tw = F.towerInfo(a);
    if ((x - tw.uprightX) * tw.facing < front && Math.abs(z - tw.cz) < F.TOWER_WIDTH / 2 + extra) return a;
  }
  return null;
}

export class Navigator {
  path: Pt[] = [];
  private goal: Pt | null = null;
  private stuckT = 0;
  private escapeT = 0;
  private escapeDir = { x: 0, z: 0 };
  /** Veces que tuvo que desatorarse (la IA cambia de objetivo si se repite). */
  escapes = 0;
  /** Mando anterior (suavizado: un piloto no cambia de dirección de golpe en cada cuadro). */
  private sv = { x: 0, z: 0 };
  private sw = 0;

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
   * Sigue la ruta. Devuelve el mando (suavizado) y si llegó al objetivo final.
   * @param heading rumbo deseado: número, null = mirar hacia donde avanza (intake al frente),
   *   'keep' = conservar el rumbo actual (robots con turret: el chasis no necesita girar)
   */
  follow(
    dt: number,
    others: Robot[],
    opts: { speed: number; heading: number | null | 'keep'; tol?: number; avoidRobots?: boolean },
  ): { cmd: DriveCommand; arrived: boolean } {
    const out = this.followRaw(dt, others, opts);
    // Suavizado: velocidad con constante de ~0.15 s y giro con ~0.12 s
    const kv = Math.min(1, dt * 7);
    const kw = Math.min(1, dt * 8);
    this.sv.x += (out.cmd.vx - this.sv.x) * kv;
    this.sv.z += (out.cmd.vz - this.sv.z) * kv;
    this.sw += (out.cmd.omega - this.sw) * kw;
    return { cmd: { vx: this.sv.x, vz: this.sv.z, omega: this.sw }, arrived: out.arrived };
  }

  private followRaw(
    dt: number,
    others: Robot[],
    opts: { speed: number; heading: number | null | 'keep'; tol?: number; avoidRobots?: boolean },
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
    // Más lento sobre el BUMP (y desde antes de llegar: a toda velocidad sale volando) y al llegar
    if (BARRIERS.some((bx) => Math.abs(p.x - bx) < 1.7) && BUMP_LANES.some((l) => Math.abs(p.z - l) < 1.1)) vmax = Math.min(vmax, 2.6);
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
    const trapped = behindTower(p.x, p.z, r.phys.outerW);
    if (trapped) {
      // Atrás de la TOWER: sale de lado (a lo largo de la pared), a medio camino entre la pared y
      // los UPRIGHTS (la repulsión circular de la TOWER lo pegaría a la pared)
      const tw = F.towerInfo(trapped);
      vx = Math.max(-1, Math.min(1, ((tw.cx + tw.uprightX) / 2 - p.x) * 2));
      vz = (Math.sign(p.z - tw.cz) || 1) * vmax * 0.6;
    } else if (!crossing) for (const o of OBSTACLES) avoid(o.x, o.z, o.r + r.phys.outerW, 2.2);
    if (opts.avoidRobots !== false)
      for (const o of others) if (o !== r) avoid(o.phys.curPos.x, o.phys.curPos.z, o.phys.outerW + r.phys.outerW, 1.6);
    const vm = Math.hypot(vx, vz);
    if (vm > vmax) {
      vx *= vmax / vm;
      vz *= vmax / vm;
    }
    // Atorado (contra una pared, un poste o con la intake desplegada metida en una esquina):
    // se aleja en sentido contrario a donde empujaba, con un poco de lado y SIN girar (al girar,
    // la intake barre contra la pared y lo vuelve a trabar)
    // TRENCH (50.34 in de ancho): `trenchX` = línea del HUB cuyo TRENCH está cerca y `underTrench`
    // = el robot ya está debajo. Ahí dentro, en diagonal, no hay espacio para girar.
    const inLane = r.spec.drivetrain !== 'tank' && Math.abs(p.z) > F.TRENCH_INNER_Z - 0.25;
    const trenchX = inLane ? BARRIERS.find((bx) => Math.abs(p.x - bx) < CROSS_MARGIN + 0.3) : undefined;
    const underTrench = trenchX !== undefined && Math.abs(p.x - trenchX) < F.TRENCH_DEPTH / 2 + r.phys.outerL;
    const real = r.phys.velocity();
    const vm2 = Math.hypot(vx, vz);
    if (this.escapeT <= 0 && vm2 > 0.6 && Math.hypot(real.x, real.z) < 0.15) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 1.0) {
      this.stuckT = 0;
      this.escapeT = 0.9;
      this.escapes++;
      const s = Math.random() < 0.5 ? -1 : 1;
      // lejos de lo que toca (normal de los contactos); si no toca nada, al revés de donde iba.
      // Acuñado bajo el TRENCH: derecho hacia afuera, por donde entró (de lado choca otra vez).
      const b = underTrench ? { x: Math.sign(p.x - trenchX) || 1, z: 0 } : (r.phys.awayFromContacts() ?? { x: -vx / vm2, z: -vz / vm2 });
      const ex = b.x * 0.85 - s * b.z * 0.5;
      const ez = b.z * 0.85 + s * b.x * 0.5;
      const em = Math.hypot(ex, ez);
      this.escapeDir = { x: ex / em, z: ez / em };
    }
    if (this.escapeT > 0) {
      this.escapeT -= dt;
      const ev = Math.max(1.2, vmax * 0.6);
      return { cmd: { vx: this.escapeDir.x * ev, vz: this.escapeDir.z * ev, omega: 0 }, arrived: false };
    }
    // Rumbo: el pedido, el actual ('keep') o hacia donde avanza (tank siempre hacia donde avanza)
    let want = opts.heading === 'keep' ? r.phys.heading() : opts.heading;
    // (a poca velocidad o pegado a otro robot no gira: así no "baila" con los empujones)
    let crowded = false;
    for (const o of others) if (o !== r && Math.hypot(o.phys.curPos.x - p.x, o.phys.curPos.z - p.z) < o.phys.outerW + r.phys.outerW + 0.25) crowded = true;
    if (want === null || r.spec.drivetrain === 'tank') want = Math.hypot(vx, vz) > 0.9 && !crowded ? Math.atan2(-vz, vx) : r.phys.heading();
    else if (crowded && opts.heading === null) want = r.phys.heading();
    // Por el TRENCH pasa derecho: en diagonal, la intake desplegada choca con el poste o el
    // barandal. Se alinea ANTES de entrar (mientras, avanza despacio); si ya está debajo y chueco
    // no gira (girar ahí es lo que lo acuña: 5000 quedaba trabado a 127°) ni avanza hacia el
    // TRENCH: sale y vuelve a entrar alineado.
    if (trenchX !== undefined) {
      const h = r.phys.heading();
      const axis = Math.abs(Math.atan2(Math.sin(h), Math.cos(h))) < Math.PI / 2 ? 0 : Math.PI;
      const err = Math.abs(Math.atan2(Math.sin(axis - h), Math.cos(axis - h)));
      if (underTrench && err > 0.2) {
        want = h;
        if (vx * (trenchX - p.x) > 0) vx = 0;
        vz *= 0.3;
      } else {
        want = axis;
        if (err > 0.3) {
          vx *= 0.3;
          vz *= 0.3;
        }
      }
    }
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

  private turnOnly(heading: number | null | 'keep'): DriveCommand {
    return { vx: 0, vz: 0, omega: heading === null || heading === 'keep' ? 0 : this.omegaTo(heading) };
  }

  /**
   * Giro hacia `want`: proporcional suave, con zona muerta (~6° por defecto) y tope de 5 rad/s.
   * Para apuntar un shooter fijo la zona muerta debe ser menor que la tolerancia de disparo.
   */
  omegaTo(want: number, dead = 0.1): number {
    const h = this.r.phys.heading();
    const d = Math.atan2(Math.sin(want - h), Math.cos(want - h));
    if (Math.abs(d) < dead) return 0;
    const lim = Math.min(this.r.spec.maxOmega, 5);
    return Math.max(-lim, Math.min(lim, d * 3.5));
  }
}
