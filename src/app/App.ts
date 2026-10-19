/**
 * Orquestador: ajustes, renderer, campo persistente, entrada, audio, HUD, sesión activa y bucle.
 */
import { AudioEngine } from '../audio/Audio';
import { presetById, ROBOT_PRESETS } from '../config/robots';
import { loadSettings, saveSettings, type Settings } from '../config/settings';
import type { MatchEvent } from '../core/match';
import { ALLIANCES, type Alliance, type StationNumber } from '../core/types';
import { GameSession, type RobotSlotConfig, type SessionConfig } from '../game/GameSession';
import { InputManager } from '../input/InputManager';
import { TouchControls } from '../input/TouchControls';
import { FieldView } from '../render/FieldView';
import { Renderer, type Quality } from '../render/Renderer';
import { Hud } from '../ui/Hud';
import { getLang, setLang, t, type TKey } from '../ui/i18n';

export class App {
  settings: Settings;
  readonly renderer: Renderer;
  readonly field: FieldView;
  readonly input: InputManager;
  readonly touch: TouchControls;
  readonly audio: AudioEngine;
  readonly hud: Hud;
  session: GameSession | null = null;
  private last = performance.now();
  private fpsEl: HTMLElement;
  private fpsAcc = { frames: 0, time: 0, fps: 60 };
  private toastEl: HTMLElement;
  private overlay: HTMLElement;
  private countdown = -1;
  private countdownShown = -1;

  constructor(
    private appEl: HTMLElement,
    readonly uiEl: HTMLElement,
  ) {
    this.settings = loadSettings();
    setLang(this.settings.lang);
    this.renderer = new Renderer(appEl);
    this.field = new FieldView();
    this.renderer.scene.add(this.field.group);
    this.input = new InputManager(this.settings, this.renderer.renderer.domElement);
    this.audio = new AudioEngine(this.settings);
    this.hud = new Hud(uiEl, () => this.togglePause());
    this.touch = new TouchControls(uiEl, this.settings, () => this.save());
    this.input.touch = this.touch;
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps';
    uiEl.appendChild(this.fpsEl);
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toasts';
    uiEl.appendChild(this.toastEl);
    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay hidden';
    uiEl.appendChild(this.overlay);
    this.input.onKey('F3', () => {
      this.settings.showFps = !this.settings.showFps;
      this.save();
    });
    this.input.onDeviceChange.push((d) => this.touch.setEnabled(d === 'touch' && !!this.session));
    window.addEventListener('resize', () => this.renderer.resize());
    document.addEventListener('visibilitychange', () => {
      // Pausa automática al perder el foco
      if (document.hidden && this.session && !this.session.paused) this.togglePause();
    });
    this.hud.setColorblind(this.settings.colorblind);
    this.applyQuality();
  }

  save(): void {
    saveSettings(this.settings);
    this.input.updateSettings(this.settings);
    this.touch.updateSettings(this.settings);
    this.audio.updateSettings(this.settings);
    this.session?.updateSettings(this.settings);
    this.hud.setColorblind(this.settings.colorblind);
  }

  applyQuality(): void {
    const q = this.settings.quality === 'auto' ? this.guessQuality() : this.settings.quality;
    this.renderer.setQuality(q, this.session?.rigs[0]?.camera);
  }

  /** Calidad inicial para "Auto": móviles → media, escritorio → alta. Luego se ajusta midiendo FPS. */
  guessQuality(): Quality {
    const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
    return mobile ? 'medium' : 'high';
  }

  // ------------------------------------------------------------------ sesiones
  startSession(cfg: SessionConfig): void {
    this.session?.dispose();
    this.audio.stopMusic();
    const s = new GameSession(cfg, this.renderer, this.field, this.settings);
    this.session = s;
    s.hooks = {
      toast: (k) => this.toast(t(k)),
      matchEvent: (e) => this.onMatchEvent(e),
      fuelScored: (_hub, counted) => {
        if (counted) this.audio.score();
      },
      impact: (strength, slot) => {
        this.audio.hit(strength);
        if (slot >= 0) {
          s.rigs[Math.min(slot, s.rigs.length - 1)]?.addShake(strength * 0.12);
          this.input.rumble(slot, strength, 120);
        }
      },
      cameraChange: (mode) => this.toast(`${t('camera')}: ${t(`cam_${mode}` as TKey)}`),
    };
    // recompone el composer con la cámara nueva
    this.renderer.setQuality(this.renderer.quality, s.rigs[0].camera);
    this.touch.setEnabled(this.input.lastDevice === 'touch');
    this.hud.setPractice(cfg.mode === 'practice');
    this.hud.setVisible(true);
    this.closeOverlay();
    if (s.match) this.countdown = 3.2;
  }

