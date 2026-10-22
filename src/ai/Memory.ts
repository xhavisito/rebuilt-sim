/**
 * Memoria de la IA: aprende por prueba y error y lo recuerda entre matches (localStorage).
 *
 * - Tácticas: para cada diseño de robot y cada situación ("contexto") guarda cuántas veces probó
 *   cada táctica y qué tan bien le fue (puntos reales de su alianza). Elige con UCB1: usa la que
 *   mejor le ha funcionado, prueba de vez en cuando las demás, y deja de usar las que no sirven.
 * - Peligros: dónde se atoró o cometió faltas (celdas de 1 m): después los evita.
 * - Ritmo: FUEL por segundo que de verdad anota con su HUB activo (para decidir si trepar).
 *
 * Arranca con el "playbook" de fábrica (lo aprendido en el entrenamiento, `playbook.json`) y lo
 * que aprende el jugador en su navegador se suma encima. Sin Three.js ni Rapier.
 */
import type { Rng } from '../core/rng';

export interface ArmStat {
  /** Veces que se probó. */
  n: number;
  /** Recompensa promedio (puntos). */
  mean: number;
}

export interface RobotMemory {
  /** contexto → táctica → estadística */
  tactics: Record<string, Record<string, ArmStat>>;
  /** celda "x,z" (m, redondeado) → peso de peligro */
  hazards: Record<string, number>;
  /** FUEL/s anotado con el HUB activo (promedio móvil) y cuántos matches lo midieron. */
  rate: { value: number; n: number };
  matches: number;
}

export interface MemoryData {
  v: 1;
  robots: Record<string, RobotMemory>;
}

const KEY = 'rebuilt-sim.ai-memory.v1';
/** El playbook de fábrica pesa como mucho esto (para que lo propio se imponga pronto). */
const PRIOR_CAP = 8;

const emptyRobot = (): RobotMemory => ({ tactics: {}, hazards: {}, rate: { value: 0, n: 0 }, matches: 0 });

const cell = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`;

export class AiMemory {
  /** Lo aprendido en este navegador (se guarda). */
  readonly data: MemoryData;

  constructor(
    /** Playbook de fábrica (entrenamiento): solo se lee. */
    private prior: MemoryData | null = null,
    data?: MemoryData,
    private persist = true,
  ) {
    this.data = data ?? (persist ? AiMemory.load() : { v: 1, robots: {} });
  }

  static load(): MemoryData {
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      const d = raw ? (JSON.parse(raw) as MemoryData) : null;
      if (d && d.v === 1 && d.robots) return d;
    } catch {
      /* sin almacenamiento */
    }
    return { v: 1, robots: {} };
  }

  save(): void {
    if (!this.persist) return;
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* sin almacenamiento */
    }
  }

  /** Borra lo aprendido en este navegador (el playbook de fábrica se queda). */
  reset(): void {
    this.data.robots = {};
    this.save();
  }

  private robot(id: string): RobotMemory {
    return (this.data.robots[id] ??= emptyRobot());
  }

  /** Estadística combinada (playbook + propia) de una táctica. */
  arm(id: string, ctx: string, tactic: string): ArmStat {
    const own = this.data.robots[id]?.tactics[ctx]?.[tactic];
    const pr = this.prior?.robots[id]?.tactics[ctx]?.[tactic] ?? this.prior?.robots['*']?.tactics[ctx]?.[tactic];
    const pn = pr ? Math.min(PRIOR_CAP, pr.n) : 0;
    const on = own?.n ?? 0;
    const n = pn + on;
    if (!n) return { n: 0, mean: 0 };
    return { n, mean: ((pr?.mean ?? 0) * pn + (own?.mean ?? 0) * on) / n };
  }

  /**
   * Elige una táctica (UCB1): la de mejor promedio más un bono por probar lo poco probado.
   * `heuristic` = valor esperado de cada táctica antes de tener datos (el criterio experto).
   * `explore` = probabilidad de probar una al azar (más alta en el entrenamiento).
   */
  choose(id: string, ctx: string, options: string[], rng: Rng, heuristic: Record<string, number> = {}, explore = 0.05): string {
    if (!options.length) throw new Error('sin opciones');
    if (rng.next() < explore) return options[Math.floor(rng.next() * options.length) % options.length];
    const arms = options.map((o) => {
      const a = this.arm(id, ctx, o);
      // la heurística cuenta como 2 observaciones
      const h = heuristic[o] ?? 0;
      const n = a.n + 2;
      return { o, n, mean: (a.mean * a.n + h * 2) / n };
    });
    const total = arms.reduce((s, a) => s + a.n, 0);
    const c = 6; // bono de exploración en puntos
    let best = arms[0];
    let bv = -Infinity;
    for (const a of arms) {
      const v = a.mean + c * Math.sqrt(Math.log(total + 1) / a.n);
      if (v > bv) {
        bv = v;
        best = a;
      }
    }
    return best.o;
  }

  /** Resultado de haber usado una táctica (recompensa en puntos). */
  record(id: string, ctx: string, tactic: string, reward: number): void {
    if (!Number.isFinite(reward)) return;
    const t = (this.robot(id).tactics[ctx] ??= {});
    const a = (t[tactic] ??= { n: 0, mean: 0 });
    a.n++;
    // promedio con memoria larga pero que se adapta (los últimos ~30 pesan más)
    a.mean += (reward - a.mean) / Math.min(a.n, 30);
  }

  /** Marca un peligro (se atoró, falta) en (x, z): después evita esa zona. */
  addHazard(id: string, x: number, z: number, w = 1): void {
    const h = this.robot(id).hazards;
    const k = cell(x, z);
    h[k] = Math.min(10, (h[k] ?? 0) + w);
  }

  /** Costo extra (m equivalentes) de ir a (x, z) por los peligros que recuerda. */
  hazardCost(id: string, x: number, z: number): number {
    const k = cell(x, z);
    const w = (this.data.robots[id]?.hazards[k] ?? 0) + (this.prior?.robots[id]?.hazards[k] ?? 0) * 0.5;
    return Math.min(3, w * 0.5);
  }

  /** Ritmo de anotación aprendido (FUEL/s con HUB activo), o null si aún no sabe. */
  rate(id: string): number | null {
    const own = this.data.robots[id]?.rate;
    const pr = this.prior?.robots[id]?.rate;
    if (own && own.n > 0) return pr && pr.n > 0 ? (own.value * own.n + pr.value * Math.min(3, pr.n)) / (own.n + Math.min(3, pr.n)) : own.value;
    return pr && pr.n > 0 ? pr.value : null;
  }

  /** Fin de un match: actualiza el ritmo y "olvida" un poco los peligros viejos. */
  endMatch(id: string, fuelPerActiveSecond: number | null): void {
    const m = this.robot(id);
    m.matches++;
    if (fuelPerActiveSecond !== null && Number.isFinite(fuelPerActiveSecond)) {
      m.rate.n++;
      m.rate.value += (fuelPerActiveSecond - m.rate.value) / Math.min(m.rate.n, 10);
    }
    for (const k of Object.keys(m.hazards)) {
      m.hazards[k] *= 0.85;
      if (m.hazards[k] < 0.2) delete m.hazards[k];
    }
  }

  /** Copia para exportar (entrenamiento → playbook de fábrica). */
  export(): MemoryData {
    return JSON.parse(JSON.stringify(this.data)) as MemoryData;
  }
}
