/**
 * Solver balístico puro (sin Rapier) para el FUEL: gravedad + arrastre cuadrático
 * (Cd = 0.47) + Magnus suave por backspin. Usa el MISMO modelo que FuelSystem.prePhysics.
 * Sirve para el auto-aim del jugador, la IA y el HUMAN PLAYER.
 */
import { FUEL_MASS_MAX, FUEL_MASS_MIN, FUEL_RADIUS } from '../config/field';

const G = 9.81;
const RHO = 1.2;
const CD = 0.47;
const AREA = Math.PI * FUEL_RADIUS * FUEL_RADIUS;
const MASS = (FUEL_MASS_MIN + FUEL_MASS_MAX) / 2;
const KD = (0.5 * RHO * CD * AREA) / MASS;
const KM = (0.25 * RHO * AREA * FUEL_RADIUS) / MASS;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Simula un tiro en 2D (distancia horizontal r, altura y). Devuelve la altura al llegar a `dist`. */
export function simulate2D(
  speed: number,
  pitch: number,
  spin: number,
  dist: number,
  y0: number,
  dt = 1 / 120,
): { y: number; vy: number; t: number; reached: boolean } {
  let r = 0;
  let y = y0;
  let vr = speed * Math.cos(pitch);
  let vy = speed * Math.sin(pitch);
  let t = 0;
  while (t < 4) {
    const v = Math.hypot(vr, vy);
    // Magnus con backspin: ω perpendicular al plano; ω × v = spin·(−vy, vr) en (r, y)
    const ar = -KD * v * vr - KM * spin * vy;
    const ay = -G - KD * v * vy + KM * spin * vr;
    const nr = r + vr * dt;
    if (nr >= dist) {
      const f = (dist - r) / (vr * dt);
      return { y: y + vy * dt * f, vy, t: t + dt * f, reached: true };
    }
    r = nr;
    y += vy * dt;
    vr += ar * dt;
    vy += ay * dt;
    t += dt;
    if (y < -0.5 || vr <= 0.01) break;
  }
  return { y, vy, t, reached: false };
}

/**
 * Memo de soluciones: los robots tiran desde lugares parecidos todo el tiempo. La clave
 * cuantiza distancia y desnivel a 2.5 cm (error despreciable frente a la abertura del HUB).
 */
const MEMO = new Map<string, { speed: number; t: number; vy: number } | null>();
const Q = 40;

/** Velocidad necesaria con un ángulo fijo para pasar por (dist, h). null si no se puede. */
export function speedForAngle(pitch: number, dist: number, h: number, y0: number, spin: number, maxSpeed: number): { speed: number; t: number; vy: number } | null {
  const key = `${Math.round(pitch * 1000)}|${Math.round(dist * Q)}|${Math.round((h - y0) * Q)}|${spin}|${maxSpeed}`;
  const hit = MEMO.get(key);
  if (hit !== undefined) return hit;
  const res = speedForAngleRaw(pitch, Math.round(dist * Q) / Q, Math.round((h - y0) * Q) / Q, 0, spin, maxSpeed);
  if (MEMO.size > 20000) MEMO.clear();
  MEMO.set(key, res);
  return res;
}

function speedForAngleRaw(pitch: number, dist: number, h: number, y0: number, spin: number, maxSpeed: number): { speed: number; t: number; vy: number } | null {
  let lo = 1;
  let hi = maxSpeed;
  const at = (s: number) => simulate2D(s, pitch, spin, dist, y0);
  const top = at(hi);
  if (!top.reached || top.y < h) return null;
  for (let k = 0; k < 18; k++) {
    const mid = (lo + hi) / 2;
    const r = at(mid);
    if (r.reached && r.y >= h) hi = mid;
    else lo = mid;
  }
  const r = at(hi);
  return { speed: hi, t: r.t, vy: r.vy };
}

export interface ShotRequest {
  from: Vec3;
  target: Vec3;
  /** Velocidad del robot (se hereda al lanzar). Si se pasa, se compensa (shoot-on-the-move). */
  robotVel?: { x: number; z: number };
  minAngle: number; // rad
  maxAngle: number; // rad
  maxSpeed: number;
  spin: number;
  /** Ángulo mínimo de caída (rad) para entrar en una abertura horizontal (HUB). */
  minDescent?: number;
}

export interface ShotSolution {
  yaw: number; // rumbo en la convención del juego: (cos, −sin) en (x, z)
  pitch: number;
  speed: number;
  tof: number;
}

/** Busca ángulo y velocidad para llegar al objetivo (con caída suficientemente vertical). */
export function solveShot(req: ShotRequest): ShotSolution | null {
  const minDescent = req.minDescent ?? 0;
  let aim = { ...req.target };
  let best: ShotSolution | null = null;
  // Iteración de "lead": apunta a target − v_robot·tof
  for (let it = 0; it < (req.robotVel ? 3 : 1); it++) {
    const dx = aim.x - req.from.x;
    const dz = aim.z - req.from.z;
    const dist = Math.hypot(dx, dz);
    best = null;
    const step = (3 * Math.PI) / 180;
    for (let p = req.maxAngle; p >= req.minAngle - 1e-6; p -= step) {
      const s = speedForAngle(p, dist, aim.y, req.from.y, req.spin, req.maxSpeed);
      if (!s) continue;
      const vr = s.speed * Math.cos(p);
      const descent = Math.atan2(-s.vy, vr * 0.8);
      if (descent < minDescent) continue;
      // preferimos el menor tiempo de vuelo que cumpla el ángulo de caída
      if (!best || s.t < best.tof) best = { yaw: Math.atan2(-dz, dx), pitch: p, speed: s.speed, tof: s.t };
    }
    if (!best) {
      // sin restricción de caída (p. ej. pase al piso), toma el más bajo posible
      if (minDescent > 0) return solveShot({ ...req, minDescent: 0, robotVel: req.robotVel });
      return null;
    }
    if (!req.robotVel) break;
    aim = { x: req.target.x - req.robotVel.x * best.tof, y: req.target.y, z: req.target.z - req.robotVel.z * best.tof };
  }
  return best;
}

/** Vector de velocidad de lanzamiento (mundo) a partir de una solución. */
export function launchVector(yaw: number, pitch: number, speed: number): Vec3 {
  const h = speed * Math.cos(pitch);
  return { x: h * Math.cos(yaw), y: speed * Math.sin(pitch), z: -h * Math.sin(yaw) };
}

/** Eje de backspin (mundo) para un tiro en dirección `yaw`: (dir × arriba) normalizado. */
export function backspinAxis(yaw: number, spin: number): Vec3 {
  // dir = (cos, 0, −sin); dir × up = (0·0 − (−sin)·1, …) = (sin, 0, cos)
  return { x: Math.sin(yaw) * spin, y: 0, z: Math.cos(yaw) * spin };
}