  /** Práctica libre con el robot elegido. */
  startPractice(): void {
    const m = this.settings.match;
    this.startSession({
      mode: 'practice',
      robots: [{ spec: presetById(m.robotId), alliance: m.alliance, station: m.station, control: { type: 'player', slot: 0 } }],
      fuelTotal: m.fuel,
      eventType: m.eventType,
      fouls: m.fouls,
      seed: (Math.random() * 2 ** 32) >>> 0,
    });
  }

  /** Match 3 vs 3: el jugador en su DRIVER STATION, los demás robots con presets variados. */
  startMatch(): void {
    const m = this.settings.match;
    const robots: RobotSlotConfig[] = [];
    let k = 0;
    for (const a of ALLIANCES)
      for (const ds of [1, 2, 3] as StationNumber[]) {
        const isPlayer = a === m.alliance && ds === m.station;
        const spec = isPlayer ? presetById(m.robotId) : structuredClone(ROBOT_PRESETS[k++ % ROBOT_PRESETS.length]);
        if (!isPlayer) spec.teamNumber = 100 + Math.floor(Math.random() * 9800);
        robots.push({ spec, alliance: a, station: ds, control: isPlayer ? { type: 'player', slot: 0 } : { type: 'ai' } });
      }
    this.startSession({
      mode: 'match',
      robots,
      fuelTotal: m.fuel,
      eventType: m.eventType,
      fouls: m.fouls,
      seed: (Math.random() * 2 ** 32) >>> 0,
    });
  }

