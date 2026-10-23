/**
 * Criterio de defensa de la IA (puro, sin Three.js ni Rapier; ver pruebas en tests/defense.test.ts).
 *
 * - A quién marcar (`pickThreat`): el rival que más puntos va a meter pronto (qué tan bien anota
 *   por qué tan lleno viene), menos lo que cuesta llegar a él; conserva al que ya marca salvo que
 *   otro sea claramente más peligroso (cambiar de víctima cuesta segundos). Si nadie trae
 *   FUEL que valga la pena, no defiende.
 * - Dónde ponerse (`defenseGoal`): entre el rival y a donde va. Con anticipación, lo espera en la
 *   boca del BUMP o TRENCH por el que va a cruzar a su ALLIANCE ZONE (por ahí tiene que pasar);
 *   ya en su zona, se le pone enfrente, del lado de su HUB. Un solo robot ahí no es G419 (eso es
 *   bloquear con dos ambos BUMPS o ambos TRENCHES).
 * - Al soltar un PIN (G418) se queda enfrente sin tocarlo (`shadow`) para que el conteo termine
 *   (> 3 s separados) sin dejarle el camino libre.
 * - Esquivar defensa (`evadeSpot`): el anotador elige el punto de tiro de su zona que el defensor
 *   le tapa menos.
 */
import * as F from '../config/field';
import type { Alliance } from '../core/types';

export interface Pt {
  x: number;
  z: number;
}

export interface Mover extends Pt {
  vx: number;
  vz: number;
}

/** Carriles (Z) para cruzar la línea HUB + BUMPS + TRENCHES de una alianza. */
export function crossingLanes(canTrench: boolean): number[] {
  const bumps = [F.BUMP_CENTER_Z, -F.BUMP_CENTER_Z];
  if (!canTrench) return bumps;
  const t = F.HALF_W - F.TRENCH_CLEAR_WIDTH / 2;
  return [...bumps, t, -t];
}

/** ¿(x) ya está del lado de su ALLIANCE WALL respecto a su HUB (pasó la línea del HUB)? */
export function pastHubLine(a: Alliance, x: number): boolean {
  return (x - F.hubCenter(a).x) * F.allianceSign(a) > 0;
}

const clampField = (p: Pt): Pt => ({
  x: Math.max(-F.HALF_L + 0.6, Math.min(F.HALF_L - 0.6, p.x)),
  z: Math.max(-F.HALF_W + 0.6, Math.min(F.HALF_W - 0.6, p.z)),
});

/** Posición del rival dentro de `lead` segundos (dentro del campo). */
export function predict(v: Mover, lead: number): Pt {
  return clampField({ x: v.x + v.vx * lead, z: v.z + v.vz * lead });
}

/**
 * A dónde va un rival que lleva FUEL: a su HUB si ya cruzó; si no, a la boca (lado de la NEUTRAL
 * ZONE) del carril más a la mano para cruzar a su ALLIANCE ZONE.
 */
export function victimHeading(a: Alliance, p: Pt, canTrench: boolean): { pt: Pt; crossing: boolean } {
  const hub = F.hubCenter(a);
  if (pastHubLine(a, p.x)) return { pt: hub, crossing: false };
  const lanes = crossingLanes(canTrench);
  // el carril más cercano en Z (cruzar en diagonal cuesta poco; el rodeo, mucho)
  const z = lanes.reduce((b, l) => (Math.abs(l - p.z) < Math.abs(b - p.z) ? l : b));
  return { pt: { x: hub.x - F.allianceSign(a) * 1.25, z }, crossing: true };
}

export interface GoalOpts {
  lead: number;
  intercept: boolean;
  /** Distancia (centro a centro) a la que se pone frente al rival (≈ contacto de BUMPERS). */
  standoff: number;
  /** Se queda enfrente sin tocarlo (después de un PIN). */
  shadow: boolean;
}

