/**
 * Capa unificada de entrada. Teclado/mouse, gamepads (Gamepad API, mapeo standard) y
 * controles táctiles funcionan al mismo tiempo. En un jugador todo se combina en el
 * slot 0; en multijugador local cada slot se asigna a un dispositivo.
 */
import type { Settings } from '../config/settings';
import {
  BUTTON_ACTIONS,
  emptyInput,
  padStyle,
  type ButtonAction,
  type DeviceKind,
  type PadStyle,
  type PlayerInput,
} from './actions';
import type { TouchControls } from './TouchControls';

export type SlotDevice =
  | { type: 'any' }
  | { type: 'keyboard' }
  | { type: 'gamepad'; index: number }
  | { type: 'touch' };

export class InputManager {
  private keys = new Set<string>();
  lastDevice: DeviceKind = 'keyboard';
  lastPadStyle: PadStyle = 'xbox';
  mouseNdc: { x: number; y: number } | null = null;
  touch: TouchControls | null = null;
  slots: SlotDevice[] = [{ type: 'any' }];
  /** Si true, los eventos de teclado no llegan al juego (p. ej. al reasignar teclas). */
  captureOff = false;
  onDeviceChange: Array<(d: DeviceKind) => void> = [];
  private globalKeys = new Map<string, () => void>();
  private prevHeld: Array<Record<ButtonAction, boolean>> = [];

  constructor(
    private settings: Settings,
    canvas: HTMLElement,
  ) {
    if (matchMedia('(pointer: coarse)').matches) this.lastDevice = 'touch';
    window.addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      if (this.captureOff) return;
      const g = this.globalKeys.get(e.code);
      if (g && !e.repeat) {
        g();
        e.preventDefault();
      }
      this.keys.add(e.code);
      this.setDevice('keyboard');
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      this.keys.add(`Mouse${e.button}`);
      this.setDevice('keyboard');
    });
    window.addEventListener('mouseup', (e) => this.keys.delete(`Mouse${e.button}`));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = canvas.getBoundingClientRect();
      this.mouseNdc = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1) };
    });
    canvas.addEventListener('pointerleave', () => (this.mouseNdc = null));
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.setDevice('touch');
    });
    window.addEventListener('gamepadconnected', (e) => {
      this.lastPadStyle = padStyle((e as GamepadEvent).gamepad.id);
      this.setDevice('gamepad');
    });
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private setDevice(d: DeviceKind): void {
    if (d === this.lastDevice) return;
    this.lastDevice = d;
    for (const cb of this.onDeviceChange) cb(d);
  }

  /** Tecla global (no reasignable), p. ej. F3 para FPS. */
  onKey(code: string, fn: () => void): void {
    this.globalKeys.set(code, fn);
  }

  updateSettings(s: Settings): void {
    this.settings = s;
  }

  gamepads(): Gamepad[] {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    return Array.from(list).filter((g): g is Gamepad => !!g && g.connected);
  }

  private keyHeld(codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  private readKeyboard(into: PlayerInput): void {
    const k = this.settings.keys;
    const x = (this.keyHeld(k.moveRight) ? 1 : 0) - (this.keyHeld(k.moveLeft) ? 1 : 0);
    const y = (this.keyHeld(k.moveUp) ? 1 : 0) - (this.keyHeld(k.moveDown) ? 1 : 0);
    const r = (this.keyHeld(k.rotRight) ? 1 : 0) - (this.keyHeld(k.rotLeft) ? 1 : 0);
    const len = Math.hypot(x, y);
    into.moveX += len > 1 ? x / len : x;
    into.moveY += len > 1 ? y / len : y;
    into.rotate += r;
    for (const a of BUTTON_ACTIONS) if (this.keyHeld(k[a])) into.held[a] = true;
    if (this.settings.drive.mouseAim && this.mouseNdc) into.mouseNdc = this.mouseNdc;
  }

  private shape(v: number): number {
    return this.settings.pad.curve === 'quadratic' ? Math.sign(v) * v * v : v;
  }

  private readPad(pad: Gamepad, into: PlayerInput): boolean {
    const dz = this.settings.pad.deadzone;
    const ax = pad.axes;
    let lx = ax[0] ?? 0;
    let ly = -(ax[1] ?? 0);
    const m = Math.hypot(lx, ly);
    if (m < dz) {
      lx = 0;
      ly = 0;
    } else {
      const n = Math.min(1, (m - dz) / (1 - dz));
      const s = this.shape(n) / m;
      lx *= s;
      ly *= s;
    }
    let rx = ax[2] ?? 0;
    rx = Math.abs(rx) < dz ? 0 : this.shape(Math.sign(rx) * Math.min(1, (Math.abs(rx) - dz) / (1 - dz)));
    into.moveX += lx;
    into.moveY += ly;
    into.rotate += rx;
    let active = m > dz || Math.abs(rx) > 0;
    const b = this.settings.padBindings;
    for (const a of BUTTON_ACTIONS)
      for (const idx of b[a]) {
        const btn = pad.buttons[idx];
        if (btn && (btn.pressed || btn.value > 0.3)) {
          into.held[a] = true;
          active = true;
        }
      }
    // Íconos correctos en el HUD según el control usado
    if (active) this.lastPadStyle = padStyle(pad.id);
    return active;
  }

  private readTouch(into: PlayerInput): void {
    const t = this.touch;
    if (!t || !t.enabled) return;
    into.moveX += t.state.moveX;
    into.moveY += t.state.moveY;
    into.rotate += t.state.rotate;
    for (const a of BUTTON_ACTIONS) if (t.state.held[a]) into.held[a] = true;
  }

  /** Lee todos los slots (llamar una vez por frame). */
  poll(): PlayerInput[] {
    const pads = this.gamepads();
    const out: PlayerInput[] = [];
    this.slots.forEach((slot, si) => {
      const inp = emptyInput(this.lastDevice);
      if (slot.type === 'any' || slot.type === 'keyboard') this.readKeyboard(inp);
      if (slot.type === 'any') {
        for (const p of pads) if (this.readPad(p, inp)) this.setDevice('gamepad');
        this.readTouch(inp);
      } else if (slot.type === 'gamepad') {
        const p = pads.find((g) => g.index === slot.index);
        if (p) this.readPad(p, inp);
        inp.device = 'gamepad';
      } else if (slot.type === 'touch') {
        this.readTouch(inp);
        inp.device = 'touch';
      }
      inp.moveX = clamp(inp.moveX);
      inp.moveY = clamp(inp.moveY);
      inp.rotate = clamp(inp.rotate);
      const prev = this.prevHeld[si];
      for (const a of BUTTON_ACTIONS) if (inp.held[a] && !(prev && prev[a])) inp.pressed.add(a);
      this.prevHeld[si] = { ...inp.held };
      out.push(inp);
    });
    return out;
  }

  /** Vibración del control (si el navegador la soporta) o del teléfono. */
  rumble(slot: number, strength: number, ms: number): void {
    if (!this.settings.pad.vibration) return;
    const s = this.slots[slot] ?? { type: 'any' };
    if (this.lastDevice === 'touch' || s.type === 'touch') {
      try {
        navigator.vibrate?.(Math.min(ms, 200));
      } catch {
        /* sin soporte */
      }
      return;
    }
    for (const p of this.gamepads()) {
      if (s.type === 'gamepad' && p.index !== s.index) continue;
      const act = (p as Gamepad & { vibrationActuator?: GamepadHapticActuator }).vibrationActuator;
      act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {});
    }
  }

  /** ¿Hay teclas presionadas o actividad reciente? */
  get anyKey(): boolean {
    return this.keys.size > 0;
  }
}

const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
