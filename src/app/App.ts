/**
 * Orquestador: ajustes, renderer, campo persistente, entrada, audio, HUD, sesión activa y bucle.
 */
import { planFor, strategyById } from '../ai/Strategy';
import { AudioEngine } from '../audio/Audio';
import { DIFFICULTY } from '../ai/RobotAI';
import * as THREE from 'three';
import * as F from '../config/field';
import { CAD_ROBOTS, robotById, ROBOT_PRESETS, type RobotSpec } from '../config/robots';
import { Rng } from '../core/rng';
import { simulateMatch, type TeamPerf, type Tournament, type TMatch } from '../core/tournament';
import { StrategyPlanner } from '../ui/StrategyPlanner';
import { AutoDesigner } from '../ui/AutoDesigner';
import { Screens, type LocalPlayer } from '../ui/Menu';
import { RobotEditor } from '../ui/RobotEditor';
import { CommunityScreen } from '../ui/CommunityScreen';
import { saveTournament, TournamentScreen } from '../ui/TournamentScreen';
import { applyRows, COACH_PLAN_ID, rowsForMatch } from '../ui/StrategyDashboard';
import { loadSettings, saveSettings, type Difficulty, type Settings } from '../config/settings';
import type { MatchEvent } from '../core/match';
import { ALLIANCES, type Alliance, type StationNumber } from '../core/types';
import { GameSession, type RobotSlotConfig, type SessionConfig } from '../game/GameSession';
import type { Robot } from '../game/Robot';
import { InputManager, type SlotDevice } from '../input/InputManager';
import { TouchControls } from '../input/TouchControls';
import { FieldView } from '../render/FieldView';
import { Effects } from '../render/Effects';
import { ALLIANCE_COLOR } from '../render/FieldView';
import { QUALITY_ORDER, Renderer, type Quality, type Viewport } from '../render/Renderer';
import { Showroom } from '../render/Showroom';
import { ensureCustomCads } from '../render/customCad';
import { Stadium } from '../render/Stadium';
import { FLAG_SHOT, FuelState } from '../physics/FuelSystem';
import { formatTimer, timerSeconds } from '../core/clock';
import { loadJSON, saveJSON } from '../config/settings';
import { buildResults } from '../game/results';
import { recordSession } from '../game/playerStats';
import { StatsScreen, syncBoard } from '../ui/StatsScreen';
import { RULES } from '../core/fouls';
import { Hud, PHASE_LABEL, type PlayerHudInfo } from '../ui/Hud';
import { esc } from '../ui/forms';
import { keyToNav, MenuNav, PadNav } from '../ui/nav';
import { emptyInput, keyLabel, type PlayerInput } from '../input/actions';
import { CAMERA_MODES, type CameraMode } from '../render/CameraRig';
import { attachChartHover, renderResults } from '../ui/Results';
import { ClientRoom, HostRoom } from '../net/Online';
import type { NetEvent } from '../net/protocol';
import { RoomBrowser, type PublicRoom } from '../net/directory';
import { QUICK, mergeTarget, rankQuickRooms } from '../net/quickMatch';
import { getLang, setLang, t, tx, type TKey } from '../ui/i18n';
import { SPECTATOR_CAMS } from '../game/GameSession';
import { SpectatorBar } from '../ui/SpectatorBar';
import { clipReplay, highlights, serializeReplay, type ReplayData } from '../replay/Recording';
import { ReplayPlayer, SessionTap } from '../replay/ReplayPlayer';
import { saveReplay } from '../replay/store';
import { ClipVideo, download, shareOrDownload, videoSupported } from '../replay/VideoExport';
import { PHASE_LABEL as PHASES } from '../ui/Hud';

export class App {
  settings: Settings;
  readonly renderer: Renderer;
  readonly field: FieldView;
  readonly input: InputManager;
  readonly touch: TouchControls;
  readonly audio: AudioEngine;
  readonly hud: Hud;
  readonly effects = new Effects();
  readonly stadium = new Stadium();
  session: GameSession | null = null;
  /** Dificultad de la IA por alianza en los matches (URL `?difficultyRed=`/`?difficultyBlue=`; banco de pruebas). */
  difficultyOf: Partial<Record<Alliance, Difficulty>> = {};
  /** Medición de FPS para la calidad "Auto". */
  private autoQ = { t: 0, frames: 0, steps: 0 };
  private clock = 0;
  private last = performance.now();
  private fpsEl: HTMLElement;
  private fpsAcc = { frames: 0, time: 0, fps: 60, sim: 0, gpu: 0 };
  private toastEl: HTMLElement;
  private overlay: HTMLElement;
  /** Navegación del menú de pausa con control (A/B, D-pad) y flechas. */
  private pauseNav: MenuNav | null = null;
  private pausePad = new PadNav();
  private countdown = -1;
  private coachVoiceT = 0;
  private countdownShown = -1;
  readonly screens: Screens;
  private designer: AutoDesigner;
  private planner: StrategyPlanner;
  /** A dónde regresa el planeador (menú principal o configuración del match). */
  private plannerBack: () => void = () => this.screens.main();
  private editor: RobotEditor;
  private community: CommunityScreen;
  private tourney: TournamentScreen;
  private statsScreen: StatsScreen;
  private menuCam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  private menuAngle = 0;
  /** Evento `beforeinstallprompt` (PWA) guardado para el botón "Instalar app". */
  installPrompt: (Event & { prompt: () => Promise<void> }) | null = null;
  /** Match de torneo en curso. */
  private tournamentCtx: { tt: Tournament; match: TMatch } | null = null;
  private doneLayoutBtn: HTMLButtonElement | null = null;
  /** Sala en línea propia (host) o a la que entraste (cliente). */
  netHost: HostRoom | null = null;
  netClient: ClientRoom | null = null;
  /** Grabación del match en curso (repetición). */
  private tap: SessionTap | null = null;
  /** Repetición del último match terminado (para verla desde los resultados). */
  lastReplay: ReplayData | null = null;
  /** Repetición que se está viendo y a dónde se regresa al salir. */
  private replay: { player: ReplayPlayer; back: () => void } | null = null;
  /** Controles del espectador (cámaras, robot, línea de tiempo). */
  private specBar: SpectatorBar | null = null;
  /** Exportando un clip a video. */
  private video: { vid: ClipVideo; end: number; stopAudio: () => void } | null = null;

