/**
 * Mecanismos de robot: intake de piso, hopper, shooter (fijo o turret) con auto-aim
 * balístico y disparo en movimiento, pase y entrega al CORRAL.
 */
import * as F from '../config/field';
import type { Rng } from '../core/rng';
import type { Alliance } from '../core/types';
import { backspinAxis, launchVector, solveShot, type ShotSolution, type Vec3 } from '../physics/ballistics';
import { FLAG_SHOT, type FuelSystem } from '../physics/FuelSystem';
import type { Robot } from './Robot';

const DEG = Math.PI / 180;

export interface MechContext {
  fuel: FuelSystem;
  rng: Rng;
  /** Tiempo del match (o de la sesión) para marcar los tiros. */
  time: number;
  autoAim: boolean;
  shootOnMove: boolean;
  /** IA/AUTO: no dispara hasta estar alineado (un humano dispara donde apunta). */
  requireAlign?: boolean;
  /** Se llama al capturar un FUEL (para G408: FUEL que sale del HUB). */
  onIntake?(robot: Robot, index: number): void;
  onLaunch?(robot: Robot, index: number, kind: 'shot' | 'pass' | 'corral'): void;
}

/** Punto objetivo de tiro al HUB propio: centro de la abertura, un poco arriba del borde. */
export function hubAimPoint(r: Robot): { x: number; y: number; z: number } {
  const c = F.hubCenter(r.alliance);
  return { x: c.x, y: F.HUB_RIM_HEIGHT + 0.12, z: c.z };
}

/** Altura de salida del FUEL: sobre la superestructura para no chocar con el propio robot. */
export function exitHeight(r: Robot): number {
  return Math.max(F.inch(r.spec.shooter.exitHeightIn), r.phys.height + F.FUEL_RADIUS + 0.03);
}

/**
 * Hacia dónde tira un shooter FIJO respecto al frente del robot (rad, + = antihorario visto
 * desde arriba). Muchos robots de 2026 recogen por delante y tiran hacia atrás o de lado.
 */
export function shooterYawOffset(r: Robot): number {
  return r.spec.shooter.type === 'fixed' ? (r.spec.shooter.yawDeg ?? 0) * DEG : 0;
}

/** Rumbo que debe tener el chasis para que el shooter apunte hacia `yaw`. */
export function chassisYawFor(r: Robot, yaw: number): number {
  return wrap(yaw - shooterYawOffset(r));
}

/** Punto de salida del FUEL (posición del shooter en el robot, a la altura de salida). */
export function shooterOrigin(r: Robot, h = r.phys.heading()): { x: number; y: number; z: number } {
  const p = r.phys.curPos;
  const [lx, ly] = r.spec.shooter.posIn ?? [0, 0];
  // marco del robot: x adelante, y a la izquierda (WPILib) → mundo (z = −y)
  const w = r.phys.localToWorld(F.inch(lx), -F.inch(ly), h);
  return { x: w.x, y: p.y + exitHeight(r), z: w.z };
}

/**
 * FUEL que el robot empuja en la dirección en que quiere moverse: la primera fila pegada al
 * BUMPER cuenta 1 y las dos siguientes 0.5 (el montón detrás también se resiste).
 */
export function plowLoad(r: Robot, fuel: FuelSystem): number {
  const d = r.cmd.drive;
  const sp = Math.hypot(d.vx, d.vz);
  if (sp < 0.2 || r.climbing) return 0;
  const ux = d.vx / sp;
  const uz = d.vz / sp;
  const ph = r.phys;
  const h = ph.heading();
  // Dirección de avance en el marco del robot → semiejes de la caja de BUMPERS en esa dirección
  const lx = Math.abs(ux * Math.cos(h) - uz * Math.sin(h));
  const lz = Math.abs(ux * Math.sin(h) + uz * Math.cos(h));
  const along = lx * ph.outerL + lz * ph.outerW;
  const side = lz * ph.outerL + lx * ph.outerW;
  const D = F.FUEL_DIAMETER;
  const p = ph.curPos;
  const c = Math.cos(h);
  const sn = Math.sin(h);
  // Con la intake abajo, el FUEL frente a los rodillos se traga en vez de empujarse
  const intakeHw = r.intakeOn && r.intakeDeploy > 0.6 ? F.inch(r.spec.intake.widthIn) / 2 : -1;
  let n = 0;
  fuel.forEachNear(p.x, p.z, along + 3 * D + 0.05, (_i, px, py, pz) => {
    if (py > p.y + 0.3) return;
    const dx = px - p.x;
    const dz = pz - p.z;
    const s = dx * ux + dz * uz;
    const l = Math.abs(dx * uz - dz * ux);
    if (l > side + F.FUEL_RADIUS * 0.5 || s < along - 0.02) return;
    const w = intakeHw > 0 && dx * c - dz * sn > 0 && Math.abs(dx * sn + dz * c) < intakeHw ? 0.3 : 1;
    if (s < along + D + 0.02) n += w;
    else if (s < along + 3 * D + 0.05) n += 0.5 * w;
  });
  return n;
}

