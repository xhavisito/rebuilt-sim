/**
 * Trayectorias de AUTO "tipo PathPlanner" (lógica pura, sin Three.js ni Rapier): la ruta es una
 * curva Bézier cúbica por tramo que pasa por los waypoints (con manijas editables), con perfil de
 * velocidad que respeta la velocidad máxima, la aceleración, la aceleración lateral en curvas, el
 * giro máximo del chasis y el BUMP (más lento encima). Todo en el marco AZUL de la rutina.
 *
 * El robot se detiene en los waypoints con acción (disparar, esperar, trepar o "detenerse") y en
 * el último; en los demás pasa sin frenar (sus cambios de INTAKE funcionan como "event markers").
 */
import * as F from '../config/field';
import type { AutoWaypoint } from './AutoRoutine';

export interface Vec {
  x: number;
  z: number;
}

export interface Pose extends Vec {
  /** rad, 0 = +X, + = antihorario visto desde arriba (dirección (cos h, −sin h) en x, z). */
  heading: number;
}

export interface TrajConstraints {
  /** Velocidad máxima (m/s). */
  maxVel: number;
  /** Aceleración/frenado máximos (m/s²). */
  maxAccel: number;
  /** Aceleración lateral máxima en curvas (m/s²). */
  maxLat: number;
  /** Giro máximo del chasis (rad/s). */
  maxOmega: number;
  /** Velocidad máxima sobre el BUMP (m/s). */
  bumpVel?: number;
  /** Tanque: el chasis mira siempre hacia donde avanza (ignora los rumbos pedidos). */
  tank?: boolean;
}

export interface TrajSample extends Pose {
  /** Tiempo desde el inicio (s). */
  t: number;
  /** Distancia recorrida (m). */
  s: number;
  /** Rapidez (m/s). */
  v: number;
  /** Dirección de avance (vector unitario). */
  tx: number;
  tz: number;
  /** Índice (en la rutina) del waypoint al que se dirige este punto. */
  wp: number;
}

export interface TrajStop {
  wp: number;
  /** Llega en t y se va en t + dwell. */
  t: number;
  dwell: number;
}

export interface Trajectory {
  samples: TrajSample[];
  stops: TrajStop[];
  length: number;
  duration: number;
}

/** ¿El robot se detiene en este waypoint? (acción que pide estar quieto, o el último). */
export function isStop(w: AutoWaypoint, last: boolean): boolean {
  return last || !!(w.shoot || w.wait || w.climb || w.stop);
}

const norm = (x: number, z: number): Vec => {
  const m = Math.hypot(x, z) || 1;
  return { x: x / m, z: z / m };
};
const angDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** Rumbo de una dirección (x, z) en el marco del campo. */
export const headingOf = (x: number, z: number): number => Math.atan2(-z, x);

/** Fracción de la distancia al vecino que mide una manija automática. */
const HANDLE = 0.38;

/**
 * Manijas de cada waypoint (offsets respecto al punto). Las que no fijó el usuario son
 * automáticas: Catmull-Rom (curva suave) al pasar, y en esquina (apuntando a cada vecino) donde se
 * detiene, para no dar vueltas de más.
 */
export function handles(start: Vec, wps: AutoWaypoint[], startOut?: Vec | null): { startOut: Vec; hin: Vec[]; hout: Vec[] } {
  const pts: Vec[] = [start, ...wps];
  const hin: Vec[] = [];
  const hout: Vec[] = [];
  wps.forEach((w, k) => {
    const i = k + 1;
    const prev = pts[i - 1];
    const next = pts[i + 1];
    const dIn = Math.hypot(w.x - prev.x, w.z - prev.z);
    const dOut = next ? Math.hypot(next.x - w.x, next.z - w.z) : 0;
    let tin: Vec;
    let tout: Vec;
    if (!next || isStop(w, false)) {
      tin = norm(w.x - prev.x, w.z - prev.z);
      tout = next ? norm(next.x - w.x, next.z - w.z) : tin;
    } else {
      tin = tout = norm(next.x - prev.x, next.z - prev.z);
    }
    hin.push(w.hin ? { ...w.hin } : { x: -tin.x * dIn * HANDLE, z: -tin.z * dIn * HANDLE });
    hout.push(w.hout ? { ...w.hout } : { x: tout.x * dOut * HANDLE, z: tout.z * dOut * HANDLE });
  });
  let so = startOut ?? null;
  if (!so) {
    const p = wps[0];
    so = p ? { x: (p.x - start.x) * HANDLE, z: (p.z - start.z) * HANDLE } : { x: 0, z: 0 };
  }
  return { startOut: so, hin, hout };
}