  private onMatchEvent(e: MatchEvent): void {
    const lang = getLang();
    const say = (es: string, en: string) => this.audio.speak(lang === 'es' ? es : en, lang);
    const player = this.session?.playerRobot(0);
    switch (e.type) {
      case 'phase':
        switch (e.phase) {
          case 'AUTO':
            this.audio.cavalryCharge();
            this.audio.startMusic();
            break;
          case 'AUTO_PAUSE':
            this.audio.buzzer();
            break;
          case 'TRANSITION':
            this.audio.threeBells();
            break;
          case 'SHIFT1':
          case 'SHIFT2':
          case 'SHIFT3':
          case 'SHIFT4': {
            this.audio.powerUp();
            this.input.rumble(0, 0.5, 250);
            const n = e.phase.slice(-1);
            const active = this.session?.match?.isHubActive(player?.alliance ?? 'blue');
            this.toast(`SHIFT ${n} · HUB ${active ? t('hubActive') : t('hubInactive')}`.toUpperCase(), active ? 'good' : '');
            break;
          }
          case 'END_GAME':
            this.audio.steamWhistle();
            this.input.rumble(0, 0.6, 300);
            say('¡END GAME! Todos los HUBS activos', 'END GAME! All HUBS active');
            break;
          case 'POST':
            this.audio.buzzer();
            this.audio.stopMusic();
            break;
        }
        break;
      case 'firstInactive': {
        const a: Alliance = e.alliance;
        this.toast(t('inactiveFirst', { a: `HUB ${t(a)}`.toUpperCase() }), a === player?.alliance ? '' : 'good');
        say(
          `El HUB ${a === 'red' ? 'rojo' : 'azul'} queda inactivo en el SHIFT uno`,
          `The ${a} HUB is inactive in SHIFT one`,
        );
        break;
      }
      case 'warning':
        if (e.alliance === player?.alliance) this.audio.beep(true);
        break;
      case 'end': {
        const mm = this.session?.match;
        if (mm) {
          const r = mm.score('red');
          const b = mm.score('blue');
          const w = r === b ? t('tie') : t('winner', { a: t(r > b ? 'red' : 'blue') });
          this.toast(`${w} ${r} – ${b}`, 'good');
        }
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ pausa / overlay
  togglePause(): void {
    const s = this.session;
    if (!s) return;
    s.paused = !s.paused;
    if (s.paused) this.showPause();
    else this.closeOverlay();
  }

  private showPause(): void {
    this.openOverlay(
      `<div class="dialog"><h2>${t('paused')}</h2>
        <button data-a="resume" class="primary">${t('resume')}</button>
        <button data-a="restart">${t('restart')}</button>
        <button data-a="practice">${t('practice')}</button>
        <button data-a="match">${t('match')}</button>
      </div>`,
      (a) => {
        if (a === 'resume') this.togglePause();
        else if (a === 'restart') this.session?.cfg.mode === 'practice' ? this.startPractice() : this.startMatch();
        else if (a === 'practice') this.startPractice();
        else if (a === 'match') this.startMatch();
      },
    );
  }

  openOverlay(html: string, onAction: (a: string) => void): void {
    this.overlay.innerHTML = html;
    this.overlay.classList.remove('hidden');
    this.overlay.querySelectorAll<HTMLElement>('[data-a]').forEach((b) =>
      b.addEventListener('click', () => onAction(b.dataset.a!)),
    );
  }

  closeOverlay(): void {
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
  }

  toast(text: string, cls = ''): void {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.textContent = text;
    this.toastEl.appendChild(el);
    while (this.toastEl.children.length > 4) this.toastEl.firstChild?.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3100);
  }

  // ------------------------------------------------------------------ bucle
  start(): void {
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
    };
    requestAnimationFrame(loop);
  }

  private tick(dt: number): void {
    const inputs = this.input.poll();
    const s = this.session;
    if (inputs[0]?.pressed.has('pause')) this.togglePause();
    if (s) {
      this.runCountdown(dt, s);
      s.update(dt, inputs);
      const views = s.frame(dt);
      this.renderer.render(views);
      this.updateHud(s);
    }
    const f = this.fpsAcc;
    f.frames++;
    f.time += dt;
    if (f.time >= 0.5) {
      f.fps = f.frames / f.time;
      f.frames = 0;
      f.time = 0;
      this.fpsEl.style.display = this.settings.showFps ? '' : 'none';
      if (this.settings.showFps) {
        const info = this.renderer.info.render;
        this.fpsEl.textContent = `${f.fps.toFixed(0)} FPS · ${this.renderer.quality} · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · phys ${s?.physicsSteps ?? 0}`;
      }
    }
    (window as unknown as { __fps: number }).__fps = f.fps;
  }

  /** Cuenta regresiva 3-2-1 antes de arrancar el match. */
  private runCountdown(dt: number, s: GameSession): void {
    if (this.countdown < 0 || s.paused) return;
    this.countdown -= dt;
    const n = Math.ceil(this.countdown);
    if (n !== this.countdownShown && n > 0) {
      this.countdownShown = n;
      this.audio.beep(false);
      this.openOverlay(`<div class="countdown">${n}</div>`, () => {});
      this.overlay.classList.add('passthrough');
    }
    if (this.countdown <= 0) {
      this.countdown = -1;
      this.countdownShown = -1;
      this.overlay.classList.remove('passthrough');
      this.closeOverlay();
      s.beginMatch();
    }
  }

  private updateHud(s: GameSession): void {
    const r = s.playerRobot(0);
    const rig = s.rigs[0];
    const phase = s.phase;
    this.hud.update(
      s.match,
      s.cfg.eventType,
      r
        ? {
            robotName: r.spec.name,
            team: r.spec.teamNumber,
            alliance: r.alliance,
            hopper: s.fuel.robotCount(r.index),
            capacity: r.spec.hopperCapacity,
            fieldRelative: r.fieldRelative,
            camera: t(`cam_${rig.mode}` as TKey),
            intakeOn: r.intakeOn,
            autoAim: this.settings.drive.autoAim,
            climb: null,
            disabled: r.disabled,
            note: phase === 'AUTO' ? t('autoRunning') : null,
          }
        : null,
    );
  }

  get fps(): number {
    return this.fpsAcc.fps;
  }

  get container(): HTMLElement {
    return this.appEl;
  }
}