/**
 * Ningún FUEL puede quedar dentro del robot. Con un montón denso el solver no alcanza a
 * empujar todas las pelotas a tiempo y el robot "se desliza" a través de ellas; después de
 * cada paso, las que quedaron dentro de la huella (BUMPERS, o hasta el rodillo si la intake
 * está desplegada) salen por el lado más cercano con la velocidad del robot en esa dirección.
 */
export function shoveFuel(r: Robot, fuel: FuelSystem): void {
  const ph = r.phys;
  if (ph.isKinematic()) return;
  const R = F.FUEL_RADIUS;
  const p = ph.body.translation();
  const v = ph.body.linvel();
  const h = ph.heading();
  const c = Math.cos(h);
  const sn = Math.sin(h);
  const front = ph.intakeDeployed ? Math.max(ph.outerL, ph.intakeFront) : ph.outerL;
  const ex = Math.max(front, ph.outerL);
  const reach = Math.hypot(ex, ph.outerW) + R;
  const maxY = p.y + ph.height + R;
  fuel.forEachNear(p.x, p.z, reach, (i) => {
    const b = fuel.bodies[i];
    const t = b.translation();
    if (t.y > maxY || t.y < p.y - 0.05) return;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    // marco local: x adelante, z derecha
    const lx = dx * c - dz * sn;
    const lz = dx * sn + dz * c;
    const fx = lx >= 0 ? front : ph.outerL;
    const px = fx + R - Math.abs(lx); // penetración en x (por el lado de lx)
    const pz = ph.outerW + R - Math.abs(lz);
    if (px <= 0.002 || pz <= 0.002) return;
    // Sale por el lado de menor penetración que quede dentro del campo: contra la pared, el
    // FUEL se escurre a lo largo de ella en vez de atravesarla (salía del campo y contaba G405).
    // [penetración, x local, z local, normal de salida en mundo (x, z)]
    const exits: Array<[number, number, number, number, number]> = [];
    for (const sx of [1, -1]) {
      const f = sx > 0 ? front : ph.outerL;
      exits.push([f + R - sx * lx, sx * (f + R + 0.003), lz, sx * c, -sx * sn]);
    }
    for (const sz of [1, -1]) exits.push([ph.outerW + R - sz * lz, lx, sz * (ph.outerW + R + 0.003), sz * sn, sz * c]);
    exits.sort((a, b) => a[0] - b[0]);
    const inField = (x: number, z: number) => {
      if (Math.abs(z) >= F.HALF_W - R) return false;
      if (Math.abs(x) < F.HALF_L - R) return true;
      // Por la abertura del CORRAL sí puede salir (los robots empujan FUEL al CORRAL)
      return Math.abs(z - F.outpostInfo(x > 0 ? 'red' : 'blue').z) < F.CORRAL_OPEN_W / 2 - R;
    };
    let pick = exits[0];
    for (const e of exits) {
      if (inField(p.x + e[1] * c + e[2] * sn, p.z - e[1] * sn + e[2] * c)) {
        pick = e;
        break;
      }
    }
    const [, nlx, nlz, nx, nz] = pick;
    // local → mundo (inversa de la rotación de arriba)
    const wx = p.x + nlx * c + nlz * sn;
    const wz = p.z - nlx * sn + nlz * c;
    b.setTranslation({ x: wx, y: Math.max(R, t.y), z: wz }, true);
    // velocidad: al menos la del robot en la normal de salida (+ un empujón de espuma)
    const bv = b.linvel();
    const rvn = v.x * nx + v.z * nz;
    const bvn = bv.x * nx + bv.z * nz;
    const want = Math.max(rvn * 1.15 + 0.15, bvn);
    b.setLinvel({ x: bv.x + (want - bvn) * nx, y: Math.max(0, bv.y), z: bv.z + (want - bvn) * nz }, true);
  });
}