/** Puntos de control de cada tramo (inicio → wp0, wp0 → wp1, …). */
export function bezierSegments(start: Vec, wps: AutoWaypoint[], startOut?: Vec | null): Array<[Vec, Vec, Vec, Vec]> {
  const h = handles(start, wps, startOut);
  const out: Array<[Vec, Vec, Vec, Vec]> = [];
  let p0: Vec = start;
  let o0 = h.startOut;
  wps.forEach((w, k) => {
    out.push([p0, { x: p0.x + o0.x, z: p0.z + o0.z }, { x: w.x + h.hin[k].x, z: w.z + h.hin[k].z }, { x: w.x, z: w.z }]);
    p0 = w;
    o0 = h.hout[k];
  });
  return out;
}

function bez(b: [Vec, Vec, Vec, Vec], u: number): { p: Vec; d: Vec; dd: Vec } {
  const [a, c1, c2, d] = b;
  const v = 1 - u;
  return {
    p: { x: v * v * v * a.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * d.x, z: v * v * v * a.z + 3 * v * v * u * c1.z + 3 * v * u * u * c2.z + u * u * u * d.z },
    d: { x: 3 * v * v * (c1.x - a.x) + 6 * v * u * (c2.x - c1.x) + 3 * u * u * (d.x - c2.x), z: 3 * v * v * (c1.z - a.z) + 6 * v * u * (c2.z - c1.z) + 3 * u * u * (d.z - c2.z) },
    dd: { x: 6 * v * (c2.x - 2 * c1.x + a.x) + 6 * u * (d.x - 2 * c2.x + c1.x), z: 6 * v * (c2.z - 2 * c1.z + a.z) + 6 * u * (d.z - 2 * c2.z + c1.z) },
  };
}

const BARRIERS = [F.HUB_CENTER_X_BLUE, -F.HUB_CENTER_X_BLUE];
const onBump = (x: number, z: number): boolean => BARRIERS.some((bx) => Math.abs(x - bx) < F.BUMP_DEPTH / 2 + 0.6) && Math.abs(Math.abs(z) - F.BUMP_CENTER_Z) < F.BUMP_WIDTH / 2;

/** Paso entre muestras (m). */
const DS = 0.03;

/**
 * Genera la trayectoria desde `start` por los waypoints.
 * @param opts.firstIndex índice en la rutina de `wps[0]` (para `TrajSample.wp`)
 * @param opts.startOut manija de salida del inicio (la del waypoint anterior si es un tramo)
 * @param opts.dwell segundos que se queda en cada parada (vista previa); por defecto 0
 */
