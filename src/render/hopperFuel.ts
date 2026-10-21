/**
 * Física visual del FUEL dentro del hopper de un robot con CAD (sin Rapier: solo se dibuja).
 * Cada FUEL guardado es una esfera con gravedad, choques entre ellas y contra las paredes de su
 * caja (`HopperBox`, marco WPILib del robot: Z arriba), y la inercia de la aceleración del robot
 * (al arrancar, frenar o girar se recorren). Al entrar caen desde arriba al frente (por donde los
 * mete la intake); al tirar sale el de más abajo y los de encima se acomodan.
 * Cuando todo queda quieto y el robot no acelera, deja de calcular.
 */
import { FUEL_D, slotFits, type HopperBox, type HopperSlot } from './cadRigs';

export interface HopperBall {
  box: number;
  p: [number, number, number];
  v: [number, number, number];
}

const R = FUEL_D / 2;
/** Distancia mínima entre centros: un poco menos que el diámetro (la espuma se aprieta). */
const CONTACT = FUEL_D * 0.88;
const GRAVITY = 9.81;
const RESTITUTION = 0.25;
/** Amortiguamiento (1/s): la espuma no rebota mucho. */
const DAMPING = 2.5;
const MAX_ACCEL = 14;

export class HopperFuelSim {
  readonly balls: HopperBall[] = [];
  /** Segundos que faltan antes de dormir (0 = dormido). */
  private awake = 0;
  private e = 0;

  constructor(
    private readonly boxes: HopperBox[],
    private readonly slots: HopperSlot[],
    private readonly rand: () => number = Math.random,
  ) {}

  get sleeping(): boolean {
    return this.awake <= 0;
  }

  /**
   * Ajusta cuántos FUEL hay (`n` dibujados) con la intake desplegada `e`. Los nuevos caen desde
   * la entrada; con `instant` (al cargar o reiniciar) aparecen ya acomodados en su lugar.
   */
  sync(n: number, e: number, instant = false): boolean {
    this.e = e;
    // reparto por caja: los primeros `n` lugares que caben (el mismo orden de llenado)
    const want = this.boxes.map(() => 0);
    const slotsFor: HopperSlot[][] = this.boxes.map(() => []);
    let k = 0;
    for (const sl of this.slots) {
      if (k >= n) break;
      if (!slotFits(this.boxes[sl.box], sl, e)) continue;
      want[sl.box]++;
      slotsFor[sl.box].push(sl);
      k++;
    }
    let changed = false;
    for (let b = 0; b < this.boxes.length; b++) {
      const mine = this.balls.filter((x) => x.box === b);
      for (let i = mine.length; i < want[b]; i++) {
        const p = instant ? [...slotsFor[b][i].p] : this.entry(b);
        this.balls.push({ box: b, p: p as [number, number, number], v: [0, 0, instant ? 0 : -0.6] });
        changed = true;
      }
      // sale el de más abajo (el que alimenta al shooter)
      for (let i = mine.length; i > want[b]; i--) {
        let low = -1;
        for (let j = 0; j < this.balls.length; j++) if (this.balls[j].box === b && (low < 0 || this.balls[j].p[2] < this.balls[low].p[2])) low = j;
        this.balls.splice(low, 1);
        changed = true;
      }
    }
    if (changed) this.awake = 2.5;
    return changed;
  }

  /** Punto de entrada de un FUEL nuevo: arriba y al frente de su caja. */
  private entry(b: number): [number, number, number] {
    const box = this.boxes[b];
    const top = box.max[2] - R;
    if (box.ring) {
      const [cx, cy, rr] = box.ring;
      const a = this.rand() * Math.PI * 2;
      return [cx + rr * Math.cos(a), cy + rr * Math.sin(a), top];
    }
    const hi = this.hi(box);
    const y = box.min[1] + R + this.rand() * Math.max(0, hi[1] - box.min[1] - FUEL_D);
    return [Math.max(box.min[0] + R, hi[0] - R - this.rand() * 0.05), y, top];
  }

  /** Esquina máxima de la caja con la intake desplegada `e` (crece hacia el frente). */
  private hi(box: HopperBox): [number, number, number] {
    if (!box.maxDeployed) return box.max;
    const t = this.e;
    return [box.max[0] + (box.maxDeployed[0] - box.max[0]) * t, box.max[1] + (box.maxDeployed[1] - box.max[1]) * t, box.max[2] + (box.maxDeployed[2] - box.max[2]) * t];
  }

