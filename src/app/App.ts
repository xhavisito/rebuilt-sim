/**
 * Orquestador: ajustes, renderer, campo persistente, entrada, sesión activa y bucle.
 */
import { presetById } from '../config/robots';
import { loadSettings, saveSettings, type Settings } from '../config/settings';
import { GameSession, type SessionConfig } from '../game/GameSession';
import { InputManager } from '../input/InputManager';
import { TouchControls } from '../input/TouchControls';
import { FieldView } from '../render/FieldView';
import { Renderer, type Quality } from '../render/Renderer';
import { setLang, t } from '../ui/i18n';

export class App {
  settings: Settings;
  readonly renderer: Renderer;
  readonly field: FieldView;
  readonly input: InputManager;
  readonly touch: TouchControls;
  session: GameSession | null = null;
  private last = performance.now();
  private fpsEl: HTMLElement;
  private fpsAcc = { frames: 0, time: 0, fps: 60 };
  private toastEl: HTMLElement;

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
    this.touch = new TouchControls(uiEl, this.settings, () => this.save());
    this.input.touch = this.touch;
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps';
    uiEl.appendChild(this.fpsEl);
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toasts';
    uiEl.appendChild(this.toastEl);
    this.input.onKey('F3', () => {
      this.settings.showFps = !this.settings.showFps;
      this.save();
    });
    this.input.onDeviceChange.push((d) => this.touch.setEnabled(d === 'touch' && !!this.session));
    window.addEventListener('resize', () => this.renderer.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.session) this.session.paused = true;
    });
    this.applyQuality();
  }

  save(): void {
    saveSettings(this.settings);
    this.input.updateSettings(this.settings);
    this.touch.updateSettings(this.settings);
    this.session?.updateSettings(this.settings);
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

  startSession(cfg: SessionConfig): void {
    this.session?.dispose();
    this.session = new GameSession(cfg, this.renderer, this.field, this.settings);
    this.session.onToast = (k) => this.toast(t(k));
    // recompone el composer con la cámara nueva
    this.renderer.setQuality(this.renderer.quality, this.session.rigs[0].camera);
    this.touch.setEnabled(this.input.lastDevice === 'touch');
  }

  /** Inicia una práctica rápida con el robot elegido. */
  startPractice(): void {
    const spec = presetById(this.settings.match.robotId);
    this.startSession({
      mode: 'practice',
      robots: [
        {
          spec,
          alliance: this.settings.match.alliance,
          station: this.settings.match.station,
          control: { type: 'player', slot: 0 },
        },
      ],
      fuelTotal: this.settings.match.fuel,
      eventType: this.settings.match.eventType,
      fouls: false,
      seed: (Math.random() * 2 ** 32) >>> 0,
    });
  }

  toast(text: string, cls = ''): void {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.textContent = text;
    this.toastEl.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2200);
    setTimeout(() => el.remove(), 2700);
  }

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
    if (s) {
      s.update(dt, inputs);
      const views = s.frame(dt);
      this.renderer.render(views);
    }
    // FPS
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

  get fps(): number {
    return this.fpsAcc.fps;
  }

  get container(): HTMLElement {
    return this.appEl;
  }
}