  constructor(
    private appEl: HTMLElement,
    readonly uiEl: HTMLElement,
  ) {
    this.settings = loadSettings();
    setLang(this.settings.lang);
    this.renderer = new Renderer(appEl);
    this.field = new FieldView();
    this.renderer.scene.add(this.field.group, this.stadium.group, this.effects.points);
    this.renderer.onQualityChange.push((p) => {
      this.stadium.setDensity(p.crowd);
      this.effects.setViewportHeight(window.innerHeight * Math.min(window.devicePixelRatio || 1, p.maxPixelRatio) * p.renderScale);
    });
    this.input = new InputManager(this.settings, this.renderer.renderer.domElement);
    this.audio = new AudioEngine(this.settings);
    this.hud = new Hud(uiEl, () => this.togglePause(), () => this.session?.cycleCamera(0));
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
    window.addEventListener('keydown', (e) => {
      if (!this.session?.paused || !this.pauseNav) return;
      const a = keyToNav(e);
      // Esc ya reanuda por la entrada del juego
      if (a && a !== 'back') {
        e.preventDefault();
        this.pauseNav.handle(a);
      }
    });
    this.input.onKey('F3', () => {
      this.settings.showFps = !this.settings.showFps;
      this.save();
    });
    this.input.onDeviceChange.push((d) => this.touch.setEnabled(d === 'touch' && !!this.session?.localPlayers().length));
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.renderer.onQualityChange.forEach((cb) => cb(this.renderer.preset));
    });
    document.addEventListener('visibilitychange', () => {
      // Pausa automática al perder el foco (en línea no: el match sigue para todos)
      if (document.hidden && this.session && !this.session.paused && !this.session.cfg.net) this.togglePause();
    });
    this.hud.setColorblind(this.settings.colorblind);
    this.screens = new Screens(this, uiEl, new Showroom());
    const back = () => this.screens.main();
    this.designer = new AutoDesigner(this.screens.root, back, (id, st) => {
      this.settings.match.autoRoutine = id;
      this.settings.match.station = st;
      this.save();
      this.startMatch();
    });
    this.planner = new StrategyPlanner(
      this.screens.root,
      () => this.plannerBack(),
      (id, mine) => {
        if (mine) this.settings.match.strategy = id;
        else this.settings.match.oppStrategy = id;
        this.save();
      },
      () => ({ mine: this.settings.match.strategy, opp: this.settings.match.oppStrategy }),
    );
    this.editor = new RobotEditor(
      this.screens.root,
      this.screens.showroom,
      back,
      (id) => {
        this.settings.match.robotId = id;
        this.save();
        this.screens.setup('match');
      },
      () => this.openCommunity(),
    );
    this.community = new CommunityScreen(this.screens.root, this.screens.showroom, () => this.openRobotEditor(), (id) => {
      this.settings.match.robotId = id;
      this.save();
      this.openRobotEditor();
    });
    this.tourney = new TournamentScreen(this.screens.root, this.settings, back, (tt, m, watch) => this.playTournamentMatch(tt, m, watch));
    this.statsScreen = new StatsScreen(
      this.screens.root,
      this.settings,
      () => this.closeStats(),
      () => this.save(),
      () => this.screens.nav?.refresh(),
    );
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e as Event & { prompt: () => Promise<void> };
    });
    // Pide girar el teléfono a horizontal
    const rot = document.createElement('div');
    rot.className = 'rotate-hint active';
    rot.innerHTML = `<div class="ph"></div><div>${t('rotatePhone')}</div>`;
    document.body.appendChild(rot);
    for (const a of ALLIANCES) this.field.setHubLight(a, 'active', 0);
    this.applyQuality();
  }

  // ------------------------------------------------------------------ menús
  /** Sale de la sesión y muestra el menú principal (con el campo girando de fondo). */
  quitToMenu(): void {
    const back = this.replay?.back;
    this.endSessionExtras();
    this.leaveOnline();
    this.session?.dispose();
    this.session = null;
    this.tournamentCtx = null;
    this.audio.stopMusic();
    this.closeOverlay();
    this.hud.setVisible(false);
    this.touch.setEnabled(false);
    this.input.slots = [{ type: 'any' }];
    for (const a of ALLIANCES) this.field.setHubLight(a, 'active', 0);
    this.renderer.setQuality(this.renderer.quality, this.menuCam);
    if (back) back();
    else this.screens.main();
  }

  /**
   * Antes de cerrar la sesión: guarda lo grabado (match sin terminar si dura lo suficiente) y quita
   * la barra del espectador.
   */
  private endSessionExtras(): void {
    if (this.tap && !this.tap.finished) {
      const d = this.tap.finish(true, __APP_VERSION__);
      if (d && d.meta.duration >= 20) this.storeReplay(d);
    }
    this.tap = null;
    if (this.video) {
      this.video.stopAudio();
      void this.video.vid.stop();
      this.video = null;
    }
    this.specBar?.dispose();
    this.specBar = null;
    this.replay = null;
  }

  private storeReplay(d: ReplayData): void {
    saveReplay(d).catch(() => this.toast(t('rp_storageErr'), 'minor'));
  }

  private openScreen(): void {
    this.endSessionExtras();
    this.session?.dispose();
    this.session = null;
    this.hud.setVisible(false);
    this.touch.setEnabled(false);
    this.closeOverlay();
    this.screens.prepare(() => this.screens.main());
  }

  /** Planeador de estrategia; `back` = a dónde regresa (por defecto, el menú principal). */
  openStrategyPlanner(id?: string, back?: () => void): void {
    this.openScreen();
    this.plannerBack = back ?? (() => this.screens.main());
    this.planner.open(id ?? this.settings.match.strategy);
  }

  openAutoDesigner(): void {
    this.openScreen();
    this.designer.open(this.settings.match.autoRoutine, this.settings.match.robotId);
  }

  openRobotEditor(): void {
    this.openScreen();
    this.editor.open(this.settings.match.robotId);
  }

  /** Galería de robots de la comunidad (se entra desde el taller). */
  openCommunity(): void {
    this.openScreen();
    this.community.open();
  }

  openTournament(): void {
    this.openScreen();
    this.tourney.open();
  }

  /** Estadísticas del jugador y ranking global. */
  openStats(): void {
    this.openScreen();
    this.screens.prepare(() => this.closeStats());
    this.statsScreen.open();
  }

  private closeStats(): void {
    this.statsScreen.close();
    this.screens.main();
  }

  relabel(): void {
    this.touch.relabel();
  }

  toggleFullscreen(): void {
    const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (document.fullscreenElement || d.webkitFullscreenElement) {
      (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.())?.catch?.(() => {});
      return;
    }
    const p = el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.();
    Promise.resolve(p)
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape'))
      .catch(() => {});
  }

  install(): void {
    void this.installPrompt?.prompt();
    this.installPrompt = null;
  }

  /** Modo "editar layout táctil": arrastra los botones y toca "Listo". */
  editTouchLayout(done: () => void): void {
    this.screens.hide();
    this.touch.setEnabled(true);
    this.touch.setEditing(true);
    const b = document.createElement('button');
    b.className = 'btn primary done-layout';
    b.textContent = t('doneLayout');
    b.addEventListener('click', () => {
      this.touch.setEditing(false);
      this.touch.setEnabled(false);
      b.remove();
      this.doneLayoutBtn = null;
      this.screens.root.classList.remove('hidden');
      done();
    });
    this.uiEl.appendChild(b);
    this.doneLayoutBtn = b;
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
    const remembered = loadJSON<Quality | null>('rebuilt-sim.autoQuality', null);
    if (remembered && QUALITY_ORDER.includes(remembered)) return remembered;
    const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
    return mobile ? 'medium' : 'high';
  }

  // ------------------------------------------------------------------ sesiones
  startSession(cfg: SessionConfig, replay?: ReplayData): void {
    this.endSessionExtras();
    this.session?.dispose();
    this.audio.stopMusic();
    this.screens.hide();
    this.doneLayoutBtn?.remove();
    if (cfg.mode !== 'local') this.input.slots = [{ type: 'any' }];
    const s = new GameSession(cfg, this.renderer, this.field, this.settings);
    this.session = s;
    this.hud.clearCoach();
    s.hooks = {
      toast: (k) => this.toast(t(k)),
      coach: (msg) => {
        const c = this.settings.coach;
        if (!c.show && !c.voice) return;
        // parámetros con '@' son claves de i18n (tareas, "Tú")
        const params = Object.fromEntries(Object.entries(msg.params ?? {}).map(([k, v]) => [k, typeof v === 'string' && v.startsWith('@') ? t(v.slice(1) as TKey) : String(v)]));
        const text = t(msg.key as TKey, params);
        if (c.show) this.hud.coach(text, msg.kind);
        // en voz alta solo lo urgente, y sin encimarse
        const now = performance.now();
        if (c.voice && (msg.kind === 'call' || msg.kind === 'warn') && now - this.coachVoiceT > 2500) {
          this.coachVoiceT = now;
          this.audio.speak(text, getLang());
        }
      },
      matchEvent: (e) => this.onMatchEvent(e),
      fuelScored: (hub, counted) => {
        if (!counted) return;
        this.audio.score();
        const c = F.hubCenter(hub);
        this.effects.emit(c.x, F.HUB_RIM_HEIGHT + 0.1, c.z, 14, { color: ALLIANCE_COLOR[hub], speed: 2.4, up: 1.5, life: 0.7, size: 0.07, gravity: 4 });
        this.effects.emit(c.x, F.HUB_RIM_HEIGHT + 0.1, c.z, 6, { color: 0xffd54f, speed: 2, up: 2, life: 0.8, size: 0.06, gravity: 4 });
        this.stadium.cheer(0.08);
      },
      launch: (r, kind, isPlayer) => {
        s.director.note(r.index, 0.6);
        if (!isPlayer) return;
        this.audio.shoot();
        // en línea, el cliente solo oye los tiros de su robot: su slot local es el 0
        this.input.haptic(Math.max(0, localSlot(r, s.localCount)), kind === 'pass' ? 'pass' : 'shot');
      },
      intake: (r) => this.input.haptic(localSlot(r, s.localCount), 'intake'),
      hpAction: (a, what) => {
        if (what === 'door') this.toast(s.humanPlayers[a].doorOpen ? t('chuteOpen') : t('chuteClosed'));
      },
      impact: (strength, slot, x, y, z, robots = []) => {
        for (const i of robots) s.director.note(i, 1 + 6 * strength);
        this.audio.hit(strength);
        this.effects.emit(x, y, z, Math.round(6 + 14 * strength), { color: 0xffb74d, speed: 2.5 + 3 * strength, spread: 1.2, life: 0.35, size: 0.03, gravity: 9 });
        if (slot >= 0) {
          s.rigs[Math.min(slot, s.rigs.length - 1)]?.addShake(strength * 0.12);
          this.input.haptic(slot, 'impact', strength);
        }
      },
      cameraChange: (mode) => {
        this.toast(`${t('camera')}: ${t(`cam_${mode}` as TKey)}`);
        // Recuerda la cámara elegida (un solo jugador; la libre es solo de práctica)
        if (s.localPlayers().length === 1 && cfg.mode !== 'local' && !cfg.sharedCamera && mode !== 'free') {
          this.settings.camera = mode as Settings['camera'];
          this.save();
        }
      },
    };
    // En línea: el host reenvía sonidos y efectos a los clientes
    if (cfg.net?.role === 'host' && this.netHost) {
      const localCount = s.localCount;
      s.hooks = this.netHost.wrapHooks(s.hooks, (i) => {
        const c = s.robots[i]?.control;
        return c?.type === 'player' && c.slot < localCount;
      });
    }
    // Repetición: graba los matches (no las repeticiones ni la práctica); el cliente en línea graba
    // lo que le llega (ver joinRoom)
    this.lastReplay = null;
    if (s.match && !replay) {
      this.tap = new SessionTap(s);
      s.hooks = this.tap.wrapHooks(s.hooks);
    }
    // recompone el composer con la cámara nueva
    this.renderer.setQuality(this.renderer.quality, s.rigs[0].camera);
    // Sin robot propio (espectador) no hay controles táctiles
    this.touch.setEnabled(this.input.lastDevice === 'touch' && s.localPlayers().length > 0);
    this.hud.setPractice(cfg.mode === 'practice');
    const hpPlayer = Object.values(cfg.humanPlayers ?? {}).includes('player');
    this.touch.setButtonVisible('chute', hpPlayer);
    this.touch.setButtonVisible('throw', hpPlayer);
    this.hud.setVisible(true);
    this.closeOverlay();
    // (el espectador en línea puede entrar a medio match: sin cuenta regresiva)
    this.countdown = s.match && !replay && !(cfg.net?.role === 'client' && s.spectator) ? 3.2 : -1;
    if (replay) {
      const player = new ReplayPlayer(s, replay);
      s.replica = player;
      player.onEvent = (e) => this.applyNetEvent(e, -1);
      player.seek(player.start);
      this.replay = { player, back: () => this.screens.main() };
    }
    // Sin robot propio: controles del espectador (en una repetición, con la línea de tiempo)
    if (s.spectator) {
      const player = this.replay?.player;
      this.specBar = new SpectatorBar(this.uiEl, {
        session: s,
        player,
        highlights: replay ? highlights(replay) : undefined,
        canVideo: videoSupported(),
        onClipFile: (a, b) => void this.saveClip(a, b),
        onClipVideo: (a, b) => this.exportVideo(a, b),
        onShare: replay ? () => void this.offerReplayFile(replay) : undefined,
      });
    }
    this.effects.clear();
    this.autoQ = { t: 0, frames: 0, steps: 0 };
  }

  /** Práctica libre con el robot elegido. */
  startPractice(): void {
    const m = this.settings.match;
    this.startSession({
      mode: 'practice',
      robots: [
        {
          spec: robotById(m.robotId),
          alliance: m.alliance,
          station: m.station,
          control: { type: 'player', slot: 0 },
          startOffsetZ: m.startOffset * (m.alliance === 'blue' ? 1 : -1),
        },
      ],
      humanPlayers: { [m.alliance]: m.humanPlayer },
      fuelTotal: m.fuel,
      eventType: m.eventType,
      fouls: m.fouls,
      seed: (Math.random() * 2 ** 32) >>> 0,
    });
  }

  /** Match 3 vs 3: el jugador en su DRIVER STATION, los demás robots con presets variados. */
  startMatch(spectate = false): void {
    const m = this.settings.match;
    const robots: RobotSlotConfig[] = [];
    const pool = aiRobotPool(m.difficulty, spectate ? '' : m.robotId);
    const mirror = spectate && new URLSearchParams(location.search).has('mirror');
    let k = 0;
    for (const a of ALLIANCES)
      for (const ds of [1, 2, 3] as StationNumber[]) {
        const isPlayer = !spectate && a === m.alliance && ds === m.station;
        // `?mirror=1` (banco de pruebas): los mismos robots en las dos alianzas
        const spec = isPlayer ? robotById(m.robotId) : structuredClone(pool[(mirror ? ds - 1 : k++) % pool.length]);
        if (!isPlayer) {
          if (!spec.real) spec.teamNumber = 100 + Math.floor(Math.random() * 9800);
          spec.shooter.accuracy = Math.min(0.97, spec.shooter.accuracy * DIFFICULTY[this.difficultyOf[a] ?? m.difficulty].accuracy);
        }
        robots.push({
          spec,
          alliance: a,
          station: ds,
          control: isPlayer ? { type: 'player', slot: 0 } : { type: 'ai' },
          autoRoutine: isPlayer ? m.autoRoutine : undefined,
          startOffsetZ: isPlayer ? m.startOffset * (a === 'blue' ? 1 : -1) : 0,
          // Estrategia: la tuya para tu alianza (en espectador, la de azul) y la del rival (la de tu
          // DRIVER STATION es para que el drive coach te la recuerde)
          plan: planFor(strategyById(a === (spectate ? 'blue' : m.alliance) ? m.strategy : m.oppStrategy), a, ds),
        });
      }
    this.startSession({
      mode: 'match',
      robots,
      humanPlayers: { [m.alliance]: m.humanPlayer },
      aiAccuracy: DIFFICULTY[m.difficulty].hpAccuracy,
      aiDifficulty: m.difficulty,
      aiDifficultyOf: this.difficultyOf,
      training: new URLSearchParams(location.search).has('train'),
      fuelTotal: m.fuel,
      eventType: m.eventType,
      fouls: m.fouls,
      seed: (Math.random() * 2 ** 32) >>> 0,
    });
  }

  /** Multijugador local: 2–4 jugadores, cada uno con su dispositivo. */
  startLocal(players: LocalPlayer[], shared: boolean, fillAi: boolean): void {
    const m = this.settings.match;
    this.input.slots = players.map((p) => p.device);
    const robots: RobotSlotConfig[] = [];
    const used = new Set<string>();
    players.forEach((p, slot) => {
      const st = ([1, 2, 3] as StationNumber[]).find((d) => !used.has(`${p.alliance}${d}`));
      if (!st) return;
      used.add(`${p.alliance}${st}`);
      robots.push({ spec: robotById(p.robotId), alliance: p.alliance, station: st, control: { type: 'player', slot } });
    });
    let k = 0;
    if (fillAi)
      for (const a of ALLIANCES)
        for (const d of [1, 2, 3] as StationNumber[])
          if (!used.has(`${a}${d}`)) {
            const spec = structuredClone(ROBOT_PRESETS[k++ % ROBOT_PRESETS.length]);
            robots.push({ spec, alliance: a, station: d, control: { type: 'ai' } });
          }
    this.startSession({
      mode: 'local',
      robots,
      humanPlayers: {},
      aiDifficulty: m.difficulty,
      fuelTotal: m.fuel,
      eventType: m.eventType,
      fouls: m.fouls,
      sharedCamera: shared,
      seed: (Math.random() * 2 ** 32) >>> 0,
    });
  }

  // ------------------------------------------------------------------ en línea
  /** Abre una sala (eres el host); `quick`: de partida rápida (pública, arranca sola). */
  async hostRoom(quick = false): Promise<HostRoom> {
    this.leaveOnline();
    const room = await HostRoom.create();
    const m = this.settings.match;
    room.me = { name: this.settings.driverName, alliance: m.alliance, spec: robotById(m.robotId) };
    room.difficulty = m.difficulty;
    room.fuel = m.fuel;
    room.aiPool = () => aiRobotPool(this.settings.match.difficulty, '');
    room.onLeft = (name) => this.toast(t('net_left', { n: name }));
    this.netHost = room;
    if (quick) {
      room.onAutoStart = () => void this.startOnlineMatch();
      room.onLateJoin = (name) => this.toast(t('qm_lateJoined', { n: name }), 'good');
      // sin directorio la sala igual sirve (con código), pero nadie la encuentra
      await room.makeQuick().catch(() => this.toast(t('net_noDirectory'), 'major'));
      if (this.netHost === room) this.watchQuickMerge(room);
    }
    return room;
  }

  /**
   * Partida rápida (botón Jugar): entra a la mejor sala rápida pública con lugar (en el lobby o a
   * medio match, en lugar de un robot de la IA) o, si no hay, abre una propia. `status` va diciendo
   * en qué va; la promesa da la sala (host o cliente) y se cancela con `signal`.
   */
  async quickMatch(status: (key: TKey) => void, signal: AbortSignal): Promise<HostRoom | ClientRoom> {
    this.leaveOnline();
    status('qm_searching');
    const browser = new RoomBrowser();
    let rooms: PublicRoom[] = [];
    try {
      await browser.start();
      await new Promise((r) => setTimeout(r, QUICK.searchMs));
      rooms = browser.list;
    } catch {
      // sin directorio: se abre una sala (se juega con la IA)
    } finally {
      browser.stop();
    }
    const m = this.settings.match;
    const tried = new Set<string>();
    for (let k = 0; k < QUICK.tries; k++) {
      if (signal.aborted) throw new Error('cancel');
      const best = rankQuickRooms(rooms, tried)[0];
      if (!best) break;
      tried.add(best.code);
      status('qm_joining');
      try {
        const room = await this.joinRoom(best.code, m.alliance, m.robotId);
        if (signal.aborted) {
          this.leaveOnline();
          throw new Error('cancel');
        }
        return room;
      } catch (e) {
        if ((e as Error).message === 'cancel') throw e;
      }
    }
    if (signal.aborted) throw new Error('cancel');
    status('qm_hosting');
    const room = await this.hostRoom(true);
    if (signal.aborted) {
      this.leaveOnline();
      throw new Error('cancel');
    }
    return room;
  }

  /**
   * Host de un lobby rápido que sigue solo: si aparece otro lobby rápido al que le toca juntarse
   * (quickMatch.mergeTarget), cierra el suyo y entra a ese.
   */
  private watchQuickMerge(room: HostRoom): void {
    const browser = new RoomBrowser();
    let moving = false;
    const stop = () => browser.stop();
    browser.onChange = (rooms) => {
      if (this.netHost !== room || room.started) return stop();
      const target = moving ? null : mergeTarget({ code: room.code, players: room.lobby().players.filter((p) => !p.spectator).length }, rooms);
      if (!target) return;
      moving = true;
      stop();
      const m = this.settings.match;
      this.joinRoom(target.code, m.alliance, m.robotId)
        .then((c) => this.screens.onlineClient(c))
        .catch(() => {
          // (si no se pudo, a buscar de nuevo)
          if (!this.session) this.screens.quickPlay();
        });
    };
    browser.start().catch(stop);
    room.onClose = stop;
  }

  /** Entra a la sala de otro jugador. */
  async joinRoom(code: string, alliance: Alliance, robotId: string, spectate = false): Promise<ClientRoom> {
    this.leaveOnline();
    const room = await ClientRoom.join(code, { name: this.settings.driverName, alliance, spec: robotById(robotId), spectate });
    this.netClient = room;
    room.onStart = async (cfg, _robot, late) => {
      // CAD de la galería de la comunidad de los robots de otros jugadores (si tarda, diseño del simulador)
      await ensureCustomCads(cfg.robots.map((r) => r.spec), 5000);
      if (this.netClient !== room) return;
      this.closeOverlay();
      this.startSession(cfg);
      if (!this.session) return;
      const replica = room.attach(this.session);
      // la repetición del cliente: lo mismo que manda el host
      this.tap?.attach(replica);
      // a medio match (partida rápida): sin cuenta regresiva, ya está jugando
      if (late) {
        this.countdown = -1;
        this.field.setLeds(true);
        this.toast(t('qm_tookOver'), 'good');
      }
    };
    room.onEvent = (e) => this.onNetEvent(e);
    room.onClosed = () => {
      if (this.netClient !== room) return;
      this.netClient = null;
      this.toast(t('net_hostLeft'), 'major');
      if (this.session) this.quitToMenu();
      // en el lobby de una partida rápida: a buscar otra
      else if (room.lobby?.quick) this.screens.quickPlay();
      else this.screens.main();
    };
    return room;
  }

  /** Host: arranca (o repite) el match con los jugadores del lobby. */
  async startOnlineMatch(): Promise<void> {
    const room = this.netHost;
    if (!room) return;
    const m = this.settings.match;
    room.fillAi = room.lobby().fillAi;
    const robots = room.buildRobots();
    // CAD de la galería de la comunidad de los robots de los invitados (si tarda, diseño del simulador)
    await ensureCustomCads(robots.map((r) => r.spec), 5000);
    if (this.netHost !== room) return;
    for (const rc of robots)
      if (rc.control.type === 'ai') {
        if (!rc.spec.real) rc.spec.teamNumber = 100 + Math.floor(Math.random() * 9800);
        rc.spec.shooter.accuracy = Math.min(0.97, rc.spec.shooter.accuracy * DIFFICULTY[m.difficulty].accuracy);
      }
    this.startSession({
      mode: 'online',
      robots,
      humanPlayers: {},
      aiAccuracy: DIFFICULTY[m.difficulty].hpAccuracy,
      aiDifficulty: m.difficulty,
      fuelTotal: m.fuel,
      eventType: m.eventType,
      fouls: m.fouls,
      seed: (Math.random() * 2 ** 32) >>> 0,
      net: { role: 'host', localPlayers: 1 },
    });
    if (this.session) room.begin(this.session);
  }

  /** Cierra la sala propia o sale de la ajena. */
  leaveOnline(): void {
    this.netHost?.close();
    this.netHost = null;
    const c = this.netClient;
    this.netClient = null;
    c?.close();
  }

  /** Cliente: sonidos y efectos que manda el host. */
  private onNetEvent(e: NetEvent): void {
    const room = this.netClient;
    if (e.k === 'left') {
      this.toast(t('net_left', { n: e.name }));
      return;
    }
    if (room) this.applyNetEvent(e, room.robot);
  }

  /** Evento del host (o de la repetición) en la sesión que solo dibuja; `own` = robot propio. */
  private applyNetEvent(e: NetEvent, own: number): void {
    const s = this.session;
    if (!s?.replica) return;
    const h = s.hooks;
    if (e.k === 'match') {
      const m = s.match;
      if (m && e.e.type === 'phase') m.phase = e.e.phase;
      if (m && e.e.type === 'firstInactive') m.firstInactive = e.e.alliance;
      h.matchEvent?.(e.e);
    } else if (e.k === 'score') h.fuelScored?.(e.hub, e.counted, e.x, e.y, e.z);
    else if (e.k === 'launch' && s.robots[e.robot]) h.launch?.(s.robots[e.robot], e.kind, e.robot === own);
    else if (e.k === 'hp') h.hpAction?.(e.a, e.what);
    else if (e.k === 'impact') h.impact?.(e.s, e.robots.includes(own) ? 0 : -1, e.x, e.y, e.z, e.robots);
    else if (e.k === 'toast' && own >= 0 && e.robot === own) h.toast?.(e.key, e.robot);
  }

  /**
   * Juega un match del torneo con los equipos del calendario, o lo ve (`watch`: todos los robots
   * de la IA, con cámara de transmisión o desde las gradas).
   */
  playTournamentMatch(tt: Tournament, match: TMatch, watch?: 'broadcast' | 'stands'): void {
    const m = this.settings.match;
    // Con el plan del dashboard: el de ESTE match (el que guardaste o la sugerencia del drive coach;
    // los robots y las DRIVER STATIONS cambian de un match a otro)
    if (!watch && m.strategy === COACH_PLAN_ID) applyRows(rowsForMatch(tt, match).rows, this.settings, `${t('dash_title')} ${match.id}`);
    const robots: RobotSlotConfig[] = [];
    for (const [a, ids] of [
      ['red', match.red],
      ['blue', match.blue],
    ] as const)
      ids.forEach((ti, k) => {
        const team = watch ? { ...tt.teams[ti], isPlayer: false } : tt.teams[ti];
        const spec = robotById(team.specId);
        spec.teamNumber = team.team;
        if (!team.isPlayer) spec.shooter.accuracy = Math.min(0.97, spec.shooter.accuracy * (0.85 + 0.2 * team.strength));
        robots.push({
          spec,
          alliance: a,
          station: (k + 1) as StationNumber,
          control: team.isPlayer ? { type: 'player', slot: 0 } : { type: 'ai' },
          autoRoutine: team.isPlayer ? m.autoRoutine : undefined,
          startOffsetZ: team.isPlayer ? m.startOffset * (a === 'blue' ? 1 : -1) : 0,
          // Tu estrategia para tu alianza; los demás, en automático
          plan: planFor(strategyById(!watch && ids.some((x) => tt.teams[x].isPlayer) ? m.strategy : 'auto'), a, (k + 1) as StationNumber),
        });
      });
    this.startSession({
      mode: 'tournament',
      robots,
      humanPlayers: watch ? {} : { [robots.find((r) => r.control.type === 'player')!.alliance]: m.humanPlayer },
      aiDifficulty: m.difficulty,
      fuelTotal: m.fuel,
      eventType: tt.eventType,
      fouls: m.fouls,
      playoff: match.kind !== 'qual',
      seed: (Math.random() * 2 ** 32) >>> 0,
    });
    if (watch) this.session?.setCamera(watch);
    this.tournamentCtx = { tt, match };
  }

  /** Omite un match del torneo que se está viendo: se simula su resultado. */
  skipTournamentMatch(): void {
    const c = this.tournamentCtx;
    if (!c) return;
    const target = (c.match.kind === 'qual' ? c.tt.quals : c.tt.playoffs).find((x) => x.id === c.match.id);
    if (target && !target.result) target.result = simulateMatch(c.tt.teams, target, c.tt.eventType, new Rng((Math.random() * 2 ** 32) >>> 0));
    saveTournament(c.tt);
    this.endSessionExtras();
    this.session?.dispose();
    this.session = null;
    this.tournamentCtx = null;
    this.audio.stopMusic();
    this.closeOverlay();
    this.hud.setVisible(false);
    this.openTournament();
  }

  /** Guarda el resultado del match jugado en el torneo y vuelve a su pantalla. */
  private finishTournamentMatch(open = true): void {
    const c = this.tournamentCtx;
    const s = this.session;
    if (!c || !s?.match) return;
    const mm = s.match;
    const robotsOf = (a: Alliance) => s.robots.filter((r) => r.alliance === a).map((r) => r.index);
    const side = (a: Alliance) => ({
      score: mm.allianceDisqualified(a, robotsOf) ? 0 : mm.score(a),
      noFoul: mm.fuelPoints(a) + mm.towerPoints(a),
      autoFuel: mm.fuel[a].auto,
      tower: mm.towerPoints(a),
      rp: mm.rp(a, s.robots.some((r) => r.alliance === a && r.isPlayer && mm.disqualified.has(r.index))).total,
    });
    const target = (c.match.kind === 'qual' ? c.tt.quals : c.tt.playoffs).find((x) => x.id === c.match.id);
    // Desempeño por categoría (ranking del torneo): los robots van en el orden rojo, azul
    const ids = [...c.match.red, ...c.match.blue];
    const perf: Record<number, TeamPerf> = {};
    s.robots.forEach((r, k) => {
      const st = r.stats;
      const fouls = mm.fouls.filter((f) => f.robot === r.index).length;
      perf[ids[k]] = {
        fuel: st.fuelScored,
        passes: st.passes,
        defense: Math.round(st.defenseSec),
        driving: Math.round(Math.max(0, Math.min(100, 100 * (0.7 * Math.min(1, st.distance / 260) + 0.3 * Math.max(0, 1 - fouls * 0.2))))),
      };
    });
    if (target) target.result = { red: side('red'), blue: side('blue'), perf };
    saveTournament(c.tt);
    this.tournamentCtx = null;
    if (open) this.openTournament();
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
            this.input.hapticAll('shift');
            const n = e.phase.slice(-1);
            const active = this.session?.match?.isHubActive(player?.alliance ?? 'blue');
            this.toast(`SHIFT ${n} · HUB ${active ? t('hubActive') : t('hubInactive')}`.toUpperCase(), active ? 'good' : '');
            break;
          }
          case 'END_GAME':
            this.audio.steamWhistle();
            this.input.hapticAll('endgame');
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
        this.stadium.cheer(1);
        // pequeña pausa para ver las luces de "campo seguro" antes de los resultados (en una
        // repetición no: sigue la repetición)
        const s = this.session;
        if (!this.replay) setTimeout(() => this.session === s && this.showResults(), 1500);
        break;
      }
      case 'foul': {
        const f = e.foul;
        const team = this.session?.robots[f.robot]?.spec.teamNumber;
        this.toast(`${f.rule} – ${RULES[f.rule].title} · ${f.severity} FOUL${team ? ` (${team})` : ''}`, f.severity === 'MAJOR' ? 'major' : 'minor');
        this.audio.whistle();
        const fr = f.robot >= 0 ? this.session?.robots[f.robot] : undefined;
        if (fr?.isPlayer) {
          this.input.haptic(localSlot(fr, this.session?.localCount ?? 1), 'foul');
          this.toast(tx(RULES[f.rule]));
        }
        break;
      }
      case 'card': {
        const c = e.card;
        const team = this.session?.robots[c.robot]?.spec.teamNumber;
        this.toast(`${c.card === 'RED' ? t('redCard') : t('yellow')} · ${team} (${c.rule})`, c.card === 'RED' ? 'card-red' : 'card-yellow');
        break;
      }
      default:
        break;
    }
  }

  /** Pantalla de resultados del match. */
  showResults(): void {
    const s = this.session;
    if (!s) return;
    const res = buildResults(s);
    if (!res) return;
    // la repetición del match: se guarda sola; desde aquí se ve o se baja como archivo
    if (this.tap && !this.tap.finished) {
      const d = this.tap.finish(false, __APP_VERSION__);
      this.lastReplay = d;
      if (d) this.storeReplay(d);
    }
    // Estadísticas del jugador y rating (una vez por match); se publican si así lo quiere
    const saved = recordSession(s);
    if (saved?.rec) {
      if (saved.rec.delta) this.toast(t('st_ratingToast', { r: saved.rec.rating, d: `${saved.rec.delta > 0 ? '+' : ''}${saved.rec.delta}` }), saved.rec.delta > 0 ? 'good' : '');
      void syncBoard(saved.store, this.settings);
    }
    const inTournament = !!this.tournamentCtx;
    // (en línea no se ve aquí: el host sigue con la sala; queda en Repeticiones)
    const replay = this.lastReplay && !s.cfg.net ? this.lastReplay : null;
    this.openOverlay(renderResults(res, inTournament, !!replay), (a) => {
      if (a === 'continue') this.finishTournamentMatch();
      else if (a === 'rematch') this.restart();
      else if (a === 'replay' && replay) {
        const tour = !!this.tournamentCtx;
        if (tour) this.finishTournamentMatch(false);
        this.playReplay(replay, tour ? () => this.openTournament() : () => this.screens.replays());
      } else if (a === 'replayFile' && replay) void this.offerReplayFile(replay);
      else this.quitToMenu();
    });
    attachChartHover(this.overlay, res);
    const p = s.playerRobot(0);
    if (p) this.audio.speak(res.winner === 'tie' ? t('tie') : t('winner', { a: t(res.winner) }), getLang());
  }

  // ------------------------------------------------------------------ repeticiones
  /** Ve una repetición (`back` = a dónde se regresa al salir). */
  playReplay(d: ReplayData, back?: () => void): void {
    const cfg: SessionConfig = {
      ...structuredClone(d.cfg),
      // sin física ni IA: la sesión dibuja la grabación, como un cliente en línea espectador
      net: { role: 'client', localPlayers: 1 },
      sharedCamera: false,
      training: false,
      robots: d.cfg.robots.map((rc) => ({ ...structuredClone(rc), control: { type: 'none' as const }, plan: undefined })),
    };
    this.input.slots = [{ type: 'any' }];
    this.startSession(cfg, d);
    if (this.replay && back) this.replay.back = back;
    this.field.setLeds(true);
  }

  private replayName(d: ReplayData, ext: string, clip?: [number, number]): string {
    const dt = new Date(d.meta.date);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const day = `${dt.getFullYear()}${p2(dt.getMonth() + 1)}${p2(dt.getDate())}-${p2(dt.getHours())}${p2(dt.getMinutes())}`;
    const teams = `${d.meta.teams.red.join('-')}_vs_${d.meta.teams.blue.join('-')}`;
    return `rebuilt-${clip ? 'clip-' : ''}${day}-${teams}.${ext}`;
  }

  /** La repetición completa como archivo (compartir o descargar). */
  private async offerReplayFile(d: ReplayData): Promise<void> {
    const bytes = await serializeReplay(d);
    this.offerFile(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), this.replayName(d, 'rbreplay'), t('rp_clipReady'), t('rp_clipReadyDesc'));
  }

  /** Recorta [t0, t1] de la repetición en un archivo propio. */
  private async saveClip(t0: number, t1: number): Promise<void> {
    const r = this.replay;
    if (!r) return;
    const clip = clipReplay(r.player.data, t0, t1);
    const bytes = await serializeReplay(clip);
    this.offerFile(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), this.replayName(r.player.data, 'rbreplay', [t0, t1]), t('rp_clipReady'), t('rp_clipReadyDesc'));
  }

  /**
   * Graba [t0, t1] en video: lo reproduce a velocidad normal con la cámara elegida y copia cada
   * frame (con el marcador) al grabador.
   */
  private exportVideo(t0: number, t1: number): void {
    const r = this.replay;
    const s = this.session;
    if (!r || !s || this.video) return;
    if (!videoSupported()) {
      this.toast(t('rp_noVideo'), 'minor');
      return;
    }
    const tap = this.audio.tap();
    const vid = new ClipVideo(this.renderer.renderer.domElement, tap?.stream ?? null);
    r.player.seek(t0);
    r.player.speed = 1;
    r.player.playing = true;
    this.video = { vid, end: t1, stopAudio: () => tap?.stop() };
    this.specBar?.setVisible(false);
    this.uiEl.classList.add('recording');
    this.toast(`● ${t('rp_recording')}…`);
    vid.start();
  }

  private videoFrame(s: GameSession): void {
    const v = this.video!;
    const p = this.replay?.player;
    const m = s.match;
    v.vid.draw({
      red: m?.score('red') ?? 0,
      blue: m?.score('blue') ?? 0,
      timer: m ? formatTimer(m.phase === 'PRE' ? 20 : timerSeconds(m.t)) : '',
      phase: m ? PHASES[m.phase] : '',
      teams: {
        red: s.robots.filter((r) => r.alliance === 'red').map((r) => r.spec.teamNumber),
        blue: s.robots.filter((r) => r.alliance === 'blue').map((r) => r.spec.teamNumber),
      },
      label: 'REBUILT SIM',
    });
    if (!p || p.t < v.end - 1e-3 && p.playing) return;
    if (p) p.playing = false;
    this.video = null;
    v.stopAudio();
    this.uiEl.classList.remove('recording');
    this.specBar?.setVisible(true);
    void v.vid.stop().then((blob) => {
      const d = this.replay?.player.data;
      this.offerFile(blob, d ? this.replayName(d, v.vid.ext, [0, 0]) : `rebuilt-clip.${v.vid.ext}`, t('rp_videoReady'), '', true);
    });
  }

  /**
   * Diálogo para un archivo listo, encima de lo que haya (resultados, pausa): compartir (si el
   * sistema puede) o descargar; el video con vista previa.
   */
  private offerFile(blob: Blob, name: string, title: string, desc: string, video = false): void {
    const p = this.replay?.player;
    const wasPlaying = p?.playing ?? false;
    if (p) p.playing = false;
    const url = video ? URL.createObjectURL(blob) : '';
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    const canShare = !!nav.canShare?.({ files: [file] });
    const size = blob.size > 1e6 ? `${(blob.size / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(blob.size / 1e3))} KB`;
    const layer = document.createElement('div');
    layer.className = 'overlay file-layer';
    layer.innerHTML = `<div class="dialog file-ready">
        <h2>${esc(title)}</h2>
        ${video ? `<video src="${url}" controls autoplay muted playsinline></video>` : ''}
        <p class="fr-name"><b>${esc(name)}</b> · ${size}</p>
        ${desc ? `<p class="fr-desc">${esc(desc)}</p>` : ''}
        <div class="actions">
          ${canShare ? `<button data-a="share" class="primary">${t('rp_share')}</button>` : ''}
          <button data-a="download" class="${canShare ? '' : 'primary'}">${t('rp_download')}</button>
          <button data-a="close">${t('back')}</button>
        </div>
      </div>`;
    this.uiEl.appendChild(layer);
    layer.querySelectorAll<HTMLElement>('[data-a]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const a = btn.dataset.a;
        if (a === 'share') void shareOrDownload(blob, name, title);
        else if (a === 'download') download(blob, name);
        else {
          layer.remove();
          if (url) URL.revokeObjectURL(url);
          if (p && this.replay?.player === p && !this.session?.paused) p.playing = wasPlaying;
        }
      }),
    );
  }

  // ------------------------------------------------------------------ pausa / overlay
  /** Reinicia con la misma configuración. */
  restart(): void {
    const s = this.session;
    if (!s) return;
    if (s.cfg.net?.role === 'client') this.toast(t('net_waitHost'));
    else if (s.cfg.net) this.startOnlineMatch();
    else if (s.cfg.mode === 'practice') this.startPractice();
    else if (s.cfg.mode === 'match') this.startMatch(!s.players().length);
    else this.startSession({ ...s.cfg, seed: (Math.random() * 2 ** 32) >>> 0 });
  }

  togglePause(): void {
    const s = this.session;
    if (!s) return;
    // Esc mientras se graba un video: lo cancela
    if (this.video) {
      const v = this.video;
      this.video = null;
      v.stopAudio();
      void v.vid.stop();
      if (this.replay) this.replay.player.playing = false;
      this.uiEl.classList.remove('recording');
      this.specBar?.setVisible(true);
      return;
    }
    s.paused = !s.paused;
    // la repetición se detiene detrás del menú y sigue al cerrarlo
    const p = this.replay?.player;
    if (p) {
      if (s.paused) {
        this.replayWasPlaying = p.playing;
        p.playing = false;
      } else p.playing = this.replayWasPlaying;
    }
    this.specBar?.setVisible(!s.paused);
    if (s.paused) this.showPause();
    else this.closeOverlay();
  }

  private replayWasPlaying = false;

  /** Menú de pausa; `focusA` = acción que conserva el foco al redibujar (ajustes rápidos). */
  private showPause(focusA?: string): void {
    const s = this.session;
    if (!s) return;
    const m = s.match;
    const practice = s.cfg.mode === 'practice';
    const d = this.settings.drive;
    const rig = s.rigs[0];
    const icon = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;
    const I = {
      play: icon('M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z'),
      reset: icon('M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z'),
      restart: icon('M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z'),
      quit: icon('M10 17v-3H3v-4h7V7l5 5-5 5Zm4-14h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5v-2h5V5h-5V3Z'),
    };
    const toggle = (k: string, on: boolean, label: string) =>
      `<button class="ps-toggle ${on ? 'on' : ''}" data-nav data-a="t:${k}" role="switch" aria-checked="${on}"><span>${label}</span><i></i></button>`;
    const spectator = s.spectator;
    const cams = spectator ? SPECTATOR_CAMS : CAMERA_MODES.filter((c) => c !== 'free' || practice);
    const camOn = spectator ? s.spectatorCam : rig?.mode;
    const kb = (codes: string[]) => codes.map((k) => `<kbd>${esc(keyLabel(k, getLang()))}</kbd>`).join('');
    const K = this.settings.keys;
    const keys: Array<[string, string]> = [
      [t('ps_drive'), kb([K.moveUp[0], K.moveLeft[0], K.moveDown[0], K.moveRight[0]])],
      [t('ps_rotate'), kb([K.rotLeft[0], K.rotRight[0]])],
      [t('a_shoot'), kb(K.shoot.slice(0, 2))],
      [t('a_intake'), kb(K.intake.slice(0, 2))],
      [t('a_pass'), kb(K.pass.slice(0, 1))],
      [t('ps_climb'), kb([K.climbUp[0], K.climbDown[0]])],
      [t('a_cameraNext'), kb(K.cameraNext.slice(0, 1))],
      [t('a_slow'), kb(K.slow.slice(0, 1))],
    ];
    const modeLabel = this.replay ? t('rp_title') : practice ? t('practice') : s.cfg.mode === 'tournament' ? t('tournament') : s.cfg.mode === 'local' ? t('local') : s.cfg.mode === 'online' ? t('online') : t('match');
    const score = m
      ? `<div class="ps-score">
          <div class="red"><span>${t('red')}</span><b>${m.score('red')}</b></div>
          <div class="mid"><b>${formatTimer(m.phase === 'PRE' ? 20 : timerSeconds(m.t))}</b><span>${PHASE_LABEL[m.phase]}</span></div>
          <div class="blue"><b>${m.score('blue')}</b><span>${t('blue')}</span></div>
        </div>`
      : '';
    this.openOverlay(
      `<div class="pause">
        <section class="ps-main">
          <div class="ps-kicker"><span></span>${esc(modeLabel)}</div>
          <h2>${t('paused')}</h2>
          ${score}
          <nav class="ps-menu">
            <button data-a="resume" class="primary" data-nav data-nav-default>${I.play}<span>${t('resume')}</span><kbd>Esc</kbd></button>
            ${practice ? `<button data-a="reset" data-nav>${I.reset}<span>${t('resetField')}</span></button>` : ''}
            ${this.tournamentCtx || s.replica ? '' : `<button data-a="restart" data-nav>${I.restart}<span>${t('restart')}</span></button>`}
            ${this.replay ? `<button data-a="replayFile" data-nav>${I.restart}<span>${t('rp_saveFile')}</span></button>` : ''}
            ${this.tournamentCtx && !s.players().length ? `<button data-a="skipMatch" data-nav>${I.restart}<span>${t('skipMatch')}</span></button>` : ''}
            <button data-a="quit" class="quit" data-nav>${I.quit}<span>${t('quit')}</span></button>
          </nav>
        </section>
        <aside class="ps-side">
          <h3>${t('ps_quick')}</h3>
          <div class="ps-toggles">
            ${toggle('autoAim', d.autoAim, t('autoAim'))}
            ${toggle('shootOnMove', d.shootOnMove, t('shootOnMove'))}
            ${toggle('aimGuide', d.aimGuide, t('aimGuide'))}
            ${toggle('fieldRelative', d.fieldRelative, t('fieldRelative'))}
            ${toggle('cameraShake', this.settings.cameraShake, t('cameraShake'))}
          </div>
          <label class="ps-vol"><span>${t('volMaster')}</span><input type="range" min="0" max="1" step="0.05" value="${this.settings.audio.master}" data-vol/><b data-volv>${Math.round(this.settings.audio.master * 100)}%</b></label>
          ${
            rig && Math.min(s.rigs.length, s.localCount) === 1
              ? `<h3>${t('camera')}</h3><div class="ps-cams">${cams.map((c) => `<button class="chipbtn ${camOn === c ? 'on' : ''}" data-nav data-a="c:${c}">${t(`cam_${c}` as TKey)}</button>`).join('')}</div>`
              : ''
          }
          <h3 class="ps-kh">${t('controls')}</h3>
          <div class="ps-keys">${keys.map(([l, k]) => `<div><span>${l}</span><span class="k">${k}</span></div>`).join('')}</div>
        </aside>
      </div>`,
      (a) => {
        if (a === 'resume') this.togglePause();
        else if (a === 'reset') {
          this.session?.resetField();
          this.togglePause();
        } else if (a === 'restart') this.restart();
        else if (a === 'skipMatch') this.skipTournamentMatch();
        else if (a === 'replayFile' && this.replay) void this.offerReplayFile(this.replay.player.data);
        else if (a === 'quit') this.quitToMenu();
        else if (a.startsWith('t:')) {
          const k = a.slice(2);
          if (k === 'cameraShake') this.settings.cameraShake = !this.settings.cameraShake;
          else {
            const key = k as 'autoAim' | 'shootOnMove' | 'aimGuide' | 'fieldRelative';
            d[key] = !d[key];
            if (key === 'fieldRelative') for (const r of s.localPlayers()) r.fieldRelative = d.fieldRelative;
          }
          this.save();
          this.showPause(a);
        } else if (a.startsWith('c:')) {
          if (spectator) s.setSpectatorCam(a.slice(2) as typeof s.spectatorCam);
          else s.setCamera(a.slice(2) as CameraMode);
          this.showPause(a);
        }
      },
    );
    this.pauseNav = new MenuNav(this.overlay, { onBack: () => this.togglePause() });
    if (focusA) {
      const i = Array.from(this.overlay.querySelectorAll<HTMLElement>('[data-nav]')).findIndex((e) => e.dataset.a === focusA);
      if (i >= 0) this.pauseNav.focus(i, false);
    }
    this.pausePad.poll(0); // el botón que abrió la pausa no cuenta como "aceptar"
    const vol = this.overlay.querySelector<HTMLInputElement>('[data-vol]');
    vol?.addEventListener('input', () => {
      this.settings.audio.master = Number(vol.value);
      this.overlay.querySelector('[data-volv]')!.textContent = `${Math.round(this.settings.audio.master * 100)}%`;
      this.save();
    });
  }

  openOverlay(html: string, onAction: (a: string) => void): void {
    this.overlay.innerHTML = html;
    this.overlay.classList.remove('hidden');
    this.overlay.querySelectorAll<HTMLElement>('[data-a]').forEach((b) =>
      b.addEventListener('click', () => onAction(b.dataset.a!)),
    );
  }

  closeOverlay(): void {
    this.pauseNav = null;
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
    let inputs = this.input.poll();
    const s = this.session;
    if (s && this.netHost?.session === s) inputs = this.netHost.mergeInputs(inputs);
    this.screens.tick(dt);
    this.clock += dt;
    this.stadium.update(dt, this.clock);
    this.effects.update(dt);
    if (s) {
      this.updateArenaScreen(s);
      this.emitTrails(s);
      this.autoQuality(dt, s);
    }
    if (s?.paused && this.pauseNav) {
      const acts = this.pausePad.poll(dt);
      // Start/Esc ya pausan/reanudan por la entrada del juego: no se cuentan dos veces
      if (!inputs[0]?.pressed.has('pause')) for (const a of acts) this.pauseNav.handle(a);
    }
    if (s && inputs[0]?.pressed.has('pause')) this.togglePause();
    if (s) {
      this.runCountdown(dt, s);
      const t0 = performance.now();
      s.update(dt, inputs);
      const t1 = performance.now();
      const views = s.frame(dt);
      this.renderer.render(views);
      if (this.video) this.videoFrame(s);
      const t2 = performance.now();
      this.specBar?.update(dt);
      this.fpsAcc.sim += t1 - t0;
      this.fpsAcc.gpu += t2 - t1;
      this.updateHud(s, views);
      this.tickOnline(dt, s, inputs[0]);
    } else if (!this.screens.visible) {
      // Sin menú encima: el campo gira lentamente de fondo
      this.menuAngle += dt * 0.06;
      this.menuCam.position.set(Math.cos(this.menuAngle) * 13, 6.5, Math.sin(this.menuAngle) * 9);
      this.menuCam.lookAt(0, 0.4, 0);
      this.renderer.render([{ camera: this.menuCam, x: 0, y: 0, w: 1, h: 1 }]);
    }
    const f = this.fpsAcc;
    f.frames++;
    f.time += dt;
    if (f.time >= 0.5) {
      f.fps = f.frames / f.time;
      const perf = { sim: f.sim / f.frames, render: f.gpu / f.frames };
      (window as unknown as { __perf: typeof perf }).__perf = perf;
      f.sim = 0;
      f.gpu = 0;
      f.frames = 0;
      f.time = 0;
      this.fpsEl.style.display = this.settings.showFps ? '' : 'none';
      if (this.settings.showFps) {
        const info = this.renderer.info.render;
        this.fpsEl.textContent = `${f.fps.toFixed(0)} FPS · ${this.renderer.quality} · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · sim ${((window as unknown as { __perf: { sim: number } }).__perf?.sim ?? 0).toFixed(1)} ms · render ${((window as unknown as { __perf: { render: number } }).__perf?.render ?? 0).toFixed(1)} ms`;
      }
    }
    (window as unknown as { __fps: number }).__fps = f.fps;
  }

  /** En línea: el host manda el estado; el cliente, sus controles y su cámara. */
  private tickOnline(dt: number, s: GameSession, inp: PlayerInput | undefined): void {
    if (this.netHost?.session === s) this.netHost.tick(dt);
    const c = this.netClient;
    // (el espectador no manda controles)
    if (c && s.replica && inp && c.robot >= 0) {
      const cam = s.rigs[0].camera;
      const p = cam.position;
      const q = cam.quaternion;
      const r3 = (v: number) => Math.round(v * 1000) / 1000;
      c.sendInput(s.paused ? emptyInput() : inp, {
        p: [r3(p.x), r3(p.y), r3(p.z)],
        q: [r3(q.x), r3(q.y), r3(q.z), r3(q.w)],
        fov: cam.fov,
        aspect: r3(cam.aspect),
        mode: s.rigs[0].mode,
      });
    }
  }

  /** Pantalla gigante con el marcador. */
  private updateArenaScreen(s: GameSession): void {
    const m = s.match;
    if (!m) this.stadium.setScreen(t('practiceMode'), '', '');
    else this.stadium.setScreen(formatTimer(m.phase === 'PRE' ? 20 : timerSeconds(m.t)), String(m.score('red')), String(m.score('blue')));
  }

  /** Estela sutil de los FUEL disparados (cada 2 frames). */
  private trailFrame = 0;
  private emitTrails(s: GameSession): void {
    if (this.renderer.quality === 'low' || s.paused || (this.trailFrame++ & 1)) return;
    const f = s.fuel;
    for (let i = 0; i < f.count; i++)
      if (f.state[i] === FuelState.Field && f.flags[i] & FLAG_SHOT) this.effects.trail(f.pos[i * 3], f.pos[i * 3 + 1], f.pos[i * 3 + 2]);
  }

  /**
   * Calidad "Auto": mide FPS entre los segundos 2 y 6 de cada sesión; si el promedio es
   * menor a 42, baja un nivel (hasta 2 veces) y lo recuerda para la próxima vez.
   */
  private autoQuality(dt: number, s: GameSession): void {
    if (this.settings.quality !== 'auto' || s.paused || this.autoQ.steps >= 2) return;
    const a = this.autoQ;
    a.t += dt;
    if (a.t < 2) return;
    a.frames++;
    if (a.t < 6) return;
    const fps = a.frames / (a.t - 2);
    const i = QUALITY_ORDER.indexOf(this.renderer.quality);
    if (fps < 42 && i > 0) {
      const q = QUALITY_ORDER[i - 1];
      this.renderer.setQuality(q, s.rigs[0].camera);
      saveJSON('rebuilt-sim.autoQuality', q);
      this.toast(t('qualityAuto', { q: t(`q_${q}` as TKey) }));
      a.steps++;
      a.t = 0;
      a.frames = 0;
    } else a.steps = 2;
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

  private updateHud(s: GameSession, views: Viewport[]): void {
    // Contadores de PIN (G418) encima del robot pineado
    const pins = s.pins();
    const cam = s.rigs[0].camera;
    this.hud.setPins(
      pins
        .map((p) => {
          const v = s.robots[p.victim].view.group.position.clone();
          v.y += 1.0;
          v.project(cam);
          return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight, seconds: p.seconds, z: v.z };
        })
        .filter((p) => p.z < 1),
    );
    const r0 = s.playerRobot(0);
    if (r0) this.touch.setActive('intake', r0.intakeOn);
    const phase = s.phase;
    const players = s.localPlayers();
    const multi = players.length > 1;
    this.hud.update(
      s.match,
      s.cfg.eventType,
      players.map((r): PlayerHudInfo => {
        const slot = (r.control as { slot: number }).slot;
        const rig = s.rigs[Math.min(slot, s.rigs.length - 1)];
        const dev = this.input.slots[slot];
        return {
          robotName: r.spec.name,
          team: r.spec.teamNumber,
          alliance: r.alliance,
          hopper: s.fuel.robotCount(r.index),
          capacity: r.spec.hopperCapacity,
          fieldRelative: r.fieldRelative,
          camera: t(`cam_${rig.mode}` as TKey),
          intakeOn: r.intakeOn,
          autoAim: this.settings.drive.autoAim,
          climb: r.climbing ? `CLIMB L${r.climb.level()}${r.climb.attached ? '' : '…'}` : null,
          outpost: (() => {
            const hp = s.humanPlayers[r.alliance];
            const f = s.fuel;
            return `${t('chute')} ${f.chute[r.alliance].length}${hp.doorOpen ? ' ▼' : ''} · ${t('corral')} ${f.corral[r.alliance].length}`;
          })(),
          disabled: r.disabled,
          note: phase === 'AUTO' ? t('autoRunning') : null,
          tag: multi ? `${t('playerShort', { n: slot + 1 })}${dev ? ` · ${deviceName(dev)}` : ''}` : undefined,
        };
      }),
      views.length > 1 ? views : null,
    );
  }

  get fps(): number {
    return this.fpsAcc.fps;
  }

  get container(): HTMLElement {
    return this.appEl;
  }
}

/**
 * Robots de la IA: los robots reales de la temporada, sin repetir el del jugador. En Fácil van en
 * orden fijo (lo usan los escenarios e2e); en las demás dificultades, al azar.
 */
/** Slot local del jugador que maneja el robot (−1 si es de la IA o de un jugador remoto). */
function localSlot(r: Robot, localCount: number): number {
  return r.control.type === 'player' && r.control.slot < localCount ? r.control.slot : -1;
}

function aiRobotPool(difficulty: string, playerId: string): RobotSpec[] {
  const top = CAD_ROBOTS.filter((r) => r.id !== playerId);
  if (difficulty === 'easy') return top;
  return top.map((v) => [Math.random(), v] as const).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
}

/** Nombre corto del dispositivo de un jugador local (para su panel del HUD). */
function deviceName(d: SlotDevice): string {
  if (d.type === 'keyboard') return t('keyboard');
  if (d.type === 'gamepad') return `${t('gamepad')} ${d.index + 1}`;
  if (d.type === 'touch') return t('touch');
  return '';
}
