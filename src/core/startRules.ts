/**
 * Posiciones de salida: frente a la DRIVER STATION, con los BUMPERS en la ROBOT STARTING LINE.
 * El simulador no valida G303 (a pedido): cualquier posición a lo largo de la línea vale.
 */
import * as F from '../config/field';
import type { Alliance, StationNumber } from './types';

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
 * cualquier z queda libre del BUMP): mueve lo mínimo, en
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
