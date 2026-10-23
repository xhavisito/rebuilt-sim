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
import { hapticCooldown, hapticPattern, type HapticEvent, type HapticSpec } from './haptics';
import { buttonDown, readSticks } from './padMath';
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
  /** Índice del último gamepad con actividad (−1 = ninguno). */
  lastPadIndex = -1;
  private lastHaptic = new Map<string, number>();
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
      this.lastPadIndex = (e as GamepadEvent).gamepad.index;
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

  private readPad(pad: Gamepad, into: PlayerInput): boolean {
    const o = this.settings.pad;
    const st = readSticks(pad.axes, { deadzone: o.deadzone, curve: o.curve, layout: o.sticks, invertRotate: o.invertRotate });
    into.moveX += st.moveX;
    into.moveY += st.moveY;
    into.rotate += st.rotate;
    let active = st.moveX !== 0 || st.moveY !== 0 || st.rotate !== 0;
    const b = this.settings.padBindings;
    for (const a of BUTTON_ACTIONS)
      for (const idx of b[a]) {
        if (buttonDown(pad.buttons[idx], idx, o.triggerThreshold)) {
          into.held[a] = true;
          active = true;
        }
      }
    // Íconos correctos en el HUD según el control usado; la vibración va a este control
    if (active) {
      this.lastPadStyle = padStyle(pad.id);
      this.lastPadIndex = pad.index;
    }
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

  /**
   * Vibración por evento del juego (ver input/haptics.ts) para el jugador `slot`: respeta los
   * ajustes, la intensidad y un tiempo mínimo entre efectos iguales.
   * @param strength 0–1 (fuerza del choque)
   */
  haptic(slot: number, ev: HapticEvent, strength = 1): void {
    const spec = hapticPattern(ev, strength, this.settings.pad);
    if (!spec || slot < 0) return;
    const key = `${slot}:${ev}`;
    const now = performance.now() / 1000;
    if (now - (this.lastHaptic.get(key) ?? -1e9) < hapticCooldown(ev)) return;
    this.lastHaptic.set(key, now);
    const s = this.slots[slot];
    if (!s) return;
    if (s.type === 'touch' || (s.type === 'any' && this.lastDevice === 'touch')) {
      if (spec.phoneMs > 0) vibratePhone(spec.phoneMs);
      return;
    }
    if (s.type === 'keyboard') return;
    let pads = this.gamepads();
    if (s.type === 'gamepad') pads = pads.filter((p) => p.index === s.index);
    // Un jugador con cualquier dispositivo: solo el último control que se usó
    else if (this.lastPadIndex >= 0 && pads.some((p) => p.index === this.lastPadIndex)) pads = pads.filter((p) => p.index === this.lastPadIndex);
    for (const p of pads) playOn(p, spec);
  }

  /** Vibración de prueba en un control (Ajustes › Control). */
  testHaptic(padIndex: number): void {
    const spec = hapticPattern('test', 1, { ...this.settings.pad, vibration: true });
    const p = this.gamepads().find((g) => g.index === padIndex);
    if (spec && p) playOn(p, spec);
    else if (spec && this.lastDevice === 'touch') vibratePhone(spec.phoneMs);
  }

  /** El mismo efecto para todos los jugadores locales (avisos del match). */
  hapticAll(ev: HapticEvent): void {
    for (let i = 0; i < this.slots.length; i++) this.haptic(i, ev);
  }

  /** ¿Hay teclas presionadas o actividad reciente? */
  get anyKey(): boolean {
    return this.keys.size > 0;
  }
}

const clamp = (v: number): number => Math.max(-1, Math.min(1, v));

type Actuator = GamepadHapticActuator & { effects?: string[]; type?: string };

/** ¿El control puede vibrar en este navegador? y ¿tiene gatillos con vibración? */
export function padHaptics(p: Gamepad): { rumble: boolean; triggers: boolean } {
  const act = (p as Gamepad & { vibrationActuator?: Actuator | null }).vibrationActuator;
  if (!act || typeof act.playEffect !== 'function') return { rumble: false, triggers: false };
  const fx = act.effects;
  return { rumble: !fx || fx.includes('dual-rumble'), triggers: !!fx?.includes('trigger-rumble') };
}

function playOn(p: Gamepad, spec: HapticSpec): void {
  const act = (p as Gamepad & { vibrationActuator?: Actuator | null }).vibrationActuator;
  if (!act?.playEffect) return;
  const caps = padHaptics(p);
  try {
    if (caps.triggers && (spec.right || spec.left)) {
      // trigger-rumble incluye los motores principales
      (act.playEffect as (t: string, p: Record<string, number>) => Promise<unknown>)('trigger-rumble', {
        duration: spec.ms,
        strongMagnitude: spec.strong,
        weakMagnitude: spec.weak,
        leftTrigger: spec.left ?? 0,
        rightTrigger: spec.right ?? 0,
      }).catch(() => {});
    } else if (spec.strong > 0 || spec.weak > 0) {
      act.playEffect('dual-rumble', { duration: spec.ms, strongMagnitude: spec.strong, weakMagnitude: spec.weak }).catch(() => {});
    }
  } catch {
    /* sin soporte */
  }
}

function vibratePhone(ms: number): void {
  try {
    navigator.vibrate?.(Math.min(ms, 200));
  } catch {
    /* sin soporte */
  }
}
