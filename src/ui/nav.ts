/**
 * Navegación de menús con teclado y control: ↑↓ (D-pad / stick) mueven el foco entre los
 * elementos `[data-nav]`, Enter / A los activa, Esc / B vuelve, ←→ llaman a `onLeftRight`
 * (carrusel de robots, botones segmentados…). El mouse y el táctil siguen funcionando igual.
 */
export type NavAction = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back';

export interface NavOptions {
  onBack?: () => void;
  /** ←/→ globales (p. ej. cambiar de robot). Si no se define, ←/→ mueven el foco. */
  onLeftRight?: (dir: -1 | 1) => void;
  /** Al cambiar el foco (p. ej. actualizar la descripción). */
  onFocus?: (el: HTMLElement) => void;
  /** Cuadrícula: ↑↓ saltan una fila de `cols()` elementos (←→ mueven de uno en uno). */
  cols?: () => number;
}

export class MenuNav {
  private items: HTMLElement[] = [];
  private index = 0;

  constructor(
    private root: HTMLElement,
    private opts: NavOptions = {},
  ) {
    this.refresh();
    this.root.addEventListener('mouseover', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]');
      if (el && this.items.includes(el)) this.focus(this.items.indexOf(el), false);
    });
  }

  refresh(): void {
    this.items = Array.from(this.root.querySelectorAll<HTMLElement>('[data-nav]')).filter((e) => !e.hasAttribute('disabled'));
    this.index = Math.min(this.index, Math.max(0, this.items.length - 1));
    const pre = this.items.findIndex((e) => e.dataset.navDefault !== undefined);
    if (pre >= 0) this.index = pre;
    this.focus(this.index, false);
  }

  focus(i: number, scroll = true): void {
    if (!this.items.length) return;
    this.index = (i + this.items.length) % this.items.length;
    this.items.forEach((e, k) => e.classList.toggle('focused', k === this.index));
    const el = this.items[this.index];
    if (scroll) el.scrollIntoView({ block: 'nearest' });
    this.opts.onFocus?.(el);
  }

  handle(a: NavAction): void {
    switch (a) {
      case 'up':
      case 'down': {
        const step = Math.max(1, this.opts.cols?.() ?? 1);
        const d = a === 'up' ? -step : step;
        // en cuadrícula no da la vuelta: se queda en el borde
        if (step > 1) this.focus(Math.max(0, Math.min(this.items.length - 1, this.index + d)));
        else this.focus(this.index + d);
        break;
      }
      case 'left':
      case 'right':
        if (this.opts.onLeftRight) this.opts.onLeftRight(a === 'left' ? -1 : 1);
        else this.focus(this.index + (a === 'left' ? -1 : 1));
        break;
      case 'ok':
        this.items[this.index]?.click();
        break;
      case 'back':
        this.opts.onBack?.();
        break;
    }
  }
}

/** Traduce teclas a acciones de menú (ignora campos de texto). */
export function keyToNav(e: KeyboardEvent): NavAction | null {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
    if (e.key === 'Escape') return 'back';
    return null;
  }
  switch (e.key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      return 'up';
    case 'ArrowDown':
    case 's':
    case 'S':
      return 'down';
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return 'left';
    case 'ArrowRight':
    case 'd':
    case 'D':
      return 'right';
    case 'Enter':
    case ' ':
      return 'ok';
    case 'Escape':
    case 'Backspace':
      return 'back';
  }
  return null;
}

/** Lee los gamepads y devuelve las acciones nuevas (flancos), con repetición al mantener. */
export class PadNav {
  private prev = new Map<string, boolean>();
  private hold = new Map<string, number>();

  poll(dt: number): NavAction[] {
    const out: NavAction[] = [];
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((p): p is Gamepad => !!p) : [];
    const now: Record<NavAction, boolean> = { up: false, down: false, left: false, right: false, ok: false, back: false };
    for (const p of pads) {
      const b = (i: number) => !!p.buttons[i]?.pressed;
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      now.up ||= b(12) || ay < -0.6;
      now.down ||= b(13) || ay > 0.6;
      now.left ||= b(14) || ax < -0.6;
      now.right ||= b(15) || ax > 0.6;
      now.ok ||= b(0) || b(9);
      now.back ||= b(1);
    }
    for (const a of Object.keys(now) as NavAction[]) {
      const was = this.prev.get(a) ?? false;
      if (now[a] && !was) {
        out.push(a);
        this.hold.set(a, -0.35); // retardo antes de repetir
      } else if (now[a] && (a === 'up' || a === 'down' || a === 'left' || a === 'right')) {
        const h = (this.hold.get(a) ?? 0) + dt;
        if (h > 0.12) {
          out.push(a);
          this.hold.set(a, 0);
        } else this.hold.set(a, h);
      }
      this.prev.set(a, now[a]);
    }
    return out;
  }
}
