/**
 * Ajustes › Control y vibración: controles conectados, prueba en vivo, sticks, gatillos,
 * vibración por evento y reasignación de botones. Todo se navega con el mismo control:
 * ↑↓ mueve el foco, ←→ cambia el valor, A activa, B vuelve.
 */
import type { App } from '../app/App';
import { BUTTON_ACTIONS, PAD_LABELS, padStyle, type ButtonAction, type PadStyle } from '../input/actions';
import { HAPTIC_GROUPS, type HapticGroup } from '../input/haptics';
import { padHaptics } from '../input/InputManager';
import { buttonDown, matchPreset, PAD_PRESETS, readSticks, rebindPad, type PadPreset } from '../input/padMath';
import { esc, type Opt } from './forms';
import { t, type TKey } from './i18n';
import { backBtn, brandbar, ic } from './chrome';
import { MenuNav } from './nav';

interface Ctx {
  app: App;
  root: HTMLElement;
  back: () => void;
  setNav: (n: MenuNav) => void;
  /** Vuelve a dibujar la pantalla (conserva el foco en `focusKey`). */
  rerender: (focusKey?: string) => void;
  focusKey?: string;
}

const STYLE_NAME: Record<PadStyle, string> = { xbox: 'Xbox', ps: 'PlayStation', generic: 'Gamepad' };

export function padButtonLabel(style: PadStyle, i: number): string {
  return PAD_LABELS[style][i] ?? `B${i + 1}`;
}

