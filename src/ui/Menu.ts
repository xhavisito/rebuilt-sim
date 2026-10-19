/**
 * Pantallas de menú: principal, configuración del match, ajustes (con reasignación de
 * controles) y multijugador local (asignación de dispositivos).
 */
import type { App } from '../app/App';
import { loadRoutines } from '../auto/AutoRoutine';
import * as F from '../config/field';
import { allRobots, perimeterIn, robotById } from '../config/robots';
import { DEFAULT_SETTINGS, type Settings } from '../config/settings';
import { checkStart, defaultStart } from '../core/startRules';
import type { Alliance, StationNumber } from '../core/types';
import { AXIS_ACTIONS, BUTTON_ACTIONS, keyLabel, PAD_LABELS, type AxisAction, type ButtonAction } from '../input/actions';
import type { SlotDevice } from '../input/InputManager';
import { bind, esc, range, seg, select, type Opt } from './forms';
import { getLang, setLang, t, type TKey } from './i18n';

export type SetupMode = 'practice' | 'match';

export interface LocalPlayer {
  device: SlotDevice;
  alliance: Alliance;
  robotId: string;
}

export class Screens {
  readonly root: HTMLElement;
  private cleanup: Array<() => void> = [];

  constructor(
    private app: App,
    parent: HTMLElement,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'screen hidden';
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  hide(): void {
    this.dispose();
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
  }

  private dispose(): void {
    for (const f of this.cleanup) f();
    this.cleanup = [];
  }

  /** @param keep conserva los listeners de la pantalla actual (re-render de la misma pantalla) */
  private show(html: string, keep = false): void {
    if (!keep) this.dispose();
    this.root.innerHTML = `<div class="inner">${html}</div>`;
    this.root.classList.remove('hidden');
    this.root.scrollTop = 0;
    this.root.querySelectorAll<HTMLElement>('[data-back]').forEach((b) => b.addEventListener('click', () => this.main()));
  }

  private get s(): Settings {
    return this.app.settings;
  }

  // ------------------------------------------------------------------ principal
  main(): void {
    this.show(`
      <h1>REBUILT <span>SIM</span></h1>
      <div class="sub">FRC 2026 · REBUILT · ${t('disclaimer')}</div>
      <div class="cards">
        <button class="card-btn hero" data-go="match"><b>${t('match')}</b><span>${t('matchDesc')}</span></button>
        <button class="card-btn" data-go="practice"><b>${t('practice')}</b><span>${t('practiceDesc')}</span></button>
        <button class="card-btn" data-go="local"><b>${t('local')}</b><span>${t('localDesc')}</span></button>
        <button class="card-btn" data-go="tournament"><b>${t('tournament')}</b><span>${t('tournamentDesc')}</span></button>
        <button class="card-btn" data-go="auto"><b>${t('autoDesigner')}</b><span>${t('autoDesignerDesc')}</span></button>
        <button class="card-btn" data-go="editor"><b>${t('robotEditor')}</b><span>${t('robotEditorDesc')}</span></button>
        <button class="card-btn" data-go="settings"><b>${t('settings')}</b><span>${t('settingsDesc')}</span></button>
        <button class="card-btn" data-go="spectate"><b>${t('spectate')}</b><span>${t('spectateDesc')}</span></button>
      </div>
      <div class="footer">
        <button class="chipbtn ${getLang() === 'es' ? 'on' : ''}" data-lang="es">Español (MX)</button>
        <button class="chipbtn ${getLang() === 'en' ? 'on' : ''}" data-lang="en">English</button>
        <button class="chipbtn" data-fs>⛶ ${t('fullscreen')}</button>
        <button class="chipbtn" data-install style="display:${this.app.installPrompt ? '' : 'none'}">⬇ ${t('install')}</button>
      </div>
      <div class="footer">${t('version')} ${__APP_VERSION__} · ${t('credits')}: Three.js · Rapier · AprilTag 36h11 (AprilRobotics) · ${t('fanMade')}</div>
    `);
    const r = this.root;
    r.querySelectorAll<HTMLElement>('[data-go]').forEach((b) =>
      b.addEventListener('click', () => {
        const go = b.dataset.go!;
        if (go === 'match' || go === 'practice') this.setup(go);
        else if (go === 'local') this.local();
        else if (go === 'settings') this.settings();
        else if (go === 'tournament') this.app.openTournament();
        else if (go === 'auto') this.app.openAutoDesigner();
        else if (go === 'editor') this.app.openRobotEditor();
        else if (go === 'spectate') {
          this.hide();
          this.app.startMatch(true);
        }
      }),
    );
    r.querySelectorAll<HTMLElement>('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => {
        this.s.lang = b.dataset.lang as 'es' | 'en';
        setLang(this.s.lang);
        this.app.save();
        this.app.relabel();
        this.main();
      }),
    );
    r.querySelector('[data-fs]')!.addEventListener('click', () => this.app.toggleFullscreen());
    r.querySelector('[data-install]')!.addEventListener('click', () => this.app.install());
  }

  // ------------------------------------------------------------------ configuración del match
  setup(mode: SetupMode): void {
    const m = this.s.match;
    const robots: Opt[] = allRobots().map((r) => ({ value: r.id, label: `${r.name} (${r.teamNumber})` }));
    const routines: Opt[] = loadRoutines().map((r) => ({ value: r.id, label: r.name }));
    const isMatch = mode === 'match';
    this.show(`
      <div class="topbar"><button class="chipbtn" data-back>← ${t('back')}</button><h2>${isMatch ? t('match') : t('practice')} · ${t('matchSetup')}</h2></div>
      <div class="panel form">
        <h3>${t('robot')}</h3>
        <label>${t('robot')}</label>${select('robot', robots, m.robotId)}
        <label>${t('alliance')}</label>${seg('alliance', [{ value: 'red', label: t('red'), cls: 'red' }, { value: 'blue', label: t('blue'), cls: 'blue' }], m.alliance)}
        <label>${t('station')}</label>${seg('station', ['1', '2', '3'].map((v) => ({ value: v, label: v })), String(m.station))}
        <label>${t('startPos')}</label><div>${range('offset', -2.5, 2.5, 0.05, m.startOffset, ' m')}<div class="msg" data-g303></div></div>
        ${isMatch ? `<label>${t('autoRoutine')}</label>${select('routine', routines, m.autoRoutine)}` : ''}
        <label>${t('humanPlayer')}</label>${seg('hp', [{ value: 'ai', label: t('hp_ai') }, { value: 'player', label: t('hp_player') }], m.humanPlayer)}
        <h3>${t('matchSetup')}</h3>
        ${isMatch ? `<label>${t('difficulty')}</label>${seg('difficulty', (['easy', 'normal', 'hard', 'einstein'] as const).map((d) => ({ value: d, label: t(`d_${d}` as TKey) })), m.difficulty)}` : ''}
        <label>${t('eventType')}</label>${seg('event', (['regional', 'districtChamp', 'champs'] as const).map((e) => ({ value: e, label: t(`ev_${e}` as TKey) })), m.eventType)}
        <label>${t('fuelCount')}</label>${seg('fuel', [{ value: '504', label: '504' }, { value: '600', label: '600 (Championship)' }], String(m.fuel))}
        <label>${t('fouls')}</label>${seg('fouls', [{ value: '1', label: t('on') }, { value: '0', label: t('off') }], m.fouls ? '1' : '0')}
      </div>
      <button class="btn primary" data-start style="align-self:center;min-width:240px">${t('start')}</button>
    `);
    const check = () => {
      const spec = robotById(m.robotId);
      const halfX = F.inch(spec.lengthIn / 2 + spec.bumperIn);
      const st = defaultStart(m.alliance, m.station, halfX);
      const issues = checkStart({
        alliance: m.alliance,
        x: st.x,
        z: st.z + m.startOffset * (m.alliance === 'blue' ? 1 : -1),
        halfX,
        halfZ: F.inch(spec.widthIn / 2 + spec.bumperIn),
        heightM: F.inch(spec.heightIn),
        perimeterM: F.inch(perimeterIn(spec)),
        preload: spec.preload,
      });
      const el = this.root.querySelector<HTMLElement>('[data-g303]')!;
      el.className = `msg ${issues.length ? 'bad' : 'ok'}`;
      el.textContent = issues.length ? `G303: ${issues.map((i) => t(`g303_${i.code}` as TKey)).join(' · ')}` : `G303 ✓ ${t('startLegal')}`;
      (this.root.querySelector('[data-start]') as HTMLButtonElement).disabled = issues.length > 0;
    };
    bind(this.root, (name, v) => {
      if (name === 'robot') m.robotId = String(v);
      if (name === 'alliance') m.alliance = v as Alliance;
      if (name === 'station') m.station = Number(v) as StationNumber;
      if (name === 'offset') m.startOffset = Number(v);
      if (name === 'routine') m.autoRoutine = String(v);
      if (name === 'hp') m.humanPlayer = v as 'ai' | 'player';
      if (name === 'difficulty') m.difficulty = v as Settings['match']['difficulty'];
      if (name === 'event') m.eventType = v as Settings['match']['eventType'];
      if (name === 'fuel') m.fuel = Number(v) as 504 | 600;
      if (name === 'fouls') m.fouls = v === '1';
      this.app.save();
      check();
    });
    check();
    this.root.querySelector('[data-start]')!.addEventListener('click', () => {
      this.hide();
      if (isMatch) this.app.startMatch();
      else this.app.startPractice();
    });
  }

  // ------------------------------------------------------------------ ajustes
  settings(): void {
    const s = this.s;
    const q = (['auto', 'low', 'medium', 'high', 'ultra'] as const).map((v) => ({ value: v, label: t(`q_${v}` as TKey) }));
    const cams = (['driver', 'chase', 'top', 'broadcast'] as const).map((v) => ({ value: v, label: t(`cam_${v}` as TKey) }));
    const onoff = (on: boolean) => (on ? '1' : '0');
    const yn: Opt[] = [
      { value: '1', label: t('on') },
      { value: '0', label: t('off') },
    ];
    const style = this.app.input.lastPadStyle;
    const keyRows = [...AXIS_ACTIONS, ...BUTTON_ACTIONS]
      .map((a) => {
        const keys = s.keys[a].map((k) => `<span class="kbd">${esc(keyLabel(k))}</span>`).join('');
        const pad = (BUTTON_ACTIONS as string[]).includes(a)
          ? s.padBindings[a as ButtonAction].map((i) => `<span class="kbd">${PAD_LABELS[style][i] ?? i}</span>`).join('')
          : `<span class="kbd">${a.startsWith('move') ? 'L' : 'R'}</span>`;
        return `<tr><td>${t(`a_${a}` as TKey)}</td><td>${keys} <button class="chipbtn" data-rebind="${a}">${t('rebind')}</button></td><td>${pad} ${
          (BUTTON_ACTIONS as string[]).includes(a) ? `<button class="chipbtn" data-rebindpad="${a}">🎮</button>` : ''
        }</td></tr>`;
      })
      .join('');
    this.show(`
      <div class="topbar"><button class="chipbtn" data-back>← ${t('back')}</button><h2>${t('settings')}</h2></div>
      <div class="panel form">
        <h3>${t('general')}</h3>
        <label>${t('language')}</label>${seg('lang', [{ value: 'es', label: 'Español (MX)' }, { value: 'en', label: 'English' }], s.lang)}
        <label>${t('camera')}</label>${seg('camera', cams, s.camera)}
        <label>${t('cameraShake')}</label>${seg('shake', yn, onoff(s.cameraShake))}
        <label>${t('colorblind')}</label>${seg('cb', yn, onoff(s.colorblind))}
        <h3>${t('graphics')}</h3>
        <label>${t('quality')}</label>${seg('quality', q, s.quality)}
        <label>${t('showFps')}</label>${seg('fps', yn, onoff(s.showFps))}
        <h3>${t('driving')}</h3>
        <label>${t('fieldRelative')}</label>${seg('fieldrel', yn, onoff(s.drive.fieldRelative))}
        <label>${t('autoAim')}</label>${seg('autoaim', yn, onoff(s.drive.autoAim))}
        <label>${t('shootOnMove')}</label>${seg('som', yn, onoff(s.drive.shootOnMove))}
        <label>${t('mouseAim')}</label>${seg('mouseaim', yn, onoff(s.drive.mouseAim))}
        <h3>${t('gamepad')}</h3>
        <label>${t('deadzone')}</label>${range('deadzone', 0, 0.4, 0.01, s.pad.deadzone)}
        <label>${t('curve')}</label>${seg('curve', [{ value: 'linear', label: t('c_linear') }, { value: 'quadratic', label: t('c_quadratic') }], s.pad.curve)}
        <label>${t('vibration')}</label>${seg('vib', yn, onoff(s.pad.vibration))}
        <h3>${t('touch')}</h3>
        <label>${t('touchScale')}</label>${range('tscale', 0.6, 1.6, 0.05, s.touch.scale)}
        <label>${t('touchOpacity')}</label>${range('topacity', 0.15, 1, 0.05, s.touch.opacity)}
        <label></label><div class="row"><button class="chipbtn" data-editlayout>${t('editLayout')}</button><button class="chipbtn" data-resetlayout>${t('reset')}</button></div>
        <h3>${t('audio')}</h3>
        <label>${t('volMaster')}</label>${range('vmaster', 0, 1, 0.05, s.audio.master)}
        <label>${t('volMusic')}</label>${range('vmusic', 0, 1, 0.05, s.audio.music)}
        <label>${t('volSfx')}</label>${range('vsfx', 0, 1, 0.05, s.audio.sfx)}
        <label>${t('volVoice')}</label>${range('vvoice', 0, 1, 0.05, s.audio.voice)}
      </div>
      <div class="panel">
        <div class="row" style="justify-content:space-between"><b>${t('controls')}</b><button class="chipbtn" data-resetkeys>${t('resetBindings')}</button></div>
        <table class="keytable"><tr><td></td><td>${t('keyboard')}</td><td>${t('gamepad')}</td></tr>${keyRows}</table>
        <div class="msg warn" data-capture style="display:none"></div>
      </div>
    `);
    bind(this.root, (name, v) => {
      const b = v === '1';
      switch (name) {
        case 'lang':
          s.lang = v as 'es' | 'en';
          setLang(s.lang);
          this.app.relabel();
          this.app.save();
          this.settings();
          return;
        case 'camera':
          s.camera = v as Settings['camera'];
          break;
        case 'shake':
          s.cameraShake = b;
          break;
        case 'cb':
          s.colorblind = b;
          break;
        case 'quality':
          s.quality = v as Settings['quality'];
          this.app.applyQuality();
          break;
        case 'fps':
          s.showFps = b;
          break;
        case 'fieldrel':
          s.drive.fieldRelative = b;
          break;
        case 'autoaim':
          s.drive.autoAim = b;
          break;
        case 'som':
          s.drive.shootOnMove = b;
          break;
        case 'mouseaim':
          s.drive.mouseAim = b;
          break;
        case 'deadzone':
          s.pad.deadzone = Number(v);
          break;
        case 'curve':
          s.pad.curve = v as 'linear' | 'quadratic';
          break;
        case 'vib':
          s.pad.vibration = b;
          break;
        case 'tscale':
          s.touch.scale = Number(v);
          break;
        case 'topacity':
          s.touch.opacity = Number(v);
          break;
        case 'vmaster':
          s.audio.master = Number(v);
          break;
        case 'vmusic':
          s.audio.music = Number(v);
          break;
        case 'vsfx':
          s.audio.sfx = Number(v);
          break;
        case 'vvoice':
          s.audio.voice = Number(v);
          break;
      }
      this.app.save();
    });
    const r = this.root;
    r.querySelector('[data-editlayout]')!.addEventListener('click', () => this.app.editTouchLayout(() => this.settings()));
    r.querySelector('[data-resetlayout]')!.addEventListener('click', () => {
      s.touch.layout = {};
      this.app.save();
    });
    r.querySelector('[data-resetkeys]')!.addEventListener('click', () => {
      s.keys = structuredClone(DEFAULT_SETTINGS.keys);
      s.padBindings = structuredClone(DEFAULT_SETTINGS.padBindings);
      this.app.save();
      this.settings();
    });
    const cap = r.querySelector<HTMLElement>('[data-capture]')!;
    // Reasignar teclado: la siguiente tecla (o clic) reemplaza la asignación
    r.querySelectorAll<HTMLElement>('[data-rebind]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const action = btn.dataset.rebind as ButtonAction | AxisAction;
        cap.style.display = '';
        cap.textContent = `${t(`a_${action}` as TKey)}: ${t('pressKey')} (Esc = ${t('cancel')})`;
        this.app.input.captureOff = true;
        const onKey = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopPropagation();
          window.removeEventListener('keydown', onKey, true);
          this.app.input.captureOff = false;
          if (e.code !== 'Escape') {
            // quita la tecla de otras acciones para evitar conflictos
            for (const a of [...AXIS_ACTIONS, ...BUTTON_ACTIONS]) s.keys[a] = s.keys[a].filter((k) => k !== e.code);
            s.keys[action] = [e.code];
            this.app.save();
          }
          this.settings();
        };
        window.addEventListener('keydown', onKey, true);
        this.cleanup.push(() => {
          window.removeEventListener('keydown', onKey, true);
          this.app.input.captureOff = false;
        });
      }),
    );
    // Reasignar control: el siguiente botón presionado en cualquier gamepad
    r.querySelectorAll<HTMLElement>('[data-rebindpad]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const action = btn.dataset.rebindpad as ButtonAction;
        cap.style.display = '';
        cap.textContent = `${t(`a_${action}` as TKey)}: ${t('pressPad')}`;
        const before = new Set<string>();
        for (const p of this.app.input.gamepads()) p.buttons.forEach((b, i) => b.pressed && before.add(`${p.index}:${i}`));
        const timer = window.setInterval(() => {
          for (const p of this.app.input.gamepads())
            p.buttons.forEach((b, i) => {
              if (b.pressed && !before.has(`${p.index}:${i}`)) {
                window.clearInterval(timer);
                for (const a of BUTTON_ACTIONS) s.padBindings[a] = s.padBindings[a].filter((x) => x !== i);
                s.padBindings[action] = [i];
                this.app.save();
                this.settings();
              }
            });
        }, 50);
        this.cleanup.push(() => window.clearInterval(timer));
      }),
    );
  }

  // ------------------------------------------------------------------ multijugador local
  local(): void {
    let count = 2;
    let shared = false;
    let fill = true;
    const players: Array<LocalPlayer | null> = [null, null, null, null];
    const robots: Opt[] = allRobots().map((r) => ({ value: r.id, label: r.name }));
    const devLabel = (d: SlotDevice | undefined) =>
      !d ? t('waiting') : d.type === 'keyboard' ? `⌨ ${t('keyboard')}` : d.type === 'gamepad' ? `🎮 ${t('gamepad')} ${d.index + 1}` : `👆 ${t('touch')}`;
    let first = true;
    const render = () => {
      const rows = Array.from({ length: count }, (_, i) => {
        const p = players[i];
        const al = p?.alliance ?? (i % 2 ? 'red' : 'blue');
        return `<label>${t('playerN', { n: i + 1 })}</label>
          <div class="row"><span class="msg ${p ? 'ok' : 'warn'}" style="min-width:150px">${devLabel(p?.device)}</span>
          ${seg(`al${i}`, [{ value: 'blue', label: t('blue'), cls: 'blue' }, { value: 'red', label: t('red'), cls: 'red' }], al)}
          ${select(`rb${i}`, robots, p?.robotId ?? this.s.match.robotId)}</div>`;
      }).join('');
      this.show(`
        <div class="topbar"><button class="chipbtn" data-back>← ${t('back')}</button><h2>${t('local')}</h2></div>
        <div class="panel form">
          <label>${t('players')}</label>${seg('count', ['2', '3', '4'].map((v) => ({ value: v, label: v })), String(count))}
          <label>${t('camera')}</label>${seg('cam', [{ value: 'split', label: t('splitScreen') }, { value: 'shared', label: t('sharedCam') }], shared ? 'shared' : 'split')}
          <label>${t('fillAi')}</label>${seg('fill', [{ value: '1', label: t('on') }, { value: '0', label: t('off') }], fill ? '1' : '0')}
          <h3>${t('assignDevices')}</h3>
          ${rows}
          <label></label><div class="row"><button class="chipbtn" data-touchslot>👆 ${t('touch')}</button><button class="chipbtn" data-clear>${t('reset')}</button></div>
        </div>
        <button class="btn primary" data-start style="align-self:center;min-width:240px" ${players.slice(0, count).every(Boolean) ? '' : 'disabled'}>${t('start')}</button>
      `, !first);
      first = false;
      bind(this.root, (name, v) => {
        if (name === 'count') {
          count = Number(v);
          render();
        } else if (name === 'cam') shared = v === 'shared';
        else if (name === 'fill') fill = v === '1';
        else if (name.startsWith('al')) {
          const i = Number(name.slice(2));
          if (players[i]) players[i]!.alliance = v as Alliance;
        } else if (name.startsWith('rb')) {
          const i = Number(name.slice(2));
          if (players[i]) players[i]!.robotId = String(v);
        }
      });
      this.root.querySelector('[data-touchslot]')!.addEventListener('click', () => assign({ type: 'touch' }));
      this.root.querySelector('[data-clear]')!.addEventListener('click', () => {
        players.fill(null);
        render();
      });
      this.root.querySelector('[data-start]')!.addEventListener('click', () => {
        const list = players.slice(0, count).filter(Boolean) as LocalPlayer[];
        this.hide();
        this.app.startLocal(list, shared, fill);
      });
    };
    const assign = (d: SlotDevice) => {
      const used = players.some((p) => p && JSON.stringify(p.device) === JSON.stringify(d));
      if (used) return;
      const i = players.findIndex((p, k) => k < count && !p);
      if (i < 0) return;
      players[i] = { device: d, alliance: i % 2 ? 'red' : 'blue', robotId: this.s.match.robotId };
      render();
    };
    render();
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') return;
      if ((e.target as HTMLElement)?.tagName === 'SELECT') return;
      assign({ type: 'keyboard' });
    };
    window.addEventListener('keydown', onKey);
    const timer = window.setInterval(() => {
      for (const p of this.app.input.gamepads()) if (p.buttons.some((b) => b.pressed)) assign({ type: 'gamepad', index: p.index });
    }, 80);
    this.cleanup.push(() => {
      window.removeEventListener('keydown', onKey);
      window.clearInterval(timer);
    });
  }
}
