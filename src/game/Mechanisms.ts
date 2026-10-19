/**
 * Mecanismos de robot: intake de piso, hopper, shooter (fijo o turret) con auto-aim
 * balístico y disparo en movimiento, pase y entrega al CORRAL.
 */
import * as F from '../config/field';
import type { Rng } from '../core/rng';
import { backspinAxis, launchVector, solveShot } from '../physics/ballistics';
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
  const x0 = r.phys.outerL - 0.04;
  const x1 = r.phys.halfL + F.inch(s.intake.extensionIn) * r.intakeDeploy + 0.06;
  const hw = F.inch(s.intake.widthIn) / 2;
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
  const from = { x: p.x, y: p.y + exitHeight(r), z: p.z };

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
      // Pase al ALLIANCE ZONE propio (o al punto del mouse)
      const sgn = F.allianceSign(r.alliance);
      const target = r.cmd.aim
        ? { x: r.cmd.aim.x, y: 0.4, z: r.cmd.aim.z }
        : { x: sgn * (F.HALF_L - 2.4), y: 0.4, z: Math.max(-3, Math.min(3, p.z)) };
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
      const d = Math.hypot(target.x - p.x, target.z - p.z);
      target.x = p.x + Math.cos(h) * d;
      target.z = p.z - Math.sin(h) * d;
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

  if (!(wantShoot || wantPass) || r.spinUp < 1 || r.shootCooldown > 0) return;
  if (ctx.fuel.robotCount(r.index) === 0) return;

  // ---- Lanzamiento
  const yawShooter = s.type === 'turret' ? h + r.turretYaw : h;
  let yaw = yawShooter;
  let pitch = solution ? solution.pitch : (s.minAngle + s.maxAngle) * 0.5 * DEG;
  let speed = solution ? solution.speed : s.maxSpeed * 0.9;
  if (kind === 'corral') {
    pitch = 0;
    speed = 2.6;
  } else if (solution && s.type === 'turret') yaw = solution.yaw;
  // Un shooter fijo solo puede tirar hacia su frente: si la solución cae fuera (±6°), dispara de frente.
  if (s.type === 'fixed' && solution && Math.abs(wrap(solution.yaw - h)) < 6 * DEG) yaw = solution.yaw;
  // Dispersión según la precisión del diseño
  const sig = 1 - s.accuracy;
  yaw += ctx.rng.gauss() * sig * 0.07;
  pitch += ctx.rng.gauss() * sig * 0.05;
  speed *= 1 + ctx.rng.gauss() * sig * 0.04;
  const i = ctx.fuel.popRobot(r.index);
  if (i === undefined) return;
  const lv = launchVector(yaw, pitch, speed);
  let start = { x: from.x + Math.cos(yaw) * 0.05, y: from.y, z: from.z - Math.sin(yaw) * 0.05 };
  if (kind === 'corral') {
    // La abertura del CORRAL está dividida por un tubo al centro: alterna entre las dos mitades.
    r.corralSide = -r.corralSide;
    const lat = r.corralSide * Math.min(0.19, F.inch(r.spec.intake.widthIn) / 2 - 0.05);
    const fwd = r.phys.outerL + F.FUEL_RADIUS + 0.03;
    start = { x: p.x + Math.cos(h) * fwd + Math.sin(h) * lat, y: F.FUEL_RADIUS + 0.01, z: p.z - Math.sin(h) * fwd + Math.cos(h) * lat };
  }
  ctx.fuel.launch(
    i,
    start,
    { x: lv.x + v.x, y: kind === 'corral' ? 0.6 : lv.y, z: lv.z + v.z },
    kind === 'corral' ? null : backspinAxis(yaw, s.backspin),
    kind === 'corral' ? 0 : FLAG_SHOT,
  );
  ctx.fuel.shotBy[i] = r.index;
  ctx.fuel.shotTime[i] = ctx.time;
  ctx.fuel.shotOrigin[i * 2] = p.x;
  ctx.fuel.shotOrigin[i * 2 + 1] = p.z;
  ctx.fuel.lastTouch[i] = r.index;
  ctx.fuel.lastTouchTime[i] = ctx.time;
  r.shootCooldown = 1 / Math.max(0.5, s.rate);
  r.stats.fuelShot++;
  ctx.onLaunch?.(r, i, kind);
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

