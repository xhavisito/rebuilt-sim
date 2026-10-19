/**
 * Pruebas de integración de física (Rapier en Node, sin render):
 * BUMP transitable, TRENCH solo para robots ≤ 22.25 in, empujones decididos por
 * tracción/masa y FUEL estable en reposo.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { presetById } from '../src/config/robots';
import { Rng } from '../src/core/rng';
import { buildFieldColliders } from '../src/physics/FieldColliders';
import { FuelState, FuelSystem } from '../src/physics/FuelSystem';
import { initRapier, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { RobotPhysics } from '../src/physics/RobotPhysics';

beforeAll(async () => {
  await initRapier();
});

function world(): PhysicsWorld {
  const pw = new PhysicsWorld(120);
  buildFieldColliders(pw);
  return pw;
}

function run(pw: PhysicsWorld, robots: RobotPhysics[], seconds: number, cmd: (r: RobotPhysics) => { vx: number; vz: number; omega: number }) {
  const steps = Math.round(seconds / pw.dt);
  for (let i = 0; i < steps; i++) {
    for (const r of robots) r.drive(cmd(r), pw.dt);
    pw.step();
    for (const r of robots) r.snapshot();
  }
}

describe('física de robots', () => {
  it('cruza el BUMP (rampas de 15°) y sigue derecho', () => {
    const pw = world();
    const spec = presetById('balanced');
    // Frente al BUMP azul (z = 1.52 m), mirando a +X
    const r = new RobotPhysics(pw, spec, 0, -5.2, F.BUMP_CENTER_Z, 0);
    let maxTilt = 0;
    const steps = Math.round(2.0 / pw.dt); // 2 s: cruza el BUMP azul sin llegar al rojo
    for (let i = 0; i < steps; i++) {
      r.drive({ vx: 3.5, vz: 0, omega: 0 }, pw.dt);
      pw.step();
      r.snapshot();
      maxTilt = Math.max(maxTilt, r.tilt());
    }
    const p = r.position();
    expect(p.x).toBeGreaterThan(F.HUB_CENTER_X_BLUE + 1.0); // ya en la NEUTRAL ZONE
    expect(maxTilt).toBeGreaterThan((5 * Math.PI) / 180); // se inclinó en la rampa
    expect(r.tilt()).toBeLessThan((10 * Math.PI) / 180); // y quedó derecho
    pw.free();
  });

  it('un robot de 21.5 in pasa bajo el TRENCH; uno de 27 in no', () => {
    const zTrench = F.HALF_W - F.TRENCH_CLEAR_WIDTH / 2;
    for (const [id, passes] of [
      ['climber', true],
      ['tank', false],
    ] as const) {
      const pw = world();
      const spec = presetById(id);
      const r = new RobotPhysics(pw, spec, 0, -5.2, zTrench, 0);
      run(pw, [r], 3, () => ({ vx: 3, vz: 0, omega: 0 }));
      const x = r.position().x;
      if (passes) expect(x).toBeGreaterThan(F.HUB_CENTER_X_BLUE + 0.8);
      else expect(x).toBeLessThan(F.HUB_CENTER_X_BLUE);
      pw.free();
    }
  });

  it('en un empujón de frente gana más tracción y masa', () => {
    const pw = world();
    const strong = new RobotPhysics(pw, presetById('defender'), 0, -1.0, -1.5, 0);
    const weak = new RobotPhysics(pw, presetById('climber'), 1, 0.0, -1.5, Math.PI);
    run(pw, [strong, weak], 3, (r) => (r === strong ? { vx: 4, vz: 0, omega: 0 } : { vx: -4, vz: 0, omega: 0 }));
    // El defensor avanzó (+X) empujando al escalador hacia atrás
    expect(strong.position().x).toBeGreaterThan(-0.6);
    pw.free();
  });

  it('respeta la velocidad máxima y limita la aceleración por tracción', () => {
    const pw = world();
    const spec = presetById('balanced');
    // Sobre la CENTER LINE, a lo ancho del campo (sin FUEL en esta prueba)
    const r = new RobotPhysics(pw, spec, 0, 0, -3.6, Math.PI / 2);
    run(pw, [r], 0.25, () => ({ vx: 0, vz: 10, omega: 0 }));
    const v1 = r.velocity().z;
    expect(v1).toBeLessThan(spec.maxAccel * 0.25 + 0.2);
    run(pw, [r], 1.3, () => ({ vx: 0, vz: 10, omega: 0 }));
    expect(r.velocity().z).toBeLessThanOrEqual(spec.maxSpeed + 0.05);
    expect(r.velocity().z).toBeGreaterThan(spec.maxSpeed - 0.3);
    pw.free();
  });
});

describe('FUEL', () => {
  it('504 FUEL se acomodan sin salirse ni explotar', () => {
    const pw = world();
    const fuel = new FuelSystem(pw, F.FUEL_TOTAL, new Rng(1));
    fuel.stage([8, 8, 8, 8, 8, 8]);
    expect(fuel.countState(FuelState.Robot)).toBe(48);
    expect(fuel.countState(FuelState.Chute)).toBe(48);
    expect(fuel.countState(FuelState.Field)).toBe(F.FUEL_TOTAL - 96);
    for (let i = 0; i < 240; i++) {
      fuel.prePhysics(pw.dt);
      pw.step();
      fuel.postPhysics(pw.dt);
    }
    expect(fuel.countState(FuelState.Out)).toBe(0);
    let maxSpeed = 0;
    for (let i = 0; i < fuel.count; i++) {
      if (fuel.state[i] !== FuelState.Field) continue;
      const v = fuel.bodies[i].linvel();
      maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y, v.z));
    }
    expect(maxSpeed).toBeLessThan(0.3);
    pw.free();
  });

  it('un tiro parabólico entra al HUB y sale por la NEUTRAL ZONE', () => {
    const pw = world();
    const fuel = new FuelSystem(pw, 4, new Rng(2));
    let entered = 0;
    let exited = 0;
    fuel.cb = { onHubEnter: () => entered++, onHubExit: () => exited++ };
    const hub = F.hubCenter('blue');
    // Desde 2.5 m frente al HUB, a 0.6 m de altura: velocidad que cae dentro del hexágono
    fuel.launch(0, { x: hub.x - 2.5, y: 0.6, z: 0 }, { x: 2.6, y: 6.1, z: 0 }, null, 0);
    for (let i = 0; i < 600; i++) {
      fuel.prePhysics(pw.dt);
      pw.step();
      fuel.postPhysics(pw.dt);
    }
    expect(entered).toBe(1);
    expect(exited).toBe(1);
    // terminó del lado de la NEUTRAL ZONE (x mayor que el HUB azul)
    expect(fuel.pos[0]).toBeGreaterThan(hub.x + F.HUB_SIZE / 2);
    pw.free();
  });
});
