/**
 * Controles táctiles: dos joysticks flotantes (aparecen donde pones el dedo: el izquierdo
 * mueve, el derecho gira) y botones grandes semitransparentes con posición y tamaño
 * ajustables ("editar layout"). Multitouch real con Pointer Events.
 */
import type { Settings } from '../config/settings';
import { t, type TKey } from '../ui/i18n';
import type { ButtonAction } from './actions';

interface ButtonDef {
  id: string;
  action: ButtonAction;
  label: TKey;
  /** Posición por defecto en % desde la esquina inferior derecha. */
  right: number;
  bottom: number;
  size: number;
  /** true = alterna (toggle) en lugar de mantener. */
  toggle?: boolean;
}

const BUTTONS: ButtonDef[] = [
  { id: 'shoot', action: 'shoot', label: 'b_shoot', right: 3, bottom: 26, size: 92 },
  { id: 'intake', action: 'intake', label: 'b_intake', right: 15, bottom: 8, size: 78, toggle: true },
  { id: 'pass', action: 'pass', label: 'b_pass', right: 3, bottom: 6, size: 64 },
  { id: 'climb', action: 'climbUp', label: 'b_climb', right: 17, bottom: 30, size: 60 },
  { id: 'camera', action: 'cameraNext', label: 'b_camera', right: 3, bottom: 58, size: 50 },
];

export interface TouchState {
  moveX: number;
  moveY: number;
  rotate: number;
  held: Partial<Record<ButtonAction, boolean>>;
}

interface Stick {
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
  el: HTMLElement;
  knob: HTMLElement;
}

