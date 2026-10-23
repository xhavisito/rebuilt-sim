/**
 * Pruebas de integración de física (Rapier en Node, sin render):
 * BUMP transitable, TRENCH solo para robots ≤ 22.25 in (y sin postes en el paso), intake
 * desplegada sólida, empujones decididos por tracción/masa, FUEL estable en reposo y choques
 * entre FUEL que reparten el golpe.
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
    const spec = presetById('cad-6328');
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

  it('a toda velocidad y girando sobre el BUMP no se voltea', () => {
    for (const omega of [0, 4]) {
      const pw = world();
      const r = new RobotPhysics(pw, presetById('cad-190'), 0, -5.6, F.BUMP_CENTER_Z, 0.3);
      let maxTilt = 0;
      // 1.6 s: cruza el BUMP azul y frena en la NEUTRAL ZONE, antes del BUMP rojo
      run(pw, [r], 1.6, (rb) => {
        maxTilt = Math.max(maxTilt, rb.tilt());
        return { vx: 6, vz: 0, omega };
      });
      run(pw, [r], 1.0, () => ({ vx: 0, vz: 0, omega: 0 }));
      expect(maxTilt, `omega ${omega}`).toBeLessThan((40 * Math.PI) / 180);
      expect(r.tilt(), `omega ${omega}`).toBeLessThan((5 * Math.PI) / 180);
      pw.free();
    }
  });

  it('inclinado más allá del punto de vuelco, se endereza (aterriza plano)', () => {
    const pw = world();
    const r = new RobotPhysics(pw, presetById('cad-6328'), 0, 0, -3.2, 0);
    // 85° de alabeo (pasado el punto de vuelco: sin ayuda cae de lado), un poco arriba del piso
    const a = (85 * Math.PI) / 180;
    r.body.setRotation({ x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) }, true);
    r.body.setTranslation({ x: 0, y: 0.45, z: -3.2 }, true);
    run(pw, [r], 2.5, () => ({ vx: 0, vz: 0, omega: 0 }));
    expect(r.tilt()).toBeLessThan((8 * Math.PI) / 180);
    pw.free();
  });

  it('un robot de 21.8 in pasa bajo el TRENCH; uno de 28.8 in no', () => {
    const zTrench = F.HALF_W - F.TRENCH_CLEAR_WIDTH / 2;
    for (const [id, passes] of [
      ['cad-6328', true],
      ['cad-604', false],
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

  it('pasa pegado al barandal por el TRENCH (sin postes en el paso)', () => {
    const spec = presetById('cad-6328');
    const pw = world();
    const outerW = F.inch(spec.widthIn / 2 + spec.bumperIn);
    const r = new RobotPhysics(pw, spec, 0, -5.2, F.HALF_W - outerW - 0.02, 0);
    run(pw, [r], 3, () => ({ vx: 3, vz: 0, omega: 0 }));
    expect(r.position().x).toBeGreaterThan(F.HUB_CENTER_X_BLUE + 0.8);
    pw.free();
  });

  it('la intake desplegada choca con el TRENCH; guardada, el robot llega más lejos', () => {
    const spec = presetById('cad-6328');
    // De frente contra el poste del TRENCH (lado del BUMP), por fuera del paso
    const zPost = F.TRENCH_INNER_Z + (F.TRENCH_WIDTH - F.TRENCH_CLEAR_WIDTH) / 2;
    const reach = (deployed: boolean) => {
      const pw = world();
      const r = new RobotPhysics(pw, spec, 0, F.HUB_CENTER_X_BLUE - 2.2, zPost, 0);
      r.setExtended(deployed);
      run(pw, [r], 2, () => ({ vx: 2, vz: 0, omega: 0 }));
      const x = r.position().x;
      pw.free();
      return x;
    };
    const stowed = reach(false);
    const deployed = reach(true);
    const face = F.HUB_CENTER_X_BLUE - F.TRENCH_DEPTH / 2;
    expect(stowed).toBeLessThan(face);
    // con la intake abajo se detiene antes: lo que sobresale (≈ 9 in) toca el poste
    expect(stowed - deployed).toBeGreaterThan(F.inch(6));
  });

  it('sabe hacia dónde alejarse de lo que toca (para desatorarse)', () => {
    const pw = world();
    const spec = presetById('cad-6328');
    const outerW = F.inch(spec.widthIn / 2 + spec.bumperIn);
    // pegado al barandal de −Z, empujando hacia él
    const r = new RobotPhysics(pw, spec, 0, 0, -F.HALF_W + outerW + 0.01, 0);
    run(pw, [r], 0.5, () => ({ vx: 0, vz: -1.5, omega: 0 }));
    const away = r.awayFromContacts();
    expect(away).not.toBeNull();
    expect(away!.z).toBeGreaterThan(0.9);
    pw.free();
  });

  it('en un empujón de frente gana más tracción y masa', () => {
    const pw = world();
    const strong = new RobotPhysics(pw, presetById('cad-1678'), 0, -1.0, -1.5, 0);
    const weak = new RobotPhysics(pw, presetById('cad-190'), 1, 0.0, -1.5, Math.PI);
    run(pw, [strong, weak], 3, (r) => (r === strong ? { vx: 4, vz: 0, omega: 0 } : { vx: -4, vz: 0, omega: 0 }));
    // El de más tracción y masa avanzó (+X) empujando al otro hacia atrás
    expect(strong.position().x).toBeGreaterThan(-0.6);
    pw.free();
  });

  it('respeta la velocidad máxima y limita la aceleración por tracción', () => {
    const pw = world();
    const spec = presetById('cad-6328');
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

  it('acelera con la curva del motor y frena con toda la tracción', () => {
    const pw = world();
    const spec = presetById('cad-6328');
    const r = new RobotPhysics(pw, spec, 0, 0, -3.6, Math.PI / 2);
    // Arranque: los primeros 0.1 s casi a toda la aceleración; cerca de la velocidad máxima, menos
    run(pw, [r], 0.1, () => ({ vx: 0, vz: 10, omega: 0 }));
    const early = r.velocity().z / 0.1;
    run(pw, [r], 0.4, () => ({ vx: 0, vz: 10, omega: 0 }));
    const v0 = r.velocity().z;
    run(pw, [r], 0.1, () => ({ vx: 0, vz: 10, omega: 0 }));
    const late = (r.velocity().z - v0) / 0.1;
    expect(late).toBeLessThan(early * 0.75);
    // Frenado desde velocidad máxima: más fuerte que la aceleración de arriba
    run(pw, [r], 1.0, () => ({ vx: 0, vz: 10, omega: 0 }));
    const vTop = r.velocity().z;
    run(pw, [r], 0.1, () => ({ vx: 0, vz: 0, omega: 0 }));
    const brake = (vTop - r.velocity().z) / 0.1;
    expect(brake).toBeGreaterThan(late * 1.5);
    expect(brake).toBeLessThanOrEqual(spec.traction * 9.81 + 1.0) // + roce del chasis;
    pw.free();
  });
});

describe('FUEL', () => {
  it('el BUMPER empuja el FUEL (no lo atraviesa) sin lanzarlo volando', () => {
    const pw = world();
    const fuel = new FuelSystem(pw, 1, new Rng(1));
    const r = new RobotPhysics(pw, presetById('cad-1678'), 0, -1.5, -3.2, 0);
    fuel.place(0, 0.2, F.FUEL_RADIUS, -3.3, false);
    let vmax = 0;
    let ymax = 0;
    for (let i = 0; i < 360; i++) {
      r.drive(i < 240 ? { vx: 4.5, vz: 0, omega: 0 } : { vx: 0, vz: 0, omega: 0 }, pw.dt);
      fuel.prePhysics(pw.dt);
      pw.step();
      fuel.postPhysics(pw.dt);
      r.snapshot();
      if (fuel.pos[0] > 2) continue; // lejos de lo demás del campo
      const v = fuel.bodies[0].linvel();
      vmax = Math.max(vmax, Math.hypot(v.x, v.y, v.z));
      ymax = Math.max(ymax, fuel.pos[1]);
    }
    // Con grupo de dominancia el BUMPER contaba como pared quieta: el FUEL quedaba atrás del robot
    expect(fuel.pos[0]).toBeGreaterThan(r.position().x);
    // BUMPER acolchonado: sale apenas más rápido que el robot y rodando por el piso
    expect(vmax).toBeGreaterThan(4.3);
    expect(vmax).toBeLessThan(4.5 * 1.35);
    expect(ymax).toBeLessThan(F.FUEL_RADIUS + 0.03);
    pw.free();
  });

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

  it('un FUEL que rueda reparte el golpe con el que está quieto (no son piedras)', () => {
    const pw = world();
    const fuel = new FuelSystem(pw, 2, new Rng(3));
    // En la NEUTRAL ZONE, lejos de todo: A rueda a 2 m/s (con su giro) hacia B en reposo
    fuel.place(0, 1.0, F.FUEL_RADIUS, -3.2, false);
    fuel.place(1, 1.6, F.FUEL_RADIUS, -3.2, true);
    fuel.bodies[0].setLinvel({ x: 2, y: 0, z: 0 }, true);
    fuel.bodies[0].setAngvel({ x: 0, y: 0, z: -2 / F.FUEL_RADIUS }, true);
    let vBmax = 0;
    for (let i = 0; i < 240; i++) {
      fuel.prePhysics(pw.dt);
      pw.step();
      fuel.postPhysics(pw.dt);
      vBmax = Math.max(vBmax, fuel.bodies[1].linvel().x);
    }
    // Choque casi elástico entre masas iguales: B sale con ~(1 + e)/2 de la velocidad de A
    expect(vBmax).toBeGreaterThan(1.1);
    // …y rueda lejos (antes apenas se movía ~0.3 m)
    expect(fuel.pos[3] - 1.6).toBeGreaterThan(0.5);
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

  it('3478 (27.5 in) pasa bajo los soportes de la TOWER (§5.8: desde 28.40 in), en los dos sentidos', () => {
    const tw = F.towerInfo('blue');
    // en el paso entre la TOWER WALL y el UPRIGHT (a la mitad o cargado hacia la pared)
    const mid = (-F.HALF_L + tw.uprightX - F.UPRIGHT_DEEP / 2) / 2;
    for (const x of [mid - 0.08, mid, mid + 0.05])
      for (const dir of [1, -1]) {
        for (const deployed of [false, true]) {
          for (const heading of [0, 0.1, Math.PI / 2]) {
            const pw = world();
            const r = new RobotPhysics(pw, presetById('cad-3478'), 0, x, tw.cz - dir * 1.6, heading);
            r.setIntakeDeployed(deployed);
            run(pw, [r], 2.2, () => ({ vx: 0, vz: dir * 1.5, omega: 0 }));
            // cruzó el soporte del otro lado de la TOWER
            expect(dir * (r.position().z - tw.cz)).toBeGreaterThan(1.0);
            pw.free();
          }
        }
      }
  });
});
