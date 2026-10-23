/**
 * Director de cámaras del modo espectador (lógica pura, pruebas en tests/director.test.ts):
 * decide a qué robot seguir y con qué cámara, como en una transmisión. Cada robot acumula
 * "interés" (tiros, choques, velocidad, climb en END GAME) que se desvanece en ~3 s; el
 * director corta al robot más interesante con tomas de 3.5–9 s, sin repetir la toma anterior.
 */
import type { Alliance, Phase } from '../core/types';

export type DirectorMode = 'broadcast' | 'stands' | 'third' | 'onboard' | 'top';

export interface DirectorShot {
  mode: DirectorMode;
  focus: number;
}

export interface DirectorRobot {
  speed: number;
  alliance: Alliance;
  climbing: boolean;
}

/** Duración de una toma (s). */
const MIN_HOLD = 3.5;
const MAX_HOLD = 9;
/** Peso de cada toma al cortar (la anterior no se repite). */
const WEIGHTS: Array<[DirectorMode, number]> = [
  ['third', 0.4],
  ['broadcast', 0.3],
  ['stands', 0.12],
  ['onboard', 0.1],
  ['top', 0.08],
];

export class Director {
  shot: DirectorShot = { mode: 'broadcast', focus: 0 };
  /** Segundos en la toma actual. */
  held = 0;
  private heat: number[] = [];
  private urgent = false;

  constructor(private rand: () => number = Math.random) {}

  /** Algo pasó con el robot `i` (tiro = 1, choque fuerte = 5…). */
  note(i: number, weight: number): void {
    if (i < 0) return;
    this.heat[i] = (this.heat[i] ?? 0) + weight;
    if (weight >= 5 && i !== this.shot.focus) this.urgent = true;
  }

  interest(i: number): number {
    return this.heat[i] ?? 0;
  }

  /** Avanza `dt` y devuelve la toma (cambia de objeto solo al cortar). */
  update(dt: number, robots: DirectorRobot[], phase: Phase | null, timeLeft: number): DirectorShot {
    const decay = Math.exp(-dt / 3);
    robots.forEach((r, i) => {
      let h = (this.heat[i] ?? 0) * decay + Math.min(r.speed, 5) * dt * 0.25;
      if (r.climbing && phase === 'END_GAME') h += dt * 1.5;
      this.heat[i] = h;
    });
    this.held += dt;
    if (!robots.length) return this.shot;
    // antes y después del match: toma abierta
    if (phase === null || phase === 'PRE' || phase === 'POST' || phase === 'DONE' || phase === 'AUTO_PAUSE') {
      if (this.shot.mode !== 'broadcast') this.cut({ mode: 'broadcast', focus: this.hottest(robots) });
      return this.shot;
    }
    const best = this.hottest(robots);
    const cur = this.shot.focus;
    const better = best !== cur && this.interest(best) > 2 && this.interest(best) > 1.5 * this.interest(cur);
    const due = this.held >= MAX_HOLD || (this.held >= MIN_HOLD && better) || (this.urgent && this.held >= 1.5);
    if (!due) return this.shot;
    this.urgent = false;
    // final del match: quien está subiendo a la TOWER, de cerca
    if (phase === 'END_GAME' && timeLeft < 20 && robots[best]?.climbing) return this.cut({ mode: 'third', focus: best });
    // inicio del AUTO: toma abierta para ver a los seis
    if (phase === 'AUTO' && timeLeft > 16) return this.cut({ mode: 'broadcast', focus: best });
    let mode = this.pick(this.shot.mode);
    if (mode === 'onboard' && (robots[best]?.speed ?? 0) < 1) mode = 'third';
    return this.cut({ mode, focus: best });
  }

  private cut(s: DirectorShot): DirectorShot {
    this.shot = s;
    this.held = 0;
    return s;
  }

  private hottest(robots: DirectorRobot[]): number {
    let best = this.shot.focus < robots.length ? this.shot.focus : 0;
    robots.forEach((_, i) => {
      if (this.interest(i) > this.interest(best)) best = i;
    });
    return best;
  }

  private pick(not: DirectorMode): DirectorMode {
    const opts = WEIGHTS.filter(([m]) => m !== not);
    const total = opts.reduce((s, [, w]) => s + w, 0);
    let x = this.rand() * total;
    for (const [m, w] of opts) if ((x -= w) < 0) return m;
    return opts[0][0];
  }
}
