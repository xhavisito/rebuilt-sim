/**
 * Pantallas de menú: principal, configuración del match, ajustes (con reasignación de
 * controles) y multijugador local (asignación de dispositivos).
 */
import type { App } from '../app/App';
import { loadRoutines } from '../auto/AutoRoutine';
import * as F from '../config/field';
import { allRobots, fitsUnderTrench, perimeterIn, ROBOT_PRESETS, robotById, type RobotSpec } from '../config/robots';
import { DEFAULT_SETTINGS, type Settings } from '../config/settings';
import { checkStart, defaultStart } from '../core/startRules';
import type { Alliance, StationNumber } from '../core/types';
import { AXIS_ACTIONS, BUTTON_ACTIONS, keyLabel, PAD_LABELS, type AxisAction, type ButtonAction } from '../input/actions';
import type { SlotDevice } from '../input/InputManager';
import { bind, esc, range, seg, select, type Opt } from './forms';
import { getLang, setLang, t, type TKey } from './i18n';
import { keyToNav, MenuNav, PadNav, type NavOptions } from './nav';
import { RULES_CONTENT } from './rulesContent';
import type { Showroom } from '../render/Showroom';

export type SetupMode = 'practice' | 'match';

export interface LocalPlayer {
  device: SlotDevice;
  alliance: Alliance;
  robotId: string;
}

export class Screens {
  readonly root: HTMLElement;
  private cleanup: Array<() => void> = [];
  /** Navegación con teclado/control de la pantalla actual. */
  nav: MenuNav | null = null;
  private padNav = new PadNav();

