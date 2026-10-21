/**
 * G303 — requisitos de inicio: BUMPERS sobre la ROBOT STARTING LINE, sin tocar el BUMP,
 * en STARTING CONFIGURATION (≤ 30 in, perímetro ≤ 110 in) y ≤ 8 FUEL precargados.
 * Geometría en 2D (vista superior); robot alineado con los ejes (rumbo 0 o π).
 */
import * as F from '../config/field';
import type { Alliance, StationNumber } from './types';

export interface StartCheckInput {
  alliance: Alliance;
  /** Centro del robot (m). */
  x: number;
  z: number;
  /** Mitades de la huella CON BUMPERS (m), a lo largo de X y de Z. */
  halfX: number;
  halfZ: number;
  heightM: number;
  perimeterM: number;
  preload: number;
}

export interface StartIssue {
  rule: 'G303';
  code: 'line' | 'bump' | 'config' | 'preload' | 'field';
}

/** Valida una posición de salida. Lista vacía = legal. */
export function checkStart(s: StartCheckInput): StartIssue[] {
  const out: StartIssue[] = [];
  const sgn = F.allianceSign(s.alliance);
  // Trabajamos en coordenadas "azules" (rotando 180° si es rojo)
  const x = sgn === -1 ? s.x : -s.x;
  const z = sgn === -1 ? s.z : -s.z;
  const lineFar = F.STARTING_LINE_X_BLUE; // borde de la zona
  const lineNear = lineFar - F.TAPE_WIDTH; // borde de la cinta hacia la pared
  const x0 = x - s.halfX;
  const x1 = x + s.halfX;
  // D. BUMPERS se traslapan con la línea
  if (!(x1 > lineNear && x0 < lineFar)) out.push({ rule: 'G303', code: 'line' });
  // E. no toca el BUMP
  const bx0 = F.HUB_CENTER_X_BLUE - F.BUMP_DEPTH / 2;
  const bx1 = F.HUB_CENTER_X_BLUE + F.BUMP_DEPTH / 2;
  const bz0 = F.HUB_SIZE / 2;
  const bz1 = F.HUB_SIZE / 2 + F.BUMP_WIDTH;
  const az = Math.abs(z);
  const zOverlap = az + s.halfZ > bz0 && az - s.halfZ < bz1;
  if (zOverlap && x1 > bx0 - 1e-4 && x0 < bx1) out.push({ rule: 'G303', code: 'bump' });
  // H. STARTING CONFIGURATION (R104)
  if (s.heightM > F.MAX_HEIGHT + 1e-6 || s.perimeterM > F.MAX_PERIMETER + 1e-6) out.push({ rule: 'G303', code: 'config' });
  // I. ≤ 8 FUEL
  if (s.preload > F.FUEL_MAX_PRELOAD) out.push({ rule: 'G303', code: 'preload' });
  // Dentro del campo
  if (Math.abs(z) + s.halfZ > F.HALF_W + 1e-6) out.push({ rule: 'G303', code: 'field' });
  return out;
}

/** Posición de salida por defecto: frente a su DRIVER STATION, mirando al HUB. */
export function defaultStart(
  alliance: Alliance,
  station: StationNumber,
  halfX: number,
): { x: number; z: number; heading: number } {
  const ds = F.driverStationCenter(alliance, station);
  const sgn = F.allianceSign(alliance);
  // borde frontal de los BUMPERS 5 mm dentro de la cinta
  const xBlue = F.STARTING_LINE_X_BLUE - 0.005 - halfX;
  return { x: sgn === -1 ? xBlue : -xBlue, z: ds.z, heading: alliance === 'blue' ? 0 : Math.PI };
}

/**
 * Acomoda las posiciones de salida de una alianza (z de cada robot y su media huella en Z) para
 * que no se encimen y queden dentro del campo (en la ROBOT STARTING LINE el BUMP queda delante:
 * cualquier z es legal, G303 E): mueve lo mínimo, en
 * orden de z. Devuelve las z nuevas en el mismo orden.
 */
export function separateStarts(items: Array<{ z: number; halfZ: number }>, gap = 0.06): number[] {
  const lim = (h: number) => F.HALF_W - h - 0.02;
  const idx = items.map((_, i) => i).sort((a, b) => items[a].z - items[b].z);
  const z = items.map((it) => Math.max(-lim(it.halfZ), Math.min(lim(it.halfZ), it.z)));
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let k = 1; k < idx.length; k++) {
      const a = idx[k - 1];
      const b = idx[k];
      const need = items[a].halfZ + items[b].halfZ + gap;
      if (z[b] - z[a] < need - 1e-6) {
        // reparte el empuje; contra la pared se recorre todo el otro
        const d = need - (z[b] - z[a]);
        let nb = z[b] + d / 2;
        let na = z[a] - d / 2;
        if (nb > lim(items[b].halfZ)) {
          na -= nb - lim(items[b].halfZ);
          nb = lim(items[b].halfZ);
        }
        if (na < -lim(items[a].halfZ)) {
          nb += -lim(items[a].halfZ) - na;
          na = -lim(items[a].halfZ);
        }
        z[a] = na;
        z[b] = nb;
        moved = true;
      }
    }
    if (!moved) break;
    idx.sort((a, b) => z[a] - z[b]);
  }
  return z;
}
