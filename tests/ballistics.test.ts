/** Pruebas del solver balístico (arrastre + Magnus) y del disparo en movimiento. */
import { describe, expect, it } from 'vitest';
import { backspinAxis, launchVector, simulate2D, solveShot } from '../src/physics/ballistics';
import { FUEL_MASS_MAX, FUEL_MASS_MIN, FUEL_RADIUS } from '../src/config/field';

const deg = Math.PI / 180;

/** Integrador 3D independiente con el mismo modelo físico. */
function sim3D(p: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }, w: { x: number; y: number; z: number }, until: (p: { x: number; y: number; z: number }, vy: number) => boolean) {
  const m = (FUEL_MASS_MIN + FUEL_MASS_MAX) / 2;
  const A = Math.PI * FUEL_RADIUS ** 2;
  const kd = (0.5 * 1.2 * 0.47 * A) / m;
  const km = (0.25 * 1.2 * A * FUEL_RADIUS) / m;
  const dt = 1 / 480;
  for (let t = 0; t < 4; t += dt) {
    const s = Math.hypot(v.x, v.y, v.z);
    const ax = -kd * s * v.x + km * (w.y * v.z - w.z * v.y);
    const ay = -9.81 - kd * s * v.y + km * (w.z * v.x - w.x * v.z);
    const az = -kd * s * v.z + km * (w.x * v.y - w.y * v.x);
    p = { x: p.x + v.x * dt, y: p.y + v.y * dt, z: p.z + v.z * dt };
    v = { x: v.x + ax * dt, y: v.y + ay * dt, z: v.z + az * dt };
    if (until(p, v.y)) return p;
  }
  return p;
}

describe('balística del FUEL', () => {
  it('el arrastre reduce el alcance respecto al vacío', () => {
    const r = simulate2D(10, 45 * deg, 0, 6, 0.5);
    // En el vacío a 6 m: y = 0.5 + 6 − 9.81·36/(2·50) = 2.968
    expect(r.y).toBeLessThan(2.968);
    expect(r.y).toBeGreaterThan(2.0);
  });

  it('el backspin (Magnus) eleva la trayectoria', () => {
    const a = simulate2D(10, 40 * deg, 0, 5, 0.5).y;
    const b = simulate2D(10, 40 * deg, 40, 5, 0.5).y;
    expect(b).toBeGreaterThan(a);
  });

  it('resuelve un tiro al HUB con caída pronunciada y lo valida en 3D', () => {
    const from = { x: 0, y: 0.6, z: 0 };
    const target = { x: 2.2, y: 1.93, z: -1.6 };
    const spin = 30;
    const sol = solveShot({ from, target, minAngle: 45 * deg, maxAngle: 78 * deg, maxSpeed: 12.5, spin, minDescent: 35 * deg });
    expect(sol).not.toBeNull();
    const v = launchVector(sol!.yaw, sol!.pitch, sol!.speed);
    const w = backspinAxis(sol!.yaw, spin);
    const d = Math.hypot(target.x, target.z);
    const end = sim3D(from, v, w, (p) => Math.hypot(p.x, p.z) >= d);
    expect(Math.hypot(end.x - target.x, end.z - target.z)).toBeLessThan(0.05);
    expect(Math.abs(end.y - target.y)).toBeLessThan(0.06);
  });

  it('disparo en movimiento: compensa la velocidad heredada del robot', () => {
    const from = { x: 0, y: 0.6, z: 0 };
    const target = { x: 3, y: 1.93, z: 0 };
    const robotVel = { x: 0, z: 2.5 }; // moviéndose de lado a 2.5 m/s
    const sol = solveShot({ from, target, robotVel, minAngle: 45 * deg, maxAngle: 78 * deg, maxSpeed: 12.5, spin: 0, minDescent: 30 * deg })!;
    const lv = launchVector(sol.yaw, sol.pitch, sol.speed);
    const v = { x: lv.x + robotVel.x, y: lv.y, z: lv.z + robotVel.z };
    const end = sim3D(from, v, { x: 0, y: 0, z: 0 }, (p, vy) => vy < 0 && p.y <= target.y);
    expect(Math.hypot(end.x - target.x, end.z - target.z)).toBeLessThan(0.25);
    // Sin compensar, se iría ~tof·2.5 m de lado
    const naive = solveShot({ from, target, minAngle: 45 * deg, maxAngle: 78 * deg, maxSpeed: 12.5, spin: 0, minDescent: 30 * deg })!;
    expect(naive.tof * 2.5).toBeGreaterThan(1);
  });

  it('devuelve null si el objetivo está fuera de alcance', () => {
    expect(solveShot({ from: { x: 0, y: 0.5, z: 0 }, target: { x: 20, y: 2, z: 0 }, minAngle: 30 * deg, maxAngle: 70 * deg, maxSpeed: 8, spin: 0 })).toBeNull();
  });
});