  constructor(
    private app: App,
    parent: HTMLElement,
    readonly showroom: Showroom,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'screen hidden';
    parent.appendChild(this.root);
    window.addEventListener('keydown', (e) => {
      if (!this.visible || !this.nav || this.app.input.captureOff) return;
      const a = keyToNav(e);
      if (!a) return;
      e.preventDefault();
      this.nav.handle(a);
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Llamar cada frame: navegación con control y dibujo de la vitrina 3D. */
  tick(dt: number): void {
    if (!this.visible) return;
    if (this.nav) for (const a of this.padNav.poll(dt)) this.nav.handle(a);
    this.showroom.render(dt);
  }

  hide(): void {
    this.dispose();
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
  }

  private dispose(): void {
    for (const f of this.cleanup) f();
    this.cleanup = [];
    this.nav = null;
    this.showroom.unmount();
  }

  /** @param keep conserva los listeners de la pantalla actual (re-render de la misma pantalla) */
  private show(html: string, keep = false): void {
    if (!keep) this.dispose();
    this.root.innerHTML = `<div class="inner">${html}</div>`;
    this.root.classList.remove('hidden');
    this.root.scrollTop = 0;
    this.root.querySelectorAll<HTMLElement>('[data-back]').forEach((b) => b.addEventListener('click', () => this.main()));
  }

  /** Prepara la raíz para otra pantalla (editor, diseñador, torneo): limpia la anterior y deja Esc/B = volver. */
  prepare(onBack: () => void): void {
    this.dispose();
    this.root.classList.remove('hidden');
    this.root.scrollTop = 0;
    this.nav = new MenuNav(this.root, { onBack });
  }

  /** Activa la navegación con teclado/control para los elementos `[data-nav]`. */
  private enableNav(opts: NavOptions = {}): void {
    this.nav = new MenuNav(this.root, { onBack: () => this.main(), ...opts });
  }

  private get s(): Settings {
    return this.app.settings;
  }

  /** Barra superior con la marca. */
  private brandbar(ctx = '', right = ''): string {
    return `<div class="brandbar"><div class="brand">REBUILT <span>SIM</span></div>${ctx ? `<div class="ctx">${ctx}</div>` : ''}<div class="grow"></div>${right}</div>`;
  }

  // ------------------------------------------------------------------ principal
  main(): void {
    const items: Array<[string, TKey, TKey]> = [
      ['match', 'match', 'matchDesc'],
      ['practice', 'practice', 'practiceDesc'],
      ['local', 'local', 'localDesc'],
      ['tournament', 'tournament', 'tournamentDesc'],
      ['auto', 'autoDesigner', 'autoDesignerDesc'],
      ['editor', 'robotEditor', 'robotEditorDesc'],
      ['spectate', 'spectate', 'spectateDesc'],
      ['settings', 'settings', 'settingsDesc'],
    ];
    const name = this.s.driverName || '';
    this.show(`
      ${this.brandbar(
        '',
        `<button class="chipbtn ${getLang() === 'es' ? 'on' : ''}" data-lang="es">ES</button>
         <button class="chipbtn ${getLang() === 'en' ? 'on' : ''}" data-lang="en">EN</button>
         <button class="chipbtn" data-fs title="${t('fullscreen')}">⛶</button>
         <button class="chipbtn" data-install style="display:${this.app.installPrompt ? '' : 'none'}">⬇ ${t('install')}</button>`,
      )}
      <div class="mm">
        <div class="mm-left">
          <div class="mm-season">${t('season2026')}</div>
          <div class="mm-title">REBUILT</div>
          <nav class="mm-menu">
            ${items.map(([go, label, desc], i) => `<button class="mm-item" data-nav data-go="${go}" ${i === 0 ? 'data-nav-default' : ''}>${t(label)}<small>${t(desc)}</small></button>`).join('')}
          </nav>
          <div class="driver">
            <div class="avatar" data-avatar>${esc((name || 'R').slice(0, 1))}</div>
            <div><label>${t('driverName')}</label><input type="text" maxlength="24" data-driver value="${esc(name)}" placeholder="${t('driverPlaceholder')}"/></div>
          </div>
        </div>
        <div class="mm-right">
          <div class="showcase" data-showcase></div>
          <div class="robotinfo" data-robotinfo></div>
        </div>
      </div>
      <div class="mm-bottom">
        <div class="keyhints">
          <span><i class="kbd">↑↓</i> ${t('hintMove')}</span>
          <span><i class="kbd">Enter</i> ${t('hintSelect')}</span>
          <span><i class="kbd">← →</i> ${t('hintRobot')}</span>
        </div>
        <div class="footer">${t('disclaimer')} · v${__APP_VERSION__}</div>
      </div>
    `);
    const r = this.root;
    this.showroom.mount(r.querySelector<HTMLElement>('[data-showcase]')!, 2.75);
    // Clic (sin arrastrar) en la vitrina abre la galería
    {
      const sc = r.querySelector<HTMLElement>('[data-showcase]')!;
      let downX = 0;
      sc.addEventListener('pointerdown', (e) => (downX = e.clientX));
      sc.addEventListener('pointerup', (e) => {
        if (Math.abs(e.clientX - downX) < 4) this.robotPicker(() => this.main());
      });
    }
    const robots = allRobots();
    const showRobot = () => {
      let i = robots.findIndex((x) => x.id === this.s.match.robotId);
      if (i < 0) i = 0;
      const sp = robots[i];
      this.showroom.setRobot(sp, this.s.match.alliance);
      const info = r.querySelector<HTMLElement>('[data-robotinfo]')!;
      info.innerHTML = `
        <div class="statrow">
          <span class="stat">${t('maxSpeed')}<b>${sp.maxSpeed.toFixed(1)} m/s</b></span>
          <span class="stat">${t('hopper')}<b>${sp.hopperCapacity}</b></span>
          <span class="stat">SHOOTER<b>${sp.shooter.rate}/s</b></span>
          <span class="stat">TRENCH<b>${fitsUnderTrench(sp) ? '✓' : '—'}</b></span>
        </div>
        <div class="line1"><div class="num">${sp.teamNumber}</div>
          <div class="meta"><b>${esc(sp.name)}</b><span>${robotSubtitle(sp)}</span></div></div>
        <div class="nav"><button class="arrowbtn" data-prev aria-label="prev">‹</button>
          <div class="track"><i style="width:${100 / robots.length}%;margin-left:${(100 * i) / robots.length}%"></i></div>
          <span class="count">${i + 1}/${robots.length}</span><button class="arrowbtn" data-next aria-label="next">›</button>
          <button class="btn" data-all style="min-height:40px;padding:8px 14px;font-size:14px">▦ ${t('viewAll')}</button></div>`;
      info.querySelector('[data-all]')!.addEventListener('click', () => this.robotPicker(() => this.main()));
      info.querySelector('[data-prev]')!.addEventListener('click', () => step(-1));
      info.querySelector('[data-next]')!.addEventListener('click', () => step(1));
    };
    const step = (d: -1 | 1) => {
      let i = robots.findIndex((x) => x.id === this.s.match.robotId);
      i = (Math.max(0, i) + d + robots.length) % robots.length;
      this.s.match.robotId = robots[i].id;
      this.app.save();
      showRobot();
    };
    showRobot();
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
    const drv = r.querySelector<HTMLInputElement>('[data-driver]')!;
    drv.addEventListener('input', () => {
      this.s.driverName = drv.value.trim();
      r.querySelector<HTMLElement>('[data-avatar]')!.textContent = (this.s.driverName || 'R').slice(0, 1);
      this.app.save();
    });
    r.querySelector('[data-fs]')!.addEventListener('click', () => this.app.toggleFullscreen());
    r.querySelector('[data-install]')!.addEventListener('click', () => this.app.install());
    this.enableNav({ onBack: () => {}, onLeftRight: step });
  }

  // ------------------------------------------------------------------ galería de robots
  /**
   * Todos los robots en una cuadrícula (miniaturas 3D): los robots reales de la temporada y los
   * del editor. Clic (o Enter) en una tarjeta la muestra en el panel; ELEGIR
   * (o doble clic) la escoge y vuelve.
   */
  robotPicker(back: () => void): void {
    const m = this.s.match;
    const all = allRobots();
    const groupOf = (r: RobotSpec): PickerTab => (r.real || ROBOT_PRESETS.some((p) => p.id === r.id) ? 'top' : 'custom');
    let tab: PickerTab = groupOf(all.find((r) => r.id === m.robotId) ?? all[0]);
    let current = m.robotId;
    const render = () => {
      const list = all.filter((r) => groupOf(r) === tab);
      const tabs = (['top', 'custom'] as PickerTab[])
        .map((k) => `<button class="chipbtn ${k === tab ? 'on' : ''}" data-tab="${k}">${t(`tab_${k}` as TKey)} <span>${all.filter((r) => groupOf(r) === k).length}</span></button>`)
        .join('');
      this.show(`
        ${this.brandbar('2026 REBUILT')}
        <h1>${t('chooseRobot')}</h1>
        <div class="picker">
          <div class="picker-left">
            <div class="tabs">${tabs}</div>
            <div class="rgrid" data-grid>
              ${
                list.length
                  ? list
                      .map(
                        (r) => `<button class="rcard ${r.id === current ? 'sel' : ''} ${r.id === m.robotId ? 'mine' : ''}" data-nav data-id="${r.id}" ${r.id === current ? 'data-nav-default' : ''}>
                  <div class="thumb"><img alt="" data-thumb="${r.id}"/>${badge(r)}</div>
                  <div class="rc-head"><span class="rc-num">${r.teamNumber}</span><span class="rc-name"><b>${esc(r.name)}</b><small>${esc(r.real?.team ?? t('customRobot'))}</small></span></div>
                  <div class="rc-chips">${chips(r)}</div>
                </button>`,
                      )
                      .join('')
                  : `<div class="msg warn">${t('noCustom')}</div>`
              }
            </div>
          </div>
          <div class="picker-right" data-detail></div>
        </div>
        <div class="actionbar">
          <button class="btn" data-back data-nav>${t('back')}</button>
          <div class="grow"></div>
          <button class="btn primary" data-pick data-nav>${t('pick')}</button>
        </div>
      `);
      const r = this.root;
      const detail = r.querySelector<HTMLElement>('[data-detail]')!;
      const showDetail = (id: string) => {
        current = id;
        r.querySelectorAll<HTMLElement>('[data-id]').forEach((c) => c.classList.toggle('sel', c.dataset.id === id));
        const sp = all.find((x) => x.id === id);
        if (!sp) return;
        const bar = (label: string, v: number, txt: string) => `<div class="sbar"><span>${label}</span><div><i style="width:${Math.round(Math.min(1, Math.max(0.04, v)) * 100)}%"></i></div><b>${txt}</b></div>`;
        detail.innerHTML = `
          <div class="pk-preview" data-preview></div>
          <div class="pk-title"><span class="rc-num">${sp.teamNumber}</span><span class="rc-name"><b>${esc(sp.name)}</b><small>${esc(sp.real ? `${sp.real.team} · ${sp.real.robot}` : robotSubtitle(sp))}</small></span></div>
          ${sp.real ? `<p class="pk-note">${esc(sp.real.note[getLang()])}</p>` : ''}
          <div class="pk-stats">
            ${bar(t('statSpeed'), sp.maxSpeed / 5.5, `${sp.maxSpeed.toFixed(1)} m/s`)}
            ${bar(t('statShot'), sp.shooter.rate / 30, `${sp.shooter.rate} FUEL/s`)}
            ${bar(t('statHopper'), sp.hopperCapacity / 115, `${sp.hopperCapacity}`)}
            ${bar(t('statIntake'), sp.intake.rate / 24, `${sp.intake.rate}/s`)}
            ${bar(t('statAccuracy'), (sp.shooter.accuracy - 0.7) / 0.27, `${Math.round(sp.shooter.accuracy * 100)}%`)}
          </div>
          <div class="rc-chips">${chips(sp)}</div>
          ${sp.real ? `<small class="pk-src">${t('sourcesNote')}</small>` : ''}`;
        this.showroom.mount(detail.querySelector<HTMLElement>('[data-preview]')!, 2.7);
        this.showroom.setRobot(sp, m.alliance);
      };
      const pick = () => {
        m.robotId = current;
        this.app.save();
        back();
      };
      r.querySelectorAll<HTMLElement>('[data-id]').forEach((c) => {
        c.addEventListener('click', () => {
          if (current === c.dataset.id && c.classList.contains('sel') && c.dataset.armed) pick();
          else {
            showDetail(c.dataset.id!);
            r.querySelectorAll<HTMLElement>('[data-id]').forEach((x) => delete x.dataset.armed);
            c.dataset.armed = '1';
          }
        });
        c.addEventListener('dblclick', pick);
      });
      r.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) =>
        b.addEventListener('click', () => {
          tab = b.dataset.tab as PickerTab;
          render();
        }),
      );
      r.querySelector('[data-back]')!.addEventListener('click', back);
      r.querySelector('[data-pick]')!.addEventListener('click', pick);
      const grid = r.querySelector<HTMLElement>('[data-grid]')!;
      const cols = () => {
        const cards = Array.from(grid.querySelectorAll<HTMLElement>('.rcard'));
        if (cards.length < 2) return 1;
        const top0 = cards[0].offsetTop;
        const n = cards.findIndex((c) => c.offsetTop !== top0);
        return n < 0 ? cards.length : n;
      };
      this.nav = new MenuNav(r, {
        onBack: back,
        cols,
        onFocus: (el) => {
          if (el.dataset.id && el.dataset.id !== current) showDetail(el.dataset.id);
        },
      });
      const first = list.find((x) => x.id === current) ?? list[0];
      if (first) showDetail(first.id);
      // Miniaturas una por una (no congela la pantalla)
      const imgs = Array.from(r.querySelectorAll<HTMLImageElement>('[data-thumb]'));
      const next = async () => {
        const img = imgs.shift();
        if (!img || !img.isConnected) return;
        const sp = all.find((x) => x.id === img.dataset.thumb);
        if (sp) img.src = await this.showroom.snapshot(sp, m.alliance);
        setTimeout(next, 0);
      };
      setTimeout(next, 30);
    };
    const badge = (r: RobotSpec) => {
      if (!r.real) return '';
      return `<span class="rc-badge gold">${t('realCad')}</span>`;
    };
    const chips = (r: RobotSpec) => {
      const lanes = r.shooter.lanes ?? 1;
      const kind = r.shooter.type === 'turret' ? (lanes > 1 ? `TURRET ×${lanes}` : 'TURRET') : lanes > 1 ? `DUMPER ×${lanes}` : t('fixed').toUpperCase();
      const out = [kind, `${r.shooter.rate} FUEL/s`, `${t('hopper')} ${r.hopperCapacity}`];
      if (fitsUnderTrench(r)) out.push('TRENCH ✓');
      if (r.climb.maxLevel) out.push(`CLIMB L${r.climb.maxLevel}`);
      return out.map((c) => `<span>${c}</span>`).join('');
    };
    render();
  }

  // ------------------------------------------------------------------ configuración del match
  setup(mode: SetupMode): void {
    const m = this.s.match;
    const routines: Opt[] = loadRoutines().map((r) => ({ value: r.id, label: r.name }));
    const isMatch = mode === 'match';
    this.show(`
      ${this.brandbar('2026 REBUILT')}
      <h1 class="center">${isMatch ? t('match') : t('practice')}</h1>
      <div class="setup">
        <div class="setup-left">
          <div><span class="label">${t('robot')}</span>
            <div class="robotcard"><div><div class="num" data-rnum></div><b data-rname></b><span data-rsub></span></div>
            <button class="btn" data-change data-nav style="min-height:40px;padding:10px 16px;font-size:15px">${t('change')}</button></div>
          </div>
          <div class="preview" data-preview></div>
          <div><span class="label">${t('alliance')}</span>
            <div class="alliance-pick">
              <button class="blue ${m.alliance === 'blue' ? 'on' : ''}" data-al="blue" data-nav><i></i>${t('blue')}</button>
              <button class="red ${m.alliance === 'red' ? 'on' : ''}" data-al="red" data-nav><i></i>${t('red')}</button>
            </div>
          </div>
        </div>
        <div class="setup-right">
          <div class="mapwrap">
            <div class="maphead"><span class="label">${t('startPos')}</span><button class="chipbtn" data-resetspot>↺ ${t('resetSpot')}</button></div>
            <div data-map></div>
            <div class="maphint"><span>${t('dragHint')}</span><span class="msg" data-g303></span></div>
          </div>
          <div class="opts">
            <div class="opt wide"><span>${t('camera')}</span>${seg('camera', (['third', 'driver', 'onboard', 'top'] as const).map((v) => ({ value: v, label: t(`cam_${v}` as TKey) })), this.app.settings.camera)}</div>
            <div class="opt"><span>${t('station')}</span>${seg('station', ['1', '2', '3'].map((v) => ({ value: v, label: `DS ${v}` })), String(m.station))}</div>
            ${isMatch ? `<div class="opt"><span>${t('autoRoutine')}</span>${select('routine', routines, m.autoRoutine)}</div>` : ''}
            ${isMatch ? `<div class="opt"><span>${t('difficulty')}</span>${seg('difficulty', (['easy', 'normal', 'hard', 'einstein'] as const).map((d) => ({ value: d, label: t(`d_${d}` as TKey) })), m.difficulty)}</div>` : ''}
            <div class="opt"><span>${t('humanPlayer')}</span>${seg('hp', [{ value: 'ai', label: t('hp_ai') }, { value: 'player', label: t('hp_player') }], m.humanPlayer)}</div>
            <div class="opt"><span>${t('eventType')}</span>${seg('event', (['regional', 'districtChamp', 'champs'] as const).map((e) => ({ value: e, label: t(`evs_${e}` as TKey) })), m.eventType)}</div>
            <div class="opt"><span>FUEL</span>${seg('fuel', [{ value: '504', label: '504' }, { value: '600', label: '600' }], String(m.fuel))}</div>
            <div class="opt"><span>${t('fouls')}</span>${seg('fouls', [{ value: '1', label: t('on') }, { value: '0', label: t('off') }], m.fouls ? '1' : '0')}</div>
          </div>
        </div>
      </div>
      <div class="actionbar">
        <button class="btn" data-back data-nav>${t('back')}</button>
        <div class="grow"></div>
        <button class="btn" data-rules data-nav>${t('rules')}</button>
        <button class="btn" data-settings data-nav>${t('settings')}</button>
        <button class="btn primary" data-start data-nav data-nav-default>${isMatch ? t('startMatch') : t('startPractice')}</button>
      </div>
    `);
    const r = this.root;
    this.showroom.mount(r.querySelector<HTMLElement>('[data-preview]')!, 2.9);
    const map = r.querySelector<HTMLElement>('[data-map]')!;
    const refresh = () => {
      const spec = robotById(m.robotId);
      this.showroom.setRobot(spec, m.alliance);
      r.querySelector('[data-rnum]')!.textContent = String(spec.teamNumber);
      r.querySelector('[data-rname]')!.textContent = spec.name;
      r.querySelector('[data-rsub]')!.textContent = robotSubtitle(spec);
      map.innerHTML = fieldMapSvg(m.alliance, m.station, spec, m.startOffset);
      const issues = startIssues(m.alliance, m.station, spec, m.startOffset);
      const el = r.querySelector<HTMLElement>('[data-g303]')!;
      el.className = `msg ${issues.length ? 'bad' : 'ok'}`;
      el.textContent = issues.length ? `G303: ${issues.map((i) => t(`g303_${i}` as TKey)).join(' · ')}` : `G303 ✓ ${t('startLegal')}`;
      (r.querySelector('[data-start]') as HTMLButtonElement).disabled = issues.length > 0;
    };
    // Arrastrar el robot en el mapa (a lo largo de su ROBOT STARTING LINE)
    let drag = false;
    const toOffset = (e: PointerEvent) => {
      const svg = map.querySelector('svg')!;
      const rect = svg.getBoundingClientRect();
      const zWorld = ((e.clientY - rect.top) / rect.height) * F.FIELD_WIDTH - F.HALF_W;
      const spec = robotById(m.robotId);
      const st = defaultStart(m.alliance, m.station, F.inch(spec.lengthIn / 2 + spec.bumperIn));
      const halfZ = F.inch(spec.widthIn / 2 + spec.bumperIn);
      const z = Math.max(-F.HALF_W + halfZ, Math.min(F.HALF_W - halfZ, zWorld));
      m.startOffset = Math.round((z - st.z) * (m.alliance === 'blue' ? 1 : -1) * 100) / 100;
      refresh();
    };
    map.addEventListener('pointerdown', (e) => {
      drag = true;
      map.setPointerCapture(e.pointerId);
      toOffset(e);
    });
    map.addEventListener('pointermove', (e) => drag && toOffset(e));
    map.addEventListener('pointerup', () => {
      drag = false;
      this.app.save();
    });
    r.querySelector('[data-resetspot]')!.addEventListener('click', () => {
      m.startOffset = 0;
      this.app.save();
      refresh();
    });
    r.querySelector('[data-change]')!.addEventListener('click', () => this.robotPicker(() => this.setup(mode)));
    r.querySelectorAll<HTMLElement>('[data-al]').forEach((b) =>
      b.addEventListener('click', () => {
        m.alliance = b.dataset.al as Alliance;
        r.querySelectorAll('[data-al]').forEach((x) => x.classList.toggle('on', x === b));
        this.app.save();
        refresh();
      }),
    );
    bind(r, (name, v) => {
      if (name === 'camera') this.app.settings.camera = v as Settings['camera'];
      if (name === 'station') m.station = Number(v) as StationNumber;
      if (name === 'routine') m.autoRoutine = String(v);
      if (name === 'hp') m.humanPlayer = v as 'ai' | 'player';
      if (name === 'difficulty') m.difficulty = v as Settings['match']['difficulty'];
      if (name === 'event') m.eventType = v as Settings['match']['eventType'];
      if (name === 'fuel') m.fuel = Number(v) as 504 | 600;
      if (name === 'fouls') m.fouls = v === '1';
      this.app.save();
      refresh();
    });
    r.querySelector('[data-rules]')!.addEventListener('click', () => this.rules(() => this.setup(mode)));
    r.querySelector('[data-settings]')!.addEventListener('click', () => this.settings(() => this.setup(mode)));
    r.querySelector('[data-start]')!.addEventListener('click', () => {
      this.hide();
      if (isMatch) this.app.startMatch();
      else this.app.startPractice();
    });
    refresh();
    this.enableNav({
      onLeftRight: (d) => {
        // ←→ cambia de alianza en esta pantalla
        m.alliance = d < 0 ? 'blue' : 'red';
        r.querySelectorAll<HTMLElement>('[data-al]').forEach((x) => x.classList.toggle('on', x.dataset.al === m.alliance));
        this.app.save();
        refresh();
      },
    });
  }

  // ------------------------------------------------------------------ reglas
  rules(back: () => void = () => this.main()): void {
    const sections = RULES_CONTENT[getLang()];
    this.show(`
      ${this.brandbar('2026 REBUILT')}
      <h1>${t('rules')}</h1>
      <div class="rules">
        ${sections
          .map(
            (s) => `<div class="panel"><h3>${esc(s.title)}</h3>
          ${s.rows ? `<table>${s.rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>` : ''}
          ${s.items ? `<ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
          ${s.text ? `<p style="margin-top:8px">${esc(s.text)}</p>` : ''}</div>`,
          )
          .join('')}
      </div>
      <div class="footer">${t('rulesSource')}</div>
      <div class="actionbar"><button class="btn primary" data-close data-nav>${t('back')}</button></div>
    `);
    this.root.querySelector('[data-close]')!.addEventListener('click', back);
    this.enableNav({ onBack: back });
  }

  // ------------------------------------------------------------------ ajustes
  settings(back: () => void = () => this.main()): void {
    const s = this.s;
    const q = (['auto', 'low', 'medium', 'high', 'ultra'] as const).map((v) => ({ value: v, label: t(`q_${v}` as TKey) }));
    const cams = (['third', 'driver', 'onboard', 'top', 'broadcast'] as const).map((v) => ({ value: v, label: t(`cam_${v}` as TKey) }));
    const onoff = (on: boolean) => (on ? '1' : '0');
    const yn: Opt[] = [
      { value: '1', label: t('on') },
      { value: '0', label: t('off') },
    ];
    const style = this.app.input.lastPadStyle;
    const keyRows = [...AXIS_ACTIONS, ...BUTTON_ACTIONS]
      .map((a) => {
        const keys = s.keys[a].map((k) => `<span class="kbd">${esc(keyLabel(k, getLang()))}</span>`).join('');
        const pad = (BUTTON_ACTIONS as string[]).includes(a)
          ? s.padBindings[a as ButtonAction].map((i) => `<span class="kbd">${PAD_LABELS[style][i] ?? i}</span>`).join('')
          : `<span class="kbd">${a.startsWith('move') ? 'L' : 'R'}</span>`;
        return `<tr><td>${t(`a_${a}` as TKey)}</td><td>${keys} <button class="chipbtn" data-rebind="${a}">${t('rebind')}</button></td><td>${pad} ${
          (BUTTON_ACTIONS as string[]).includes(a) ? `<button class="chipbtn" data-rebindpad="${a}">🎮</button>` : ''
        }</td></tr>`;
      })
      .join('');
    this.show(`
      ${this.brandbar('2026 REBUILT')}
      <h1>${t('settings')}</h1>
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
        <label>${t('aimGuide')}</label>${seg('aimguide', yn, onoff(s.drive.aimGuide))}
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
      <div class="actionbar"><button class="btn primary" data-sback data-nav>${t('back')}</button></div>
    `);
    this.root.querySelector('[data-sback]')!.addEventListener('click', back);
    this.enableNav({ onBack: back });
    bind(this.root, (name, v) => {
      const b = v === '1';
      switch (name) {
        case 'lang':
          s.lang = v as 'es' | 'en';
          setLang(s.lang);
          this.app.relabel();
          this.app.save();
          this.settings(back);
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
        case 'aimguide':
          s.drive.aimGuide = b;
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
    r.querySelector('[data-editlayout]')!.addEventListener('click', () => this.app.editTouchLayout(() => this.settings(back)));
    r.querySelector('[data-resetlayout]')!.addEventListener('click', () => {
      s.touch.layout = {};
      this.app.save();
    });
    r.querySelector('[data-resetkeys]')!.addEventListener('click', () => {
      s.keys = structuredClone(DEFAULT_SETTINGS.keys);
      s.padBindings = structuredClone(DEFAULT_SETTINGS.padBindings);
      this.app.save();
      this.settings(back);
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
          this.settings(back);
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
                this.settings(back);
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
        ${this.brandbar('2026 REBUILT')}
        <h1>${t('local')}</h1>
        <div class="panel form">
          <label>${t('players')}</label>${seg('count', ['2', '3', '4'].map((v) => ({ value: v, label: v })), String(count))}
          <label>${t('camera')}</label>${seg('cam', [{ value: 'split', label: t('splitScreen') }, { value: 'shared', label: t('sharedCam') }], shared ? 'shared' : 'split')}
          <label>${t('fillAi')}</label>${seg('fill', [{ value: '1', label: t('on') }, { value: '0', label: t('off') }], fill ? '1' : '0')}
          <h3>${t('assignDevices')}</h3>
          ${rows}
          <label></label><div class="row"><button class="chipbtn" data-touchslot>👆 ${t('touch')}</button><button class="chipbtn" data-clear>${t('reset')}</button></div>
        </div>
        <div class="actionbar"><button class="btn" data-back data-nav>${t('back')}</button><div class="grow"></div>
        <button class="btn primary" data-start ${players.slice(0, count).every(Boolean) ? '' : 'disabled'}>${t('start')}</button></div>
      `, !first);
      first = false;
      if (this.nav) this.nav.refresh();
      else this.enableNav();
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

type PickerTab = 'top' | 'custom';

// ------------------------------------------------------------------ helpers de las pantallas

/** "Swerve · Turret · Climb L2" */
export function robotSubtitle(s: RobotSpec): string {
  const lanes = s.shooter.lanes ?? 1;
  const shooter = s.shooter.type === 'turret' ? (lanes > 1 ? `Turret ×${lanes}` : 'Turret') : lanes > 1 ? `Dumper ×${lanes}` : t('fixed');
  const parts = [s.drivetrain === 'swerve' ? 'Swerve' : 'Tank', shooter, s.climb.maxLevel ? `Climb L${s.climb.maxLevel}` : t('noClimb')];
  return parts.join(' · ');
}

/** Códigos de G303 para la posición de salida elegida (vacío = legal). */
function startIssues(a: Alliance, ds: StationNumber, spec: RobotSpec, offset: number): string[] {
  const halfX = F.inch(spec.lengthIn / 2 + spec.bumperIn);
  const st = defaultStart(a, ds, halfX);
  return checkStart({
    alliance: a,
    x: st.x,
    z: st.z + offset * (a === 'blue' ? 1 : -1),
    halfX,
    halfZ: F.inch(spec.widthIn / 2 + spec.bumperIn),
    heightM: F.inch(spec.heightIn),
    perimeterM: F.inch(perimeterIn(spec)),
    preload: spec.preload,
  }).map((i) => i.code);
}

/** Mapa del campo en líneas (vista superior, azul a la izquierda) con el robot del jugador. */
function fieldMapSvg(a: Alliance, ds: StationNumber, spec: RobotSpec, offset: number): string {
  const L = F.HALF_L;
  const W = F.HALF_W;
  const sw = 0.035;
  const col = { blue: '#2f7df6', red: '#e5413a' };
  const rect = (x0: number, z0: number, x1: number, z1: number, attrs: string) =>
    `<rect x="${Math.min(x0, x1)}" y="${Math.min(z0, z1)}" width="${Math.abs(x1 - x0)}" height="${Math.abs(z1 - z0)}" ${attrs}/>`;
  let g = rect(-L, -W, L, W, `fill="#0f1014" stroke="rgba(255,255,255,.25)" stroke-width="${sw}"`);
  for (const al of ['blue', 'red'] as Alliance[]) {
    const s = F.allianceSign(al);
    const c = col[al];
    const line = s * Math.abs(F.STARTING_LINE_X_BLUE);
    g += rect(s * L, -W, line, W, `fill="${c}" fill-opacity="${al === a ? 0.13 : 0.07}"`);
    g += `<line x1="${line}" y1="${-W}" x2="${line}" y2="${W}" stroke="${c}" stroke-width="${sw * 1.6}"/>`;
    const hx = F.hubCenter(al).x;
    g += rect(hx - F.HUB_SIZE / 2, -F.HUB_SIZE / 2, hx + F.HUB_SIZE / 2, F.HUB_SIZE / 2, `fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="${sw}"`);
    for (const k of [-1, 1]) {
      g += rect(hx - F.BUMP_DEPTH / 2, (k * F.HUB_SIZE) / 2, hx + F.BUMP_DEPTH / 2, k * (F.HUB_SIZE / 2 + F.BUMP_WIDTH), `fill="${c}" fill-opacity=".12" stroke="${c}" stroke-width="${sw}"`);
      g += rect(hx - F.TRENCH_DEPTH / 2, k * F.TRENCH_INNER_Z, hx + F.TRENCH_DEPTH / 2, k * (F.HALF_W - F.TRENCH_CLEAR_WIDTH), `fill="none" stroke="${c}" stroke-width="${sw}"`);
      g += `<line x1="${hx}" y1="${k * (F.HALF_W - F.TRENCH_CLEAR_WIDTH)}" x2="${hx}" y2="${k * W}" stroke="${c}" stroke-width="${sw}" stroke-dasharray=".12 .08"/>`;
    }
    const tw = F.towerInfo(al);
    g += rect(s * L, tw.cz - F.TOWER_BASE_WIDTH / 2, s * (L - F.TOWER_BASE_DEPTH), tw.cz + F.TOWER_BASE_WIDTH / 2, `fill="none" stroke="${c}" stroke-width="${sw}"`);
    const dp = F.depotCenter(al);
    g += rect(s * L, dp.z - F.DEPOT_WIDTH / 2, s * (L - F.DEPOT_DEPTH), dp.z + F.DEPOT_WIDTH / 2, `fill="#f5c518" fill-opacity=".18" stroke="#f5c518" stroke-opacity=".6" stroke-width="${sw}"`);
    const op = F.outpostInfo(al);
    g += rect(s * L, op.z - 0.42, s * (L + 0.18), op.z + 0.42, `fill="${c}"`);
  }
  g += `<line x1="0" y1="${-W}" x2="0" y2="${W}" stroke="rgba(255,255,255,.55)" stroke-width="${sw}" stroke-dasharray=".2 .14"/>`;
  g += rect(-F.NEUTRAL_BOX_D / 2, -F.NEUTRAL_BOX_W / 2, F.NEUTRAL_BOX_D / 2, F.NEUTRAL_BOX_W / 2, `fill="#f5c518" fill-opacity=".14"`);
  // Compañeros (posiciones por defecto) y el robot del jugador
  const hx = F.inch(spec.lengthIn / 2 + spec.bumperIn);
  const hz = F.inch(spec.widthIn / 2 + spec.bumperIn);
  for (const other of [1, 2, 3] as StationNumber[]) {
    if (other === ds) continue;
    const st = defaultStart(a, other, 0.43);
    g += rect(st.x - 0.43, st.z - 0.43, st.x + 0.43, st.z + 0.43, `fill="none" stroke="${col[a]}" stroke-opacity=".6" stroke-width="${sw}" stroke-dasharray=".1 .07"`);
  }
  const st = defaultStart(a, ds, hx);
  const z = st.z + offset * (a === 'blue' ? 1 : -1);
  const dir = a === 'blue' ? 1 : -1;
  g += `<g class="me">${rect(st.x - hx, z - hz, st.x + hx, z + hz, `fill="${col[a]}" stroke="#fff" stroke-width="${sw * 1.5}" rx=".06"`)}
    <polygon points="${st.x + dir * hx * 0.75},${z} ${st.x + dir * hx * 0.1},${z - hz * 0.45} ${st.x + dir * hx * 0.1},${z + hz * 0.45}" fill="#fff"/></g>`;
  return `<svg viewBox="${-L - 0.25} ${-W - 0.05} ${2 * L + 0.5} ${2 * W + 0.1}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="field">${g}</svg>`;
}