export function buildTrajectory(
  start: Pose,
  wps: AutoWaypoint[],
  c: TrajConstraints,
  opts: { firstIndex?: number; startOut?: Vec | null; dwell?: (w: AutoWaypoint, i: number) => number } = {},
): Trajectory {
  const first = opts.firstIndex ?? 0;
  const segs = bezierSegments(start, wps, opts.startOut);
  // 1) Muestreo denso por arco: posición, tangente, curvatura
  type Raw = { x: number; z: number; tx: number; tz: number; k: number; s: number; seg: number; u: number };
  const raw: Raw[] = [];
  let s = 0;
  segs.forEach((b, si) => {
    const chord = Math.hypot(b[3].x - b[0].x, b[3].z - b[0].z) + Math.hypot(b[1].x - b[0].x, b[1].z - b[0].z) + Math.hypot(b[2].x - b[3].x, b[2].z - b[3].z);
    const n = Math.max(4, Math.ceil(chord / DS));
    for (let j = si === 0 ? 0 : 1; j <= n; j++) {
      const u = j / n;
      const { p, d, dd } = bez(b, u);
      const sp = Math.hypot(d.x, d.z);
      const prev = raw[raw.length - 1];
      if (prev) s += Math.hypot(p.x - prev.x, p.z - prev.z);
      const t = sp > 1e-6 ? { x: d.x / sp, z: d.z / sp } : prev ? { x: prev.tx, z: prev.tz } : norm(b[3].x - b[0].x, b[3].z - b[0].z);
      const k = sp > 1e-6 ? Math.abs(d.x * dd.z - d.z * dd.x) / (sp * sp * sp) : 0;
      raw.push({ x: p.x, z: p.z, tx: t.x, tz: t.z, k, s, seg: si, u });
    }
  });
  if (!raw.length) raw.push({ x: start.x, z: start.z, tx: Math.cos(start.heading), tz: -Math.sin(start.heading), k: 0, s: 0, seg: 0, u: 1 });
  // 2) Rumbo: por tramo, del rumbo al inicio del tramo al pedido en su waypoint (suavizado); sin
  //    rumbo pedido (o tanque), hacia donde avanza
  const headings: number[] = new Array(raw.length);
  let h0 = start.heading;
  let segStart = 0;
  for (let i = 0; i < raw.length; i++) {
    const q = raw[i];
    if (i > 0 && q.seg !== raw[i - 1].seg) {
      h0 = headings[i - 1];
      segStart = i - 1;
    }
    const segLen = Math.max(1e-6, (segs.length ? lastOfSeg(raw, q.seg).s : 0) - raw[segStart].s);
    const f = Math.min(1, Math.max(0, (q.s - raw[segStart].s) / segLen));
    const w = wps[q.seg];
    const travel = headingOf(q.tx, q.tz);
    let h: number;
    if (c.tank || !w || w.heading === null) h = h0 + angDiff(travel, h0) * Math.min(1, f / 0.2);
    else {
      const e = f * f * (3 - 2 * f);
      h = h0 + angDiff(w.heading, h0) * e;
    }
    headings[i] = h;
  }
  // 3) Límite de velocidad por punto
  const vlim = raw.map((q, i) => {
    let v = c.maxVel;
    if (q.k > 1e-4) v = Math.min(v, Math.sqrt(c.maxLat / q.k));
    if (c.bumpVel !== undefined && onBump(q.x, q.z)) v = Math.min(v, c.bumpVel);
    if (i > 0) {
      const ds = q.s - raw[i - 1].s;
      const dh = Math.abs(angDiff(headings[i], headings[i - 1]));
      if (ds > 1e-6 && dh > 1e-6) v = Math.min(v, (c.maxOmega * 0.8 * ds) / dh);
    }
    return Math.max(0.15, v);
  });
  vlim[0] = 0;
  vlim[vlim.length - 1] = 0;
  for (let i = 1; i < raw.length; i++) {
    // paradas a media ruta: último punto de cada tramo cuyo waypoint se detiene
    const q = raw[i];
    if (q.u === 1 && wps[q.seg] && isStop(wps[q.seg], q.seg === wps.length - 1)) vlim[i] = 0;
  }
  // 4) Pasada hacia adelante (acelerar) y hacia atrás (frenar)
  const v = vlim.slice();
  for (let i = 1; i < v.length; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * c.maxAccel * (raw[i].s - raw[i - 1].s)));
  for (let i = v.length - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * c.maxAccel * (raw[i + 1].s - raw[i].s)));
  // 5) Tiempo, con las esperas en las paradas
  const samples: TrajSample[] = [];
  const stops: TrajStop[] = [];
  let t = 0;
  for (let i = 0; i < raw.length; i++) {
    const q = raw[i];
    if (i > 0) {
      const ds = q.s - raw[i - 1].s;
      const vm = (v[i] + v[i - 1]) / 2;
      t += ds > 0 ? ds / Math.max(vm, 0.05) : 0;
    }
    const smp: TrajSample = { t, s: q.s, x: q.x, z: q.z, v: v[i], tx: q.tx, tz: q.tz, heading: headings[i], wp: first + q.seg };
    samples.push(smp);
    const w = wps[q.seg];
    if (w && q.u === 1 && isStop(w, q.seg === wps.length - 1)) {
      const dwell = opts.dwell?.(w, first + q.seg) ?? 0;
      stops.push({ wp: first + q.seg, t, dwell });
      if (dwell > 0) {
        t += dwell;
        samples.push({ ...smp, t, wp: first + q.seg + 1 });
      }
    }
  }
  return { samples, stops, length: s, duration: t };
}