/** Captura FUEL dentro de la zona de la intake (marco local del robot), con tasa máxima. */
export function runIntake(r: Robot, ctx: MechContext, dt: number): void {
  if (!r.intakeOn || r.intakeDeploy < 0.6 || r.climbing) {
    r.intakeAcc = 0;
    return;
  }
  const s = r.spec;
  r.intakeAcc = Math.min(2, r.intakeAcc + s.intake.rate * dt);
  if (r.intakeAcc < 1) return;
  const f = ctx.fuel;
  if (f.robotCount(r.index) >= s.hopperCapacity) return;
  const h = r.phys.heading();
  // Zona de captura: pegada al frente del rodillo (donde el FUEL lo toca)
  const face = r.phys.intakeFront;
  const x0 = face - 0.05;
  const x1 = face + F.FUEL_RADIUS * 2 + 0.03;
  const hw = r.phys.intakeHalfW;
  const p = r.phys.curPos;
  const c = Math.cos(h);
  const sn = Math.sin(h);
  let best = -1;
  let bestX = Infinity;
  f.forEachNear(p.x, p.z, x1 + 0.3, (i, px, py, pz) => {
    if (py > p.y + 0.24) return;
    const dx = px - p.x;
    const dz = pz - p.z;
    const lx = dx * c - dz * sn;
    const lz = dx * sn + dz * c;
    if (lx >= x0 && lx <= x1 && Math.abs(lz) <= hw && lx < bestX) {
      best = i;
      bestX = lx;
    }
  });
  if (best >= 0) {
    r.intakeAcc -= 1;
    ctx.onIntake?.(r, best);
    f.toRobot(best, r.index);
    r.stats.intaked++;
  }
}

/**
 * Cómo saldría el siguiente FUEL (para la guía de tiro del jugador): misma lógica de objetivo
 * y de rumbo que `runShooter`, sin dispersión. null = fuera de alcance o entrega al CORRAL.
 */
export function predictLaunch(
  r: Robot,
  autoAim: boolean,
  shootOnMove: boolean,
  dt: number,
): { from: Vec3; vel: Vec3; spin: Vec3; pass: boolean } | null {
  const s = r.spec.shooter;
  const pass = r.cmd.pass;
  const h = r.phys.heading();
  const v = r.phys.velocity();
  const from = shooterOrigin(r, h);
  const hs = h + shooterYawOffset(r); // rumbo del shooter fijo
  if (pass && r.lastShotKind === 'corral') return null;
  let sol: ShotSolution | null;
  if (r.cmd.shoot || pass) sol = r.lastSolution;
  else if ((r.previewTimer -= dt) > 0) sol = r.previewSolution;
  else {
    // Sin disparar: la solución se recalcula a 10 Hz (la trayectoria sí sigue al robot cada frame)
    r.previewTimer = 0.1;
    const target = r.cmd.aim ? { x: r.cmd.aim.x, y: r.cmd.aim.y ?? 0.5, z: r.cmd.aim.z } : hubAimPoint(r);
    if (!autoAim && s.type === 'fixed' && !r.cmd.aim) {
      const d = Math.hypot(target.x - from.x, target.z - from.z);
      target.x = from.x + Math.cos(hs) * d;
      target.z = from.z - Math.sin(hs) * d;
    }
    sol = solveShot({
      from,
      target,
      robotVel: shootOnMove ? { x: v.x, z: v.z } : undefined,
      minAngle: s.minAngle * DEG,
      maxAngle: s.maxAngle * DEG,
      maxSpeed: s.maxSpeed,
      spin: s.backspin,
      minDescent: r.cmd.aim ? 0 : 35 * DEG,
    });
    r.previewSolution = sol;
  }
  if (!sol) return null;
  let yaw = s.type === 'turret' ? sol.yaw : hs;
  if (s.type === 'fixed' && Math.abs(wrap(sol.yaw - hs)) < FIXED_AIM_TOL) yaw = sol.yaw;
  const lv = launchVector(yaw, sol.pitch, sol.speed);
  return {
    from: { x: from.x + Math.cos(yaw) * 0.05, y: from.y, z: from.z - Math.sin(yaw) * 0.05 },
    vel: { x: lv.x + v.x, y: lv.y, z: lv.z + v.z },
    spin: backspinAxis(yaw, s.backspin),
    pass,
  };
}