/** Dibuja la pantalla; devuelve la función que la limpia. */
export function openControllerScreen(c: Ctx): () => void {
  const { app, root } = c;
  const s = app.settings;
  const p = s.pad;
  const style = app.input.lastPadStyle;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const onoff: Opt[] = [
    { value: '1', label: t('on') },
    { value: '0', label: t('off') },
  ];
  // Fila "seg": ←→ o A cambian la opción
  const seg = (key: string, opts: Opt[], cur: string) =>
    `<div class="seg" data-nav data-key="${key}" data-cur="${esc(cur)}">${opts
      .map((o) => `<button type="button" data-v="${esc(o.value)}" class="${o.value === cur ? 'on' : ''}">${esc(o.label)}</button>`)
      .join('')}</div>`;
  const slider = (key: string, min: number, max: number, step: number, v: number) =>
    `<div class="row"><input type="range" data-nav data-key="${key}" min="${min}" max="${max}" step="${step}" value="${v}" style="flex:1"/><span data-out="${key}" style="min-width:52px;text-align:right">${pct(v)}</span></div>`;
  const preset = matchPreset(s.padBindings);
  const presetOpts: Opt[] = [
    { value: 'default', label: t('pp_default') },
    { value: 'bumpers', label: t('pp_bumpers') },
    ...(preset ? [] : [{ value: 'custom', label: t('pp_custom') }]),
  ];
  const rows = BUTTON_ACTIONS.map(
    (a) =>
      `<tr data-act="${a}"><td>${t(`a_${a}` as TKey)}</td><td>${s.padBindings[a].map((i) => `<span class="kbd">${esc(padButtonLabel(style, i))}</span>`).join('')}
      <button class="chipbtn" data-nav data-key="bind-${a}" data-rebindpad="${a}">${t('rebind')}</button></td></tr>`,
  ).join('');
  const moveStick = p.sticks === 'southpaw' ? 'R' : 'L';
  const rotStick = p.sticks === 'southpaw' ? 'L' : 'R';

  root.innerHTML = `<div class="inner">
    ${brandbar(t('settings'), backBtn('data-cback'))}
    <h1>${t('padScreen')}</h1>
    <p class="msg">${t('padScreenDesc')}</p>
    <div class="split">
      <div class="panel">
        <b>${t('padConnected')}</b>
        <div data-pads style="margin:8px 0 14px;display:flex;flex-direction:column;gap:6px"></div>
        <b>${t('padTester')}</b>
        <div class="msg" style="margin:4px 0 8px">${t('padTesterHint')}</div>
        <div class="row" style="gap:18px;align-items:center;margin-bottom:10px">
          ${stickBox('move', `${moveStick} · ${t('axisMove')}`)}${stickBox('rot', `${rotStick} · ${t('axisRotate')}`)}
        </div>
        <div data-live style="display:flex;flex-wrap:wrap;gap:4px">${BUTTON_ACTIONS.map(
          (a) => `<span class="kbd" data-live-a="${a}" style="padding:0 8px;transition:background .06s">${t(`a_${a}` as TKey)}</span>`,
        ).join('')}</div>
      </div>
      <div class="panel form">
        <h3 style="margin-top:0">${t('vibration')}</h3>
        <label>${t('vibration')}</label>${seg('vib', onoff, p.vibration ? '1' : '0')}
        <label>${t('vibStrength')}</label>${slider('vibStrength', 0.1, 1, 0.05, p.vibrationStrength)}
        <label>${t('triggerRumble')}</label>${seg('trig', onoff, p.triggerRumble ? '1' : '0')}
        ${HAPTIC_GROUPS.map((g) => `<label>${t('hapticEvents')}: ${t(`hg_${g}` as TKey)}</label>${seg(`hg-${g}`, onoff, p.haptics[g] ? '1' : '0')}`).join('')}
        <label></label><div class="row"><button class="chipbtn" data-nav data-key="test" data-test>${ic.vibrate}${t('testVibration')}</button></div>
        <h3>${t('sticks')}</h3>
        <label>${t('sticks')}</label>${seg('sticks', [{ value: 'standard', label: t('st_standard') }, { value: 'southpaw', label: t('st_southpaw') }], p.sticks)}
        <label>${t('invertRotate')}</label>${seg('invrot', onoff, p.invertRotate ? '1' : '0')}
        <label>${t('deadzone')}</label>${slider('deadzone', 0, 0.4, 0.01, p.deadzone)}
        <label>${t('curve')}</label>${seg('curve', [{ value: 'linear', label: t('c_linear') }, { value: 'quadratic', label: t('c_quadratic') }], p.curve)}
        <label>${t('triggerThreshold')}</label>${slider('trigThr', 0.05, 0.9, 0.05, p.triggerThreshold)}
      </div>
    </div>
    <div class="panel" style="margin-top:14px">
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><b>${t('padMapping')}</b>
        <div class="row" style="gap:8px;align-items:center"><span class="msg">${t('padPreset')}</span>${seg('preset', presetOpts, preset ?? 'custom')}</div></div>
      <div class="msg" style="margin:6px 0">${t('padMappingHint')}</div>
      <table class="keytable">${rows}</table>
      <div class="msg warn" data-capture style="display:none;margin-top:8px"></div>
    </div>
    <div class="actionbar"><button class="btn primary" data-nav data-key="back" data-cback>${t('back')}</button></div>
  </div>`;

  if (c.focusKey) root.querySelector<HTMLElement>(`[data-nav][data-key="${c.focusKey}"]`)?.setAttribute('data-nav-default', '');
  const cleanup: Array<() => void> = [];
  let focused: HTMLElement | null = null;
  const save = () => app.save();

  /** Aplica una opción de un "seg" (por clic, A o ←→). */
  const setSeg = (el: HTMLElement, v: string) => {
    const key = el.dataset.key!;
    el.dataset.cur = v;
    el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    const on = v === '1';
    if (key === 'vib') p.vibration = on;
    else if (key === 'trig') p.triggerRumble = on;
    else if (key === 'invrot') p.invertRotate = on;
    else if (key === 'curve') p.curve = v as typeof p.curve;
    else if (key.startsWith('hg-')) p.haptics[key.slice(3) as HapticGroup] = on;
    else if (key === 'sticks') {
      p.sticks = v as typeof p.sticks;
      save();
      return c.rerender(key); // cambian las etiquetas L/R de la prueba
    } else if (key === 'preset') {
      if (v === 'custom') return;
      s.padBindings = structuredClone(PAD_PRESETS[v as PadPreset]);
      save();
      return c.rerender(key);
    }
    save();
    // Una probadita al prender la vibración o un grupo
    if (on && (key === 'vib' || key === 'trig' || key.startsWith('hg-'))) app.input.testHaptic(app.input.lastPadIndex);
  };
  const setRange = (el: HTMLInputElement, v: number) => {
    const key = el.dataset.key!;
    el.value = String(v);
    const val = Number(el.value);
    if (key === 'vibStrength') p.vibrationStrength = val;
    else if (key === 'deadzone') p.deadzone = val;
    else if (key === 'trigThr') p.triggerThreshold = val;
    root.querySelector(`[data-out="${key}"]`)!.textContent = pct(val);
    save();
  };

  root.querySelectorAll<HTMLElement>('.seg[data-key]').forEach((g) =>
    g.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        setSeg(g, b.dataset.v!);
      }),
    ),
  );
  root.querySelectorAll<HTMLInputElement>('input[type=range][data-key]').forEach((r) => {
    r.addEventListener('input', () => setRange(r, Number(r.value)));
    r.addEventListener('change', () => {
      if (r.dataset.key === 'vibStrength') app.input.testHaptic(app.input.lastPadIndex);
    });
  });
  root.querySelectorAll<HTMLElement>('[data-cback]').forEach((b) => b.addEventListener('click', () => c.back()));
  root.querySelector('[data-test]')!.addEventListener('click', () => {
    const pads = app.input.gamepads();
    if (!pads.length) app.input.testHaptic(-1);
    for (const g of pads) app.input.testHaptic(g.index);
  });

  // ←→ y A sobre el elemento con foco
  const step = (el: HTMLElement, dir: -1 | 1) => {
    if (el instanceof HTMLInputElement && el.type === 'range') {
      setRange(el, Number(el.value) + dir * Number(el.step));
      if (el.dataset.key === 'vibStrength') app.input.testHaptic(app.input.lastPadIndex);
    } else if (el.classList.contains('seg')) {
      const vals = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).map((b) => b.dataset.v!);
      const i = vals.indexOf(el.dataset.cur ?? '');
      setSeg(el, vals[(i + dir + vals.length) % vals.length]);
    }
  };
  // A sobre un seg = siguiente opción (MenuNav llama a click())
  root.querySelectorAll<HTMLElement>('.seg[data-key]').forEach((g) => g.addEventListener('click', () => step(g, 1)));
  c.setNav(
    new MenuNav(root, {
      onBack: () => c.back(),
      onFocus: (el) => (focused = el),
      onLeftRight: (dir) => focused && step(focused, dir),
    }),
  );

  // Reasignar: el siguiente botón presionado (que no estuviera presionado ya) en cualquier control
  const cap = root.querySelector<HTMLElement>('[data-capture]')!;
  root.querySelectorAll<HTMLElement>('[data-rebindpad]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const action = btn.dataset.rebindpad as ButtonAction;
      cap.style.display = '';
      cap.textContent = `${t(`a_${action}` as TKey)}: ${t('pressPad')} (${t('padCaptureHint')})`;
      root.querySelectorAll('tr[data-act]').forEach((tr) => tr.classList.toggle('on', tr === btn.closest('tr')));
      app.input.captureOff = true;
      const held = new Set<string>();
      for (const g of app.input.gamepads()) g.buttons.forEach((b, i) => isDown(b, i) && held.add(`${g.index}:${i}`));
      const started = performance.now();
      let done = false;
      const finish = (button: number | null) => {
        done = true;
        window.clearInterval(timer);
        window.removeEventListener('keydown', onKey, true);
        // El control vuelve a navegar hasta que se suelte el botón (si no, A también haría clic)
        const release = window.setInterval(() => {
          if (app.input.gamepads().some((g) => g.buttons.some((b, i) => isDown(b, i)))) return;
          window.clearInterval(release);
          app.input.captureOff = false;
        }, 30);
        if (button !== null) {
          s.padBindings = rebindPad(s.padBindings, action, button);
          save();
          app.input.testHaptic(app.input.lastPadIndex);
        }
        c.rerender(`bind-${action}`);
      };
      const timer = window.setInterval(() => {
        if (performance.now() - started > 6000) return finish(null);
        for (const g of app.input.gamepads())
          g.buttons.forEach((b, i) => {
            const k = `${g.index}:${i}`;
            if (!isDown(b, i)) held.delete(k);
            else if (!held.has(k)) {
              app.input.lastPadIndex = g.index;
              app.input.lastPadStyle = padStyle(g.id);
              finish(i);
            }
          });
      }, 30);
      const onKey = (e: KeyboardEvent) => {
        if (e.code !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      };
      window.addEventListener('keydown', onKey, true);
      cleanup.push(() => {
        if (done) return;
        window.clearInterval(timer);
        window.removeEventListener('keydown', onKey, true);
        app.input.captureOff = false;
      });
    }),
  );

  // Prueba en vivo y lista de controles
  const padsEl = root.querySelector<HTMLElement>('[data-pads]')!;
  const live = new Map<ButtonAction, HTMLElement>();
  root.querySelectorAll<HTMLElement>('[data-live-a]').forEach((e) => live.set(e.dataset.liveA as ButtonAction, e));
  const dotMove = root.querySelector<HTMLElement>('[data-dot="move"]')!;
  const dotRot = root.querySelector<HTMLElement>('[data-dot="rot"]')!;
  let lastList = '';
  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const pads = app.input.gamepads();
    const list = pads
      .map((g) => {
        const h = padHaptics(g);
        const caps = h.rumble ? `${t('padCanRumble')}${h.triggers ? ` · ${t('padTriggers')}` : ''}` : t('padNoRumble');
        return `<div class="row" style="gap:8px;align-items:center"><span class="kbd">${g.index + 1}</span><b>${STYLE_NAME[padStyle(g.id)]}</b><span class="msg" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(g.id)}">${esc(g.id)}</span><span class="msg">${caps}</span></div>`;
      })
      .join('');
    const html = list || `<div class="msg">${t('padNone')}</div>`;
    if (html !== lastList) {
      padsEl.innerHTML = html;
      lastList = html;
    }
    let mx = 0;
    let my = 0;
    let rot = 0;
    const on = new Set<ButtonAction>();
    for (const g of pads) {
      const st = readSticks(g.axes, { deadzone: p.deadzone, curve: p.curve, layout: p.sticks, invertRotate: p.invertRotate });
      mx += st.moveX;
      my += st.moveY;
      rot += st.rotate;
      for (const a of BUTTON_ACTIONS) if (s.padBindings[a].some((i) => buttonDown(g.buttons[i], i, p.triggerThreshold))) on.add(a);
    }
    const cl = (v: number) => Math.max(-1, Math.min(1, v));
    dotMove.style.transform = `translate(${cl(mx) * 26}px, ${-cl(my) * 26}px)`;
    dotRot.style.transform = `translate(${cl(rot) * 26}px, 0)`;
    for (const [a, el] of live) {
      const v = on.has(a);
      el.style.background = v ? 'var(--accent)' : '';
      el.style.color = v ? 'var(--accent-ink)' : '';
    }
  };
  raf = requestAnimationFrame(frame);
  cleanup.push(() => cancelAnimationFrame(raf));

  return () => {
    for (const f of cleanup) f();
  };
}

function isDown(b: GamepadButton, i: number): boolean {
  // los gatillos cuentan a medio recorrido para no capturarlos por un roce
  return buttonDown(b, i, 0.5);
}

function stickBox(key: string, label: string): string {
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px"><div style="position:relative;width:64px;height:64px;border-radius:50%;border:1px solid var(--line-2);background:var(--bg-2)"><i data-dot="${key}" style="position:absolute;left:26px;top:26px;width:12px;height:12px;border-radius:50%;background:var(--accent)"></i></div><span class="msg">${esc(label)}</span></div>`;
}