function lastOfSeg<T extends { seg: number }>(raw: T[], seg: number): T {
  // las muestras están ordenadas por tramo: búsqueda binaria del último de `seg`
  let lo = 0;
  let hi = raw.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (raw[mid].seg <= seg) lo = mid;
    else hi = mid - 1;
  }
  return raw[lo];
}

/** Muestra interpolada en el tiempo t (se queda en el final después de `duration`). */
export function sampleAt(tr: Trajectory, t: number): TrajSample {
  const S = tr.samples;
  if (t <= S[0].t) return S[0];
  if (t >= S[S.length - 1].t) return S[S.length - 1];
  let lo = 0;
  let hi = S.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (S[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = S[lo];
  const b = S[hi];
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  return {
    t,
    s: a.s + (b.s - a.s) * f,
    x: a.x + (b.x - a.x) * f,
    z: a.z + (b.z - a.z) * f,
    v: a.v + (b.v - a.v) * f,
    tx: a.tx + (b.tx - a.tx) * f,
    tz: a.tz + (b.tz - a.tz) * f,
    heading: a.heading + angDiff(b.heading, a.heading) * f,
    wp: a.wp,
  };
}

/** Velocidades del perfil para un robot (lo mismo en el diseñador y en el match). */
export function constraintsFor(
  spec: { maxSpeed: number; maxAccel: number; traction: number; maxOmega: number; drivetrain: string },
  speedFrac = 0.85,
): TrajConstraints {
  // La tracción (μ·g) limita la aceleración real; se deja margen para que el robot alcance la
  // referencia aunque lo frenen el FUEL o un empujón
  const grip = Math.min(spec.maxAccel, spec.traction * 9.81);
  return {
    maxVel: spec.maxSpeed * Math.max(0.2, Math.min(1, speedFrac)) * 0.95,
    maxAccel: grip * 0.55,
    maxLat: grip * 0.5,
    maxOmega: Math.min(spec.maxOmega, 5),
    bumpVel: 2.4,
    tank: spec.drivetrain === 'tank',
  };
}

export type PathIssue = 'hub' | 'trench' | 'wall' | 'tower' | 'center';

/**
 * Choques de la ruta con el campo (marco azul): el robot se aproxima con un círculo de radio
 * `radius`. Devuelve, por muestra, el problema (o null).
 */
export function pathIssues(samples: Vec[], radius: number, fitsTrench: boolean, halfLength = radius): Array<PathIssue | null> {
  const tw = F.towerInfo('blue');
  const solidZ0 = F.TRENCH_INNER_Z;
  const solidZ1 = F.HALF_W - F.TRENCH_CLEAR_WIDTH;
  return samples.map(({ x, z }) => {
    if (Math.abs(x) > F.HALF_L - radius + 0.02 || Math.abs(z) > F.HALF_W - radius + 0.02) return 'wall';
    // G403: el robot entero del otro lado de la CENTER LINE
    if (x - halfLength > F.CENTER_LINE_X) return 'center';
    for (const hx of BARRIERS) {
      const dx = Math.abs(x - hx);
      if (dx < F.HUB_SIZE / 2 + radius && Math.abs(z) < F.HUB_SIZE / 2 + radius * 0.6) return 'hub';
      if (dx < F.TRENCH_DEPTH / 2 + radius * 0.8) {
        const az = Math.abs(z);
        if (az > solidZ0 - radius * 0.3 && az < solidZ1 + radius * 0.8) return 'trench';
        if (!fitsTrench && az >= solidZ1) return 'trench';
      }
    }
    // UPRIGHTS de la TOWER
    for (const s of [-1, 1]) {
      const uz = tw.cz + s * (F.UPRIGHT_GAP / 2 + F.UPRIGHT_THICK / 2);
      if (Math.abs(x - tw.uprightX) < radius * 0.8 && Math.abs(z - uz) < radius * 0.8) return 'tower';
    }
    return null;
  });
}