/** Gira la turret / hood hacia la solución y dispara con la cadencia del diseño. */
export function runShooter(r: Robot, ctx: MechContext, dt: number): void {
  const s = r.spec.shooter;
  const wantShoot = r.cmd.shoot && !r.climbing;
  const wantPass = r.cmd.pass && !r.climbing;
  r.spinUp = wantShoot || wantPass ? Math.min(1, r.spinUp + dt / 0.35) : Math.max(0, r.spinUp - dt / 1.2);
  r.flywheelSpin += r.spinUp * 120 * dt;
  r.shootCooldown = Math.max(0, r.shootCooldown - dt);
  const h = r.phys.heading();
  const p = r.phys.curPos;
  const v = r.phys.velocity();
  const from = shooterOrigin(r, h);
  const hs = h + shooterYawOffset(r); // rumbo del shooter fijo

  // ---- Objetivo y solución (recalculada a 10 Hz: el solver numérico es caro)
  r.solveTimer -= dt;
  const kindWanted = wantPass ? 'pass' : 'shot';
  const reuse = r.solveTimer > 0 && r.lastKind === kindWanted;
  let solution: ReturnType<typeof solveShot> = reuse ? r.lastSolution : null;
  let kind: 'shot' | 'pass' | 'corral' = reuse ? r.lastShotKind : 'shot';
  if (reuse) {
    /* usa la solución cacheada */
  } else if (wantPass) {
    kind = 'pass';
    const out = F.outpostInfo(r.alliance);
    const toOut = Math.hypot(out.x - p.x, out.z - p.z);
    const fx = Math.cos(h);
    const fz = -Math.sin(h);
    const facing = ((out.x - p.x) * fx + (out.z - p.z) * fz) / Math.max(0.01, toOut);
    if (toOut < 2.3 && facing > 0.75) kind = 'corral';
    else {
      // Pase al ALLIANCE ZONE propio (o al punto del mouse), por un carril a un lado del HUB
      const target = r.cmd.aim ? { x: r.cmd.aim.x, y: 0.4, z: r.cmd.aim.z } : passTarget(r.alliance, p.z);
      solution = solveShot({
        from,
        target,
        robotVel: ctx.shootOnMove ? { x: v.x, z: v.z } : undefined,
        minAngle: s.minAngle * DEG,
        maxAngle: s.maxAngle * DEG,
        maxSpeed: s.maxSpeed,
        spin: s.backspin,
      });
    }
  } else if (wantShoot) {
    const target = r.cmd.aim ? { x: r.cmd.aim.x, y: r.cmd.aim.y ?? 0.5, z: r.cmd.aim.z } : hubAimPoint(r);
    if (!ctx.autoAim && s.type === 'fixed' && !r.cmd.aim) {
      // Manual: solo distancia (tabla de tiro); el piloto apunta con el rumbo.
      const d = Math.hypot(target.x - from.x, target.z - from.z);
      target.x = from.x + Math.cos(hs) * d;
      target.z = from.z - Math.sin(hs) * d;
    }
    solution = solveShot({
      from,
      target,
      robotVel: ctx.shootOnMove ? { x: v.x, z: v.z } : undefined,
      minAngle: s.minAngle * DEG,
      maxAngle: s.maxAngle * DEG,
      maxSpeed: s.maxSpeed,
      spin: s.backspin,
      minDescent: r.cmd.aim ? 0 : 35 * DEG,
    });
  }
  if (!reuse && (wantShoot || wantPass)) {
    r.solveTimer = 0.1;
    r.lastKind = kindWanted;
    r.lastShotKind = kind;
  }
  r.lastSolution = solution;

  // ---- Turret y hood siguen a la solución
  if (s.type === 'turret') {
    const want = solution ? wrap(solution.yaw - h) : r.cmd.shoot || r.cmd.pass ? r.turretYaw : wrap(r.turretYaw * 0.9);
    const d = wrap(want - r.turretYaw);
    r.turretYaw = wrap(r.turretYaw + Math.sign(d) * Math.min(Math.abs(d), 8 * dt));
  }
  if (solution) r.hoodAngle += (solution.pitch - r.hoodAngle) * Math.min(1, dt * 10);

  // ---- FUEL de una ráfaga que ya estaba en el flywheel: sale aunque se suelte el gatillo
  if (r.burst.length) {
    const yawNow = s.type === 'turret' ? h + r.turretYaw : hs;
    for (let k = r.burst.length - 1; k >= 0; k--) {
      const b = r.burst[k];
      b.delay -= dt;
      if (b.delay > 0) continue;
      r.burst.splice(k, 1);
      const a = r.burstAim;
      launchOne(r, ctx, a.kind, yawNow + a.yawRel, a.pitch, a.speed, b.lat);
    }
  }

  if (!(wantShoot || wantPass) || r.spinUp < 1 || r.shootCooldown > 0 || r.burst.length) return;
  const available = ctx.fuel.robotCount(r.index);
  if (available === 0) return;
  if (ctx.requireAlign && solution && kind !== 'corral') {
    const aimYaw = s.type === 'turret' ? h + r.turretYaw : hs;
    // El shooter fijo corrige hasta ±6° al tirar (abajo): esa es su tolerancia
    if (Math.abs(wrap(solution.yaw - aimYaw)) > (s.type === 'fixed' ? FIXED_AIM_TOL : 0.09)) return;
  }

  // ---- Lanzamiento
  const yawShooter = s.type === 'turret' ? h + r.turretYaw : hs;
  let yaw = yawShooter;
  let pitch = solution ? solution.pitch : (s.minAngle + s.maxAngle) * 0.5 * DEG;
  let speed = solution ? solution.speed : s.maxSpeed * 0.9;
  if (kind === 'corral') {
    pitch = 0;
    speed = 2.6;
  } else if (solution && s.type === 'turret') yaw = solution.yaw;
  // Un shooter fijo solo puede tirar hacia su frente: si la solución cae fuera (±6°), dispara de frente.
  if (s.type === 'fixed' && solution && Math.abs(wrap(solution.yaw - hs)) < FIXED_AIM_TOL) yaw = solution.yaw;
  if (kind === 'corral') {
    launchOne(r, ctx, kind, yaw, pitch, speed, 0);
    r.shootCooldown = 1 / Math.max(0.5, s.rate);
    return;
  }
  // Un "dumper" (shooter de varios FUEL de ancho) no suelta filas perfectas: en cada ráfaga
  // llegan al flywheel de 1 a `lanes` FUEL (los que alcance a empujar el indexer), en lugares
  // al azar a lo ancho del shooter y con unas centésimas de diferencia. Una turret doble tira
  // con una, la otra o ambas. La cadencia media sigue siendo `rate`.
  const lanes = Math.max(1, s.lanes ?? 1);
  const n = Math.min(available, ctx.rng.int(1, lanes));
  const lats = burstPositions(lanes, n, s.laneSpacingIn ? F.inch(s.laneSpacingIn) : 0, ctx.rng);
  r.burstAim = { kind, yawRel: wrap(yaw - yawShooter), pitch, speed };
  lats.forEach((lat, k) => {
    // el primero sale ya; los demás, hasta 70 ms después (el indexer los empuja uno tras otro)
    if (k === 0) launchOne(r, ctx, kind, yaw, pitch, speed, lat);
    else r.burst.push({ delay: ctx.rng.range(0.012, 0.07), lat });
  });
  r.shootCooldown = (n / Math.max(0.5, s.rate)) * ctx.rng.range(0.75, 1.25);
}