export class TouchControls {
  readonly root: HTMLElement;
  enabled = false;
  editing = false;
  state: TouchState = { moveX: 0, moveY: 0, rotate: 0, held: {} };
  private left: Stick | null = null;
  private right: Stick | null = null;
  private buttons = new Map<string, HTMLElement>();
  private toggles = new Set<ButtonAction>();
  private readonly radius = 64;

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private onSave: () => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'touch-layer';
    parent.appendChild(this.root);
    const zone = document.createElement('div');
    zone.className = 'touch-zone';
    this.root.appendChild(zone);
    zone.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e), { passive: false });
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    for (const b of BUTTONS) this.makeButton(b);
    this.applyLayout();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.root.style.display = on ? '' : 'none';
    if (!on) this.clear();
  }

  /** Muestra/oculta botones según el contexto (HP, climb…). */
  setButtonVisible(id: string, v: boolean): void {
    const el = this.buttons.get(id);
    if (el) el.style.display = v ? '' : 'none';
  }

  /** Marca el estado de un toggle (p. ej. intake encendida). */
  setToggle(action: ButtonAction, on: boolean): void {
    if (on) this.toggles.add(action);
    else this.toggles.delete(action);
    this.state.held[action] = on;
    for (const b of BUTTONS) if (b.action === action) this.buttons.get(b.id)?.classList.toggle('on', on);
  }

  clear(): void {
    this.state = { moveX: 0, moveY: 0, rotate: 0, held: {} };
    this.toggles.clear();
    this.left?.el.remove();
    this.right?.el.remove();
    this.left = this.right = null;
    for (const el of this.buttons.values()) el.classList.remove('on', 'down');
  }

  updateSettings(s: Settings): void {
    this.settings = s;
    this.applyLayout();
  }

  relabel(): void {
    for (const b of BUTTONS) {
      const el = this.buttons.get(b.id);
      if (el) el.querySelector('span')!.textContent = t(b.label);
    }
  }

  private makeButton(b: ButtonDef): void {
    const el = document.createElement('button');
    el.className = `touch-btn tb-${b.id}`;
    el.innerHTML = `<span>${t(b.label)}</span>`;
    el.setAttribute('aria-label', t(b.label));
    this.root.appendChild(el);
    this.buttons.set(b.id, el);
    let drag: { id: number; sx: number; sy: number; r: number; b: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      if (this.editing) {
        const cs = el.getBoundingClientRect();
        drag = {
          id: e.pointerId,
          sx: e.clientX,
          sy: e.clientY,
          r: window.innerWidth - cs.right,
          b: window.innerHeight - cs.bottom,
        };
        return;
      }
      if (b.toggle) {
        const on = !this.toggles.has(b.action);
        this.setToggle(b.action, on);
      } else {
        this.state.held[b.action] = true;
        el.classList.add('down');
      }
      try {
        navigator.vibrate?.(12);
      } catch {
        /* sin soporte */
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const r = drag.r - (e.clientX - drag.sx);
      const bo = drag.b - (e.clientY - drag.sy);
      el.style.right = `${Math.max(0, r)}px`;
      el.style.bottom = `${Math.max(0, bo)}px`;
    });
    const release = (e: PointerEvent) => {
      if (drag && drag.id === e.pointerId) {
        const cs = el.getBoundingClientRect();
        this.settings.touch.layout[b.id] = {
          x: ((window.innerWidth - cs.right) / window.innerWidth) * 100,
          y: ((window.innerHeight - cs.bottom) / window.innerHeight) * 100,
        };
        drag = null;
        this.onSave();
        return;
      }
      if (!b.toggle) {
        this.state.held[b.action] = false;
        el.classList.remove('down');
      }
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }

  private applyLayout(): void {
    const s = this.settings.touch;
    this.root.style.setProperty('--touch-opacity', String(s.opacity));
    for (const b of BUTTONS) {
      const el = this.buttons.get(b.id)!;
      const pos = s.layout[b.id] ?? { x: b.right, y: b.bottom };
      el.style.right = `calc(${pos.x}% + env(safe-area-inset-right, 0px))`;
      el.style.bottom = `calc(${pos.y}% + env(safe-area-inset-bottom, 0px))`;
      const size = b.size * s.scale;
      el.style.width = el.style.height = `${size}px`;
      el.style.fontSize = `${Math.max(11, size * 0.17)}px`;
    }
  }

  setEditing(on: boolean): void {
    this.editing = on;
    this.root.classList.toggle('editing', on);
  }

  private makeStick(e: PointerEvent): Stick {
    const el = document.createElement('div');
    el.className = 'stick';
    const knob = document.createElement('div');
    knob.className = 'knob';
    el.appendChild(knob);
    el.style.left = `${e.clientX}px`;
    el.style.top = `${e.clientY}px`;
    this.root.appendChild(el);
    return { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, el, knob };
  }

  private down(e: PointerEvent): void {
    if (!this.enabled || this.editing) return;
    if (e.pointerType === 'mouse') return; // el mouse usa teclado/mouse
    e.preventDefault();
    const leftSide = e.clientX < window.innerWidth / 2;
    if (leftSide && !this.left) this.left = this.makeStick(e);
    else if (!leftSide && !this.right) this.right = this.makeStick(e);
  }

  private move(e: PointerEvent): void {
    for (const st of [this.left, this.right]) {
      if (!st || st.id !== e.pointerId) continue;
      e.preventDefault();
      let dx = e.clientX - st.ox;
      let dy = e.clientY - st.oy;
      const d = Math.hypot(dx, dy);
      if (d > this.radius) {
        // El joystick "sigue" al dedo si se pasa del radio
        st.ox += (dx * (d - this.radius)) / d;
        st.oy += (dy * (d - this.radius)) / d;
        st.el.style.left = `${st.ox}px`;
        st.el.style.top = `${st.oy}px`;
        dx = e.clientX - st.ox;
        dy = e.clientY - st.oy;
      }
      st.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const nx = dx / this.radius;
      const ny = -dy / this.radius;
      if (st === this.left) {
        this.state.moveX = nx;
        this.state.moveY = ny;
      } else {
        this.state.rotate = Math.abs(nx) < 0.08 ? 0 : nx;
      }
    }
  }

  private up(e: PointerEvent): void {
    if (this.left && this.left.id === e.pointerId) {
      this.left.el.remove();
      this.left = null;
      this.state.moveX = this.state.moveY = 0;
    }
    if (this.right && this.right.id === e.pointerId) {
      this.right.el.remove();
      this.right = null;
      this.state.rotate = 0;
    }
  }
}
