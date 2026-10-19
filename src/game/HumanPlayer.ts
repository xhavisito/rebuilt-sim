/**
 * HUMAN PLAYER en el OUTPOST (§5.9.2, G425, G427).
 * - Abre/cierra la CHUTE DOOR: el FUEL de la CHUTE (15°) sale al campo por la abertura de
 *   31.8 × 7 in a 28.1 in de altura.
 * - Pasa FUEL del CORRAL a la CHUTE (capacidad ≈ 25) y puede tener hasta 2 en la mano.
 * - Lanza FUEL por encima de la ALLIANCE WALL desde la OUTPOST AREA: al campo, a un robot o
 *   directo al HUB (si entra al HUB activo cuenta 1 punto). Alcance y precisión limitados,
 *   ≈ 1 FUEL cada 0.8–1.2 s.
 */
import * as F from '../config/field';
import type { Rng } from '../core/rng';
import type { Alliance } from '../core/types';
import { launchVector, solveShot } from '../physics/ballistics';
import { FLAG_HP_THROW, FuelState, type FuelSystem } from '../physics/FuelSystem';

const DEG = Math.PI / 180;
const HAND_MAX = 2;

export interface HpContext {
  fuel: FuelSystem;
  rng: Rng;
  time: number;
  /** ¿El HUB propio cuenta FUEL ahora (o dentro de ~1 s, contando el vuelo)? */
  hubWillCount: boolean;
  /** Distancia del robot propio más cercano a la salida de la CHUTE y si tiene espacio. */
  robotNearChute: boolean;
  /** Precisión 0–1 (dificultad). */
  accuracy: number;
}

export class HumanPlayer {
  doorOpen = false;
  /** Segundos con exceso de FUEL en el OUTPOST (para G427). */
  excessTime = 0;
  thrown = 0;
  private releaseAcc = 0;
  private loadAcc = 0;
  private throwCooldown = 0;

  constructor(
    readonly alliance: Alliance,
    readonly control: 'ai' | 'player',
  ) {}

  private get ownerId(): number {
    return this.alliance === 'red' ? 0 : 1;
  }

  /** Dirección hacia el campo (en X) desde la pared de esta alianza. */
  private get inward(): number {
    return -F.allianceSign(this.alliance);
  }

  toggleDoor(): void {
    this.doorOpen = !this.doorOpen;
  }

  update(dt: number, ctx: HpContext): void {
    const f = ctx.fuel;
    const a = this.alliance;
    this.throwCooldown = Math.max(0, this.throwCooldown - dt);
    if (this.control === 'ai') this.think(ctx);

    // ---- CHUTE DOOR abierta: el FUEL rueda por la rampa y sale al campo
    if (this.doorOpen && f.chute[a].length) {
      this.releaseAcc += dt;
      if (this.releaseAcc >= 0.22) {
        this.releaseAcc = 0;
        const i = f.chute[a].shift()!;
        const o = F.outpostInfo(a);
        const across = (ctx.rng.next() - 0.5) * 0.5;
        f.launch(
          i,
          { x: o.x + this.inward * (F.FUEL_RADIUS + 0.03), y: F.CHUTE_OPEN_BOTTOM + F.FUEL_RADIUS + 0.01, z: o.z + across },
          { x: this.inward * ctx.rng.range(1.3, 1.9), y: -0.2, z: across * 0.4 },
          null,
          0,
        );
      }
    }

    // ---- Del CORRAL a la CHUTE (manos del HUMAN PLAYER)
    this.loadAcc += dt;
    if (this.loadAcc >= 0.85) {
      this.loadAcc = 0;
      if (f.corral[a].length && f.chute[a].length < F.CHUTE_CAPACITY && !this.doorOpen) {
        const i = f.corral[a].shift()!;
        f.state[i] = FuelState.Chute;
        f.owner[i] = this.ownerId;
        f.chute[a].push(i);
      } else if (f.corral[a].length > F.CORRAL_CAPACITY && f.hand[a].length < HAND_MAX) {
        // exceso: lo toma en la mano para meterlo al campo
        const i = f.corral[a].shift()!;
        f.state[i] = FuelState.Hand;
        f.hand[a].push(i);
      }
    }

    // ---- G427: CHUTE y CORRAL llenos y más de 2 en la mano (o exceso sin meter)
    const excess = f.chute[a].length >= F.CHUTE_CAPACITY && f.corral[a].length > F.CORRAL_CAPACITY;
    this.excessTime = excess ? this.excessTime + dt : 0;
  }

  /** Lanza un FUEL hacia `target` (por defecto, el HUB propio). Devuelve true si lanzó. */
  throwFuel(ctx: HpContext, target?: { x: number; y: number; z: number }): boolean {
    if (this.throwCooldown > 0) return false;
    const f = ctx.fuel;
    const a = this.alliance;
    const src = f.hand[a].length ? f.hand[a] : f.corral[a].length ? f.corral[a] : f.chute[a];
    if (!src.length) return false;
    const o = F.outpostInfo(a);
    // De pie en la OUTPOST AREA, detrás de la pared, mano arriba (~2 m)
    const from = { x: o.x - this.inward * 0.55, y: 2.0, z: o.z - (a === 'blue' ? 0.4 : -0.4) };
    const c = F.hubCenter(a);
    const tgt = target ?? { x: c.x, y: F.HUB_RIM_HEIGHT + 0.12, z: c.z };
    const sol = solveShot({ from, target: tgt, minAngle: 25 * DEG, maxAngle: 65 * DEG, maxSpeed: 11, spin: 0, minDescent: target ? 0 : 25 * DEG });
    if (!sol) return false;
    const i = src.shift()!;
    const sig = 1 - ctx.accuracy;
    // Un lanzamiento humano nunca es perfecto: dispersión base + según precisión
    const v = launchVector(
      sol.yaw + ctx.rng.gauss() * (0.02 + sig * 0.12),
      sol.pitch + ctx.rng.gauss() * (0.015 + sig * 0.08),
      sol.speed * (1 + ctx.rng.gauss() * (0.02 + sig * 0.08)),
    );
    f.launch(i, from, v, null, FLAG_HP_THROW);
    f.shotBy[i] = -1;
    f.shotTime[i] = ctx.time;
    this.throwCooldown = ctx.rng.range(0.8, 1.2);
    this.thrown++;
    return true;
  }

  /** Política simple de la IA del HUMAN PLAYER. */
  private think(ctx: HpContext): void {
    const f = ctx.fuel;
    const a = this.alliance;
    // Abre la puerta cuando un robot propio espera frente a la CHUTE
    this.doorOpen = ctx.robotNearChute && f.chute[a].length > 0;
    // Lanza al HUB cuando cuenta, o si hay exceso que debe entrar de inmediato (G427)
    const stock = f.hand[a].length + f.corral[a].length;
    const mustEnter = f.hand[a].length > 0 && f.corral[a].length >= F.CORRAL_CAPACITY;
    if ((ctx.hubWillCount && stock > 0) || mustEnter) this.throwFuel(ctx);
  }
}