/**
 * Posiciones laterales (m, + = a la izquierda del shooter) de `n` FUEL de una ráfaga. Dos turrets
 * (`turretSpacing` > 0): una por turret. Dumper: lugares al azar a lo ancho (`lanes` FUEL), sin
 * encimarse.
 */
export function burstPositions(lanes: number, n: number, turretSpacing: number, rng: Rng): number[] {
  if (lanes <= 1) return [0];
  if (turretSpacing > 0) {
    const slots = Array.from({ length: lanes }, (_, k) => (k - (lanes - 1) / 2) * turretSpacing);
    rng.shuffle(slots);
    return slots.slice(0, n);
  }
  const D = F.FUEL_DIAMETER * 1.02;
  const half = ((lanes - 1) * D * 1.03) / 2;
  // n puntos al azar en el hueco que sobra (ordenados) + un FUEL de separación entre cada uno:
  // nunca se enciman y cualquier acomodo es igual de probable
  const slack = Math.max(0, 2 * half - (Math.min(n, lanes) - 1) * D);
  const u = Array.from({ length: Math.min(n, lanes) }, () => rng.range(0, slack)).sort((a, b) => a - b);
  return rng.shuffle(u.map((x, k) => x + k * D - half));
}

/** Lanza un FUEL del hopper desde el shooter (o lo entrega al CORRAL). */
function launchOne(r: Robot, ctx: MechContext, kind: 'shot' | 'pass' | 'corral', yaw: number, pitch: number, speed: number, lat: number): void {
  const i = ctx.fuel.popRobot(r.index);
  if (i === undefined) return;
  const s = r.spec.shooter;
  const h = r.phys.heading();
  const p = r.phys.curPos;
  const v = r.phys.velocity();
  const from = shooterOrigin(r, h);
  // Dispersión según la precisión del diseño (cada FUEL sale un poco distinto)
  const sig = 1 - s.accuracy;
  const yk = yaw + ctx.rng.gauss() * sig * 0.07;
  const pk = pitch + ctx.rng.gauss() * sig * 0.05;
  const sk = speed * (1 + ctx.rng.gauss() * sig * 0.04);
  const lv = launchVector(yk, pk, sk);
  let start = { x: from.x + Math.cos(yk) * 0.05 + Math.sin(yaw) * lat, y: from.y, z: from.z - Math.sin(yk) * 0.05 + Math.cos(yaw) * lat };
  if (kind === 'corral') {
    // La abertura del CORRAL está dividida por un tubo al centro: alterna entre las dos mitades.
    r.corralSide = -r.corralSide;
    const cl = r.corralSide * Math.min(0.19, F.inch(r.spec.intake.widthIn) / 2 - 0.05);
    const fwd = r.phys.outerL + F.FUEL_RADIUS + 0.03;
    start = { x: p.x + Math.cos(h) * fwd + Math.sin(h) * cl, y: F.FUEL_RADIUS + 0.01, z: p.z - Math.sin(h) * fwd + Math.cos(h) * cl };
  }
  ctx.fuel.launch(
    i,
    start,
    { x: lv.x + v.x, y: kind === 'corral' ? 0.6 : lv.y, z: lv.z + v.z },
    kind === 'corral' ? null : backspinAxis(yk, s.backspin),
    kind === 'corral' ? 0 : FLAG_SHOT,
  );
  ctx.fuel.shotBy[i] = r.index;
  ctx.fuel.shotTime[i] = ctx.time;
  ctx.fuel.shotOrigin[i * 2] = p.x;
  ctx.fuel.shotOrigin[i * 2 + 1] = p.z;
  ctx.fuel.lastTouch[i] = r.index;
  ctx.fuel.lastTouchTime[i] = ctx.time;
  r.stats.fuelShot++;
  ctx.onLaunch?.(r, i, kind);
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Distancia mínima (m) del carril de pase al centro de los HUBS (mitad del HUB + ~1 m). */
const PASS_LANE_MIN = F.HUB_SIZE / 2 + 1.0;

/**
 * Punto de caída de un pase: dentro de la ALLIANCE ZONE propia (2.4 m de la pared) y en un
 * carril a un lado de los HUBS (ambos en z = 0): con el robot centrado, el pase salía derecho
 * hacia el HUB (y su red) como si fuera a anotar.
 */
export function passTarget(a: Alliance, z: number): { x: number; y: number; z: number } {
  const side = Math.sign(z) || 1;
  const lane = side * Math.min(3, Math.max(PASS_LANE_MIN, Math.abs(z)));
  return { x: F.allianceSign(a) * (F.HALF_L - 2.4), y: 0.4, z: lane };
}

/** Error de rumbo que corrige un shooter fijo al tirar (más allá tira de frente). */
const FIXED_AIM_TOL = 6 * DEG;