/** Punto al que va el defensor para estorbar al rival `v` (de la alianza `a`). */
export function defenseGoal(a: Alliance, v: Mover, canTrench: boolean, o: GoalOpts): Pt {
  const hub = F.hubCenter(a);
  const pred = predict(v, o.lead);
  const head = o.intercept ? victimHeading(a, pred, canTrench) : { pt: hub, crossing: false };
  const dx = head.pt.x - pred.x;
  const dz = head.pt.z - pred.z;
  const dd = Math.hypot(dx, dz) || 1;
  const gap = o.shadow ? o.standoff + 1.2 : o.standoff;
  // Lejos del carril: lo espera en la boca (llega antes que él y le cierra el paso)
  if (head.crossing && dd > gap + 1.6) return clampField({ x: head.pt.x - (dx / dd) * 0.4, z: head.pt.z - (dz / dd) * 0.4 });
  let g = { x: pred.x + (dx / dd) * Math.min(gap, dd), z: pred.z + (dz / dd) * Math.min(gap, dd) };
  // nunca dentro del HUB
  const hx = g.x - hub.x;
  const hz = g.z - hub.z;
  const hd = Math.hypot(hx, hz);
  const keep = F.HUB_SIZE * 0.62 + 0.55;
  if (hd < keep) g = { x: hub.x + (hx / (hd || 1)) * keep, z: hub.z + (hz / (hd || 1)) * keep };
  return clampField(g);
}

export interface Candidate {
  index: number;
  pos: Pt;
  /** Qué tan bien anota (scouting, 0–1). */
  scoring: number;
  /** Qué tan lleno viene (0–1). */
  fill: number;
  /** No se puede defender (trepando, o cerca de su TOWER en los últimos 30 s: G420). */
  off?: boolean;
}

/**
 * Amenaza de un rival para quien lo va a defender desde `from`: lo que trae para anotar (un robot
 * vacío casi no amenaza) menos lo que cuesta llegar a él (cada metro son segundos sin estorbar).
 */
export function threatOf(c: Candidate, from: Pt): number {
  return c.scoring * (0.1 + c.fill) - 0.06 * Math.hypot(c.pos.x - from.x, c.pos.z - from.z);
}

/** Debajo de esta amenaza no vale la pena defender (mejor juntar FUEL para el siguiente SHIFT). */
export const MIN_THREAT = 0.08;

/**
 * Rival a marcar: el asignado si está (estrategia o drive coach), si no la mayor amenaza. Conserva
 * al actual salvo que otro lo supere por `hysteresis`. −1 si no hay a quién.
 */
export function pickThreat(cands: Candidate[], from: Pt, current = -1, assigned = -1, hysteresis = 0.12): number {
  const ok = cands.filter((c) => !c.off);
  if (!ok.length) return -1;
  if (assigned >= 0 && ok.some((c) => c.index === assigned)) return assigned;
  let best = ok[0];
  for (const c of ok) if (threatOf(c, from) > threatOf(best, from)) best = c;
  const cur = ok.find((c) => c.index === current);
  if (cur && threatOf(cur, from) >= Math.max(MIN_THREAT, threatOf(best, from) - hysteresis)) return cur.index;
  return threatOf(best, from) >= MIN_THREAT ? best.index : -1;
}

/** Distancia de `p` al segmento a→b. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const ux = b.x - a.x;
  const uz = b.z - a.z;
  const L = ux * ux + uz * uz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ux + (p.z - a.z) * uz) / L));
  return Math.hypot(a.x + ux * t - p.x, a.z + uz * t - p.z);
}

/**
 * Punto de tiro con menos defensa: cerca, lejos de los defensores y sin uno en el camino. El
 * actual tiene preferencia (no cambia de idea a cada rato).
 */
export function evadeSpot(me: Pt, spots: Pt[], defenders: Pt[], current: Pt | null): Pt {
  let best = spots[0];
  let bc = Infinity;
  for (const s of spots) {
    let c = Math.hypot(s.x - me.x, s.z - me.z) * 0.6;
    for (const d of defenders) {
      c += 4 * Math.max(0, 2.2 - Math.hypot(s.x - d.x, s.z - d.z));
      if (segDist(d, me, s) < 0.9) c += 2.5;
    }
    if (current && Math.hypot(s.x - current.x, s.z - current.z) < 0.3) c -= 0.8;
    if (c < bc) {
      bc = c;
      best = s;
    }
  }
  return best;
}

/** ¿Algún defensor estorba entre `me` y `spot` (o encima del punto)? */
export function blocked(me: Pt, spot: Pt, defenders: Pt[]): boolean {
  return defenders.some((d) => segDist(d, me, spot) < 1.0 || Math.hypot(d.x - spot.x, d.z - spot.z) < 1.6);
}

/**
 * ¿Un pase de `from` a `to` pasa lejos de su HUB? Un pase desde fuera de la ALLIANCE ZONE que cae
 * en su propio HUB es G407 (MAJOR): con el HUB en medio, primero se hace a un lado.
 */
export function passClear(a: Alliance, from: Pt, to: Pt, margin = 1.3): boolean {
  return segDist(F.hubCenter(a), from, to) > margin;
}
