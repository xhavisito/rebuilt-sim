/**
 * Climb en la TOWER (§5.8, §6.5.2). El robot se engancha en uno de tres puestos de su
 * TOWER (frente de los UPRIGHTS, o a cada lado sobre los 5.875 in que sobresalen los RUNGS)
 * y sube como cuerpo cinemático mientras se mantiene el botón. Las alturas objetivo salen
 * de los criterios de LEVEL: BUMPERS completamente arriba del LOW / MID RUNG.
 * Un golpe fuerte durante el ascenso puede hacerlo fallar (cae al piso).
 */
import * as F from '../config/field';
import type { Rng } from '../core/rng';
import type { Alliance, TowerLevel } from '../core/types';
import type { Robot } from './Robot';

/** Altura del origen del robot (fondo de las ruedas) para cada LEVEL. */
export function levelHeight(level: TowerLevel): number {
  const low = F.RUNG_HEIGHTS.LOW + F.RUNG_OD / 2;
  const mid = F.RUNG_HEIGHTS.MID + F.RUNG_OD / 2;
  switch (level) {
    case 0:
      return 0;
    case 1:
      return 0.14; // ya no toca alfombra ni TOWER BASE
    case 2:
      return low + 0.05 - F.BUMPER_ZONE_LOW;
    case 3:
      return mid + 0.05 - F.BUMPER_ZONE_LOW;
  }
}

export interface ClimbSlot {
  alliance: Alliance;
  id: 'front' | 'left' | 'right';
  x: number;
  z: number;
  heading: number;
}

/** Ocupación de los puestos de una TOWER (índice de robot o −1). */
export type TowerOccupancy = Record<ClimbSlot['id'], number>;

/** Puestos de climb de la TOWER de una alianza para un robot de huella dada. */
export function climbSlots(a: Alliance, outerL: number, outerW: number): ClimbSlot[] {
  const tw = F.towerInfo(a);
  const f = tw.facing; // +1 azul (el campo está hacia +X)
  const upFace = tw.uprightX + f * (F.UPRIGHT_DEEP / 2);
  const sideOff = F.UPRIGHT_GAP / 2 + F.UPRIGHT_THICK + outerW - F.RUNG_OVERHANG * 0.5;
  // Frente: el robot mira hacia la pared, con su frente contra los UPRIGHTS
  const front: ClimbSlot = {
    alliance: a,
    id: 'front',
    x: upFace + f * (outerL + 0.02),
    z: tw.cz,
    heading: f > 0 ? Math.PI : 0,
  };
  // Lados: el robot queda junto al UPRIGHT, de frente al campo, bajo la punta del RUNG
  const side = (s: number, id: 'left' | 'right'): ClimbSlot => ({
    alliance: a,
    id,
    x: tw.uprightX + f * (outerL * 0.35),
    z: tw.cz + s * sideOff,
    heading: f > 0 ? 0 : Math.PI,
  });
  return [front, side(-1, 'left'), side(1, 'right')];
}

export class ClimbState {
  /** Nivel continuo (0–maxLevel). */
  progress = 0;
  slot: ClimbSlot | null = null;
  /** Interpolación hacia el puesto (0–1). */
  dock = 0;
  private startPos = { x: 0, z: 0, h: 0 };
  private occ: TowerOccupancy | null = null;
  failed = false;

  get attached(): boolean {
    return !!this.slot && this.dock >= 1;
  }

  /** Nivel actual (entero) alcanzado. */
  level(): TowerLevel {
    return Math.floor(this.progress + 1e-6) as TowerLevel;
  }

  begin(r: Robot, slot: ClimbSlot, occ: TowerOccupancy): void {
    this.slot = slot;
    this.occ = occ;
    occ[slot.id] = r.index;
    this.dock = 0;
    this.failed = false;
    const p = r.phys.curPos;
    this.startPos = { x: p.x, z: p.z, h: r.phys.heading() };
    r.climbing = true;
    r.intakeOn = false;
    r.phys.setKinematic(true);
  }

  release(r: Robot): void {
    if (this.slot && this.occ && this.occ[this.slot.id] === r.index) this.occ[this.slot.id] = -1;
    this.slot = null;
    this.progress = 0;
    this.dock = 0;
    r.climbing = false;
    r.climbHeight = 0;
    r.phys.setKinematic(false);
  }

  /** Avanza el climb. `up`/`down` = botones; `maxAllowed` = LEVEL máximo permitido ahora. */
  update(r: Robot, dt: number, up: boolean, down: boolean, maxAllowed: TowerLevel): void {
    if (!this.slot) return;
    const s = this.slot;
    const c = r.spec.climb;
    if (this.dock < 1) {
      this.dock = Math.min(1, this.dock + dt / 0.45);
    } else if (up || down) {
      // Tiempo por tramo según el diseño (L1 ≈ 2–4 s, L3 ≈ 6–10 s)
      const seg = [c.timeL1, c.timeL2 - c.timeL1, c.timeL3 - c.timeL2];
      const k = Math.min(2, Math.floor(this.progress));
      const rate = 1 / Math.max(0.5, seg[k] ?? c.timeL1);
      const top = Math.min(c.maxLevel, maxAllowed);
      if (up) this.progress = Math.min(top, this.progress + rate * dt);
      if (down) this.progress = Math.max(0, this.progress - rate * 1.5 * dt);
    }
    // Pose cinemática
    const e = ease(this.dock);
    const x = this.startPos.x + (s.x - this.startPos.x) * e;
    const z = this.startPos.z + (s.z - this.startPos.z) * e;
    let dh = s.heading - this.startPos.h;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const h = this.startPos.h + dh * e;
    const lv = Math.floor(this.progress);
    const fr = this.progress - lv;
    const y0 = levelHeight(Math.min(3, lv) as TowerLevel);
    const y1 = levelHeight(Math.min(3, lv + 1) as TowerLevel);
    const y = this.progress >= 3 ? levelHeight(3) : y0 + (y1 - y0) * ease(fr);
    r.phys.setKinematicPose(x, y + 0.002, z, h);
    // Brazo del climber: del techo del robot al RUNG del que cuelga (≤ 30 in en total, R107)
    const rung = this.progress < 1 ? F.RUNG_HEIGHTS.LOW : this.progress < 2 ? F.RUNG_HEIGHTS.MID : F.RUNG_HEIGHTS.HIGH;
    r.climbHeight = Math.max(0, Math.min(F.MAX_HEIGHT - r.phys.height + 0.3, rung - (y + r.phys.height) + 0.03)) * this.dock;
    if (this.progress <= 0 && down) this.release(r);
  }

  /** Golpe durante el ascenso: puede fallar y caer. */
  hit(r: Robot, strength: number, rng: Rng): boolean {
    if (!this.slot || this.progress <= 0.05) return false;
    const ascending = this.progress % 1 > 0.02 && this.progress % 1 < 0.98;
    const p = (ascending ? 0.6 : 0.15) * Math.min(1, strength * 1.5);
    if (rng.next() < p) {
      this.failed = true;
      this.release(r);
      return true;
    }
    return false;
  }
}

const ease = (t: number): number => t * t * (3 - 2 * t);