  /**
   * Avanza `dt` con la aceleración del robot (ax, ay) en el marco del modelo (WPILib, m/s²): los
   * FUEL sienten la contraria. Devuelve false si no se movió nada (dormido).
   */
  step(dt: number, ax = 0, ay = 0): boolean {
    const am = Math.hypot(ax, ay);
    if (am > MAX_ACCEL) {
      ax *= MAX_ACCEL / am;
      ay *= MAX_ACCEL / am;
    }
    if (am > 1.2) this.awake = Math.max(this.awake, 1.0);
    if (this.awake <= 0 || dt <= 0 || !this.balls.length) return false;
    this.awake -= dt;
    const n = Math.min(4, Math.ceil(dt / 0.008));
    const h = dt / n;
    const damp = Math.max(0, 1 - DAMPING * h);
    for (let s = 0; s < n; s++) {
      for (const b of this.balls) {
        b.v[0] = (b.v[0] - ax * h) * damp;
        b.v[1] = (b.v[1] - ay * h) * damp;
        b.v[2] = (b.v[2] - GRAVITY * h) * damp;
        b.p[0] += b.v[0] * h;
        b.p[1] += b.v[1] * h;
        b.p[2] += b.v[2] * h;
      }
      // dos pasadas de relajación: choques entre FUEL y contra las paredes
      for (let it = 0; it < 2; it++) {
        this.collide();
        for (const b of this.balls) this.walls(b);
      }
    }
    return true;
  }

  private collide(): void {
    const B = this.balls;
    for (let i = 0; i < B.length; i++) {
      const a = B[i];
      for (let j = i + 1; j < B.length; j++) {
        const c = B[j];
        if (c.box !== a.box) continue;
        const dx = c.p[0] - a.p[0];
        const dy = c.p[1] - a.p[1];
        const dz = c.p[2] - a.p[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= CONTACT * CONTACT) continue;
        const d = Math.sqrt(d2) || 1e-4;
        const nx = d2 > 1e-8 ? dx / d : 0;
        const ny = d2 > 1e-8 ? dy / d : 0;
        const nz = d2 > 1e-8 ? dz / d : 1;
        const push = (CONTACT - d) / 2;
        a.p[0] -= nx * push;
        a.p[1] -= ny * push;
        a.p[2] -= nz * push;
        c.p[0] += nx * push;
        c.p[1] += ny * push;
        c.p[2] += nz * push;
        // velocidad relativa de acercamiento: se reparte (choque poco elástico)
        const vn = (c.v[0] - a.v[0]) * nx + (c.v[1] - a.v[1]) * ny + (c.v[2] - a.v[2]) * nz;
        if (vn < 0) {
          const k = (vn * (1 + RESTITUTION)) / 2;
          a.v[0] += nx * k;
          a.v[1] += ny * k;
          a.v[2] += nz * k;
          c.v[0] -= nx * k;
          c.v[1] -= ny * k;
          c.v[2] -= nz * k;
        }
      }
    }
  }

  private walls(b: HopperBall): void {
    const box = this.boxes[b.box];
    const bounce = (k: number, lo: number, hi: number) => {
      if (b.p[k] < lo) {
        b.p[k] = lo;
        if (b.v[k] < 0) b.v[k] *= -RESTITUTION;
      } else if (b.p[k] > hi) {
        b.p[k] = hi;
        if (b.v[k] > 0) b.v[k] *= -RESTITUTION;
      }
    };
    if (box.ring) {
      // anillo alrededor del spindexer: el radio se mantiene cerca del de la fila
      const [cx, cy, rr] = box.ring;
      const dx = b.p[0] - cx;
      const dy = b.p[1] - cy;
      const d = Math.hypot(dx, dy) || 1e-4;
      const w = R * 0.35;
      const target = Math.min(rr + w, Math.max(rr - w, d));
      if (target !== d) {
        b.p[0] = cx + (dx / d) * target;
        b.p[1] = cy + (dy / d) * target;
        const vr = (b.v[0] * dx + b.v[1] * dy) / d;
        b.v[0] -= (dx / d) * vr * (1 + RESTITUTION);
        b.v[1] -= (dy / d) * vr * (1 + RESTITUTION);
      }
      bounce(2, box.min[2] + R, Math.max(box.min[2] + R, box.max[2] - R));
      return;
    }
    const hi = this.hi(box);
    bounce(0, box.min[0] + R, Math.max(box.min[0] + R, hi[0] - R));
    bounce(1, box.min[1] + R, Math.max(box.min[1] + R, hi[1] - R));
    bounce(2, box.min[2] + R, Math.max(box.min[2] + R, hi[2] - R));
  }
}
