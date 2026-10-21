/**
 * Orquestador: ajustes, renderer, campo persistente, entrada, audio, HUD, sesión activa y bucle.
 */
import { planFor, strategyById } from '../ai/Strategy';
import { AudioEngine } from '../audio/Audio';
import { DIFFICULTY } from '../ai/RobotAI';
import * as THREE from 'three';
import * as F from '../config/field';
import { CAD_ROBOTS, robotById, ROBOT_PRESETS, type RobotSpec } from '../config/robots';
import type { Tournament, TMatch } from '../core/tournament';
import { StrategyPlanner } from '../ui/StrategyPlanner';
import { AutoDesigner } from '../ui/AutoDesigner';
import { Screens, type LocalPlayer } from '../ui/Menu';
import { RobotEditor } from '../ui/RobotEditor';
import { saveTournament, TournamentScreen } from '../ui/TournamentScreen';
import { loadSettings, saveSettings, type Settings } from '../config/settings';
import type { MatchEvent } from '../core/match';
import { ALLIANCES, type Alliance, type StationNumber } from '../core/types';
import { GameSession, type RobotSlotConfig, type SessionConfig } from '../game/GameSession';
import { InputManager } from '../input/InputManager';
import { TouchControls } from '../input/TouchControls';
import { FieldView } from '../render/FieldView';
import { Effects } from '../render/Effects';
import { ALLIANCE_COLOR } from '../render/FieldView';
import { QUALITY_ORDER, Renderer, type Quality } from '../render/Renderer';
import { Showroom } from '../render/Showroom';
import { Stadium } from '../render/Stadium';
import { FLAG_SHOT, FuelState } from '../physics/FuelSystem';
import { formatTimer, timerSeconds } from '../core/clock';
import { loadJSON, saveJSON } from '../config/settings';
import { buildResults } from '../game/results';
import { RULES } from '../core/fouls';
import { Hud, PHASE_LABEL } from '../ui/Hud';
import { esc } from '../ui/forms';
import { keyToNav, MenuNav, PadNav } from '../ui/nav';
import { keyLabel } from '../input/actions';
import { CAMERA_MODES, type CameraMode } from '../render/CameraRig';
import { attachChartHover, renderResults } from '../ui/Results';
import { getLang, setLang, t, tx, type TKey } from '../ui/i18n';

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
  private countdownShown = -1;
  readonly screens: Screens;
  private designer: AutoDesigner;
  private planner: StrategyPlanner;
  /** A dónde regresa el planeador (menú principal o configuración del match). */
  private plannerBack: () => void = () => this.screens.main();
  private editor: RobotEditor;
  private tourney: TournamentScreen;
  private menuCam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  private menuAngle = 0;
  /** Evento `beforeinstallprompt` (PWA) guardado para el botón "Instalar app". */
  installPrompt: (Event & { prompt: () => Promise<void> }) | null = null;
  /** Match de torneo en curso. */
  private tournamentCtx: { tt: Tournament; match: TMatch } | null = null;
  private doneLayoutBtn: HTMLButtonElement | null = null;

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
    this.input.onDeviceChange.push((d) => this.touch.setEnabled(d === 'touch' && !!this.session?.players().length));
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.renderer.onQualityChange.forEach((cb) => cb(this.renderer.preset));
    });
    document.addEventListener('visibilitychange', () => {
      // Pausa automática al perder el foco
      if (document.hidden && this.session && !this.session.paused) this.togglePause();
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
    this.editor = new RobotEditor(this.screens.root, this.screens.showroom, back, (id) => {
      this.settings.match.robotId = id;
      this.save();
      this.screens.setup('match');
    });
    this.tourney = new TournamentScreen(this.screens.root, this.settings, back, (tt, m) => this.playTournamentMatch(tt, m));
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
    this.screens.main();
  }

  private openScreen(): void {
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
    this.designer.open(this.settings.match.autoRoutine);
  }

  openRobotEditor(): void {
    this.openScreen();
    this.editor.open(this.settings.match.robotId);
  }

  openTournament(): void {
    this.openScreen();
    this.tourney.open();
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
  startSession(cfg: SessionConfig): void {
    this.session?.dispose();
    this.audio.stopMusic();
    this.screens.hide();
    this.doneLayoutBtn?.remove();
    if (cfg.mode !== 'local') this.input.slots = [{ type: 'any' }];
    const s = new GameSession(cfg, this.renderer, this.field, this.settings);
    this.session = s;
    s.hooks = {
      toast: (k) => this.toast(t(k)),
      matchEvent: (e) => this.onMatchEvent(e),
      fuelScored: (hub, counted) => {
        if (!counted) return;
        this.audio.score();
        const c = F.hubCenter(hub);
        this.effects.emit(c.x, F.HUB_RIM_HEIGHT + 0.1, c.z, 14, { color: ALLIANCE_COLOR[hub], speed: 2.4, up: 1.5, life: 0.7, size: 0.07, gravity: 4 });
        this.effects.emit(c.x, F.HUB_RIM_HEIGHT + 0.1, c.z, 6, { color: 0xffd54f, speed: 2, up: 2, life: 0.8, size: 0.06, gravity: 4 });
        this.stadium.cheer(0.08);
      },
      launch: (_r, _kind, isPlayer) => {
        if (isPlayer) this.audio.shoot();
      },
      hpAction: (a, what) => {
        if (what === 'door') this.toast(s.humanPlayers[a].doorOpen ? t('chuteOpen') : t('chuteClosed'));
      },
      impact: (strength, slot, x, y, z) => {
        this.audio.hit(strength);
        this.effects.emit(x, y, z, Math.round(6 + 14 * strength), { color: 0xffb74d, speed: 2.5 + 3 * strength, spread: 1.2, life: 0.35, size: 0.03, gravity: 9 });
        if (slot >= 0) {
          s.rigs[Math.min(slot, s.rigs.length - 1)]?.addShake(strength * 0.12);
          this.input.rumble(slot, strength, 120);
        }
      },
      cameraChange: (mode) => {
        this.toast(`${t('camera')}: ${t(`cam_${mode}` as TKey)}`);
        // Recuerda la cámara elegida (un solo jugador; la libre es solo de práctica)
        if (s.rigs.length === 1 && cfg.mode !== 'local' && !cfg.sharedCamera && mode !== 'free') {
          this.settings.camera = mode as Settings['camera'];
          this.save();
        }
      },
    };
    // recompone el composer con la cámara nueva
    this.renderer.setQuality(this.renderer.quality, s.rigs[0].camera);
    // Sin robot propio (espectador) no hay controles táctiles
    this.touch.setEnabled(this.input.lastDevice === 'touch' && s.players().length > 0);
    this.hud.setPractice(cfg.mode === 'practice');
    const hpPlayer = Object.values(cfg.humanPlayers ?? {}).includes('player');
    this.touch.setButtonVisible('chute', hpPlayer);
    this.touch.setButtonVisible('throw', hpPlayer);
    this.hud.setVisible(true);
    this.closeOverlay();
    if (s.match) this.countdown = 3.2;
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
    let k = 0;
    for (const a of ALLIANCES)
      for (const ds of [1, 2, 3] as StationNumber[]) {
        const isPlayer = !spectate && a === m.alliance && ds === m.station;
        const spec = isPlayer ? robotById(m.robotId) : structuredClone(pool[k++ % pool.length]);
        if (!isPlayer) {
          if (!spec.real) spec.teamNumber = 100 + Math.floor(Math.random() * 9800);
          spec.shooter.accuracy = Math.min(0.97, spec.shooter.accuracy * DIFFICULTY[m.difficulty].accuracy);
        }
        robots.push({
          spec,
          alliance: a,
          station: ds,
          control: isPlayer ? { type: 'player', slot: 0 } : { type: 'ai' },
          autoRoutine: isPlayer ? m.autoRoutine : undefined,
          startOffsetZ: isPlayer ? m.startOffset * (a === 'blue' ? 1 : -1) : 0,
          // Estrategia: la tuya para tu alianza (en espectador, la de azul) y la del rival
          plan: isPlayer ? undefined : planFor(strategyById(a === (spectate ? 'blue' : m.alliance) ? m.strategy : m.oppStrategy), a, ds),
        });
      }
    this.startSession({
      mode: 'match',
      robots,
      humanPlayers: { [m.alliance]: m.humanPlayer },
      aiAccuracy: { easy: 0.6, normal: 0.78, hard: 0.88, einstein: 0.95 }[m.difficulty],
      aiDifficulty: m.difficulty,
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

  /** Juega un match del torneo con los equipos del calendario. */
  playTournamentMatch(tt: Tournament, match: TMatch): void {
    const m = this.settings.match;
    const robots: RobotSlotConfig[] = [];
    for (const [a, ids] of [
      ['red', match.red],
      ['blue', match.blue],
    ] as const)
      ids.forEach((ti, k) => {
        const team = tt.teams[ti];
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
          plan: team.isPlayer ? undefined : planFor(strategyById(ids.some((x) => tt.teams[x].isPlayer) ? m.strategy : 'auto'), a, (k + 1) as StationNumber),
        });
      });
    this.startSession({
      mode: 'tournament',
      robots,
      humanPlayers: { [robots.find((r) => r.control.type === 'player')!.alliance]: m.humanPlayer },
      aiDifficulty: m.difficulty,
      fuelTotal: m.fuel,
      eventType: tt.eventType,
      fouls: m.fouls,
      playoff: match.kind !== 'qual',
      seed: (Math.random() * 2 ** 32) >>> 0,
    });
    this.tournamentCtx = { tt, match };
  }

  /** Guarda el resultado del match jugado en el torneo y vuelve a su pantalla. */
  private finishTournamentMatch(): void {
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
    if (target) target.result = { red: side('red'), blue: side('blue') };
    saveTournament(c.tt);
    this.tournamentCtx = null;
    this.openTournament();
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
      case 'end':
        this.stadium.cheer(1);
        // pequeña pausa para ver las luces de "campo seguro" antes de los resultados
        setTimeout(() => this.showResults(), 1500);
        break;
      case 'foul': {
        const f = e.foul;
        const team = this.session?.robots[f.robot]?.spec.teamNumber;
        this.toast(`${f.rule} – ${RULES[f.rule].title} · ${f.severity} FOUL${team ? ` (${team})` : ''}`, f.severity === 'MAJOR' ? 'major' : 'minor');
        this.audio.whistle();
        if (f.robot >= 0 && this.session?.robots[f.robot]?.isPlayer) {
          this.input.rumble(0, 0.4, 150);
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
    const inTournament = !!this.tournamentCtx;
    this.openOverlay(renderResults(res, inTournament), (a) => {
      if (a === 'continue') this.finishTournamentMatch();
      else if (a === 'rematch') this.restart();
      else this.quitToMenu();
    });
    attachChartHover(this.overlay, res);
    const p = s.playerRobot(0);
    if (p) this.audio.speak(res.winner === 'tie' ? t('tie') : t('winner', { a: t(res.winner) }), getLang());
  }

  // ------------------------------------------------------------------ pausa / overlay
  /** Reinicia con la misma configuración. */
  restart(): void {
    const s = this.session;
    if (!s) return;
    if (s.cfg.mode === 'practice') this.startPractice();
    else if (s.cfg.mode === 'match') this.startMatch(!s.players().length);
    else this.startSession({ ...s.cfg, seed: (Math.random() * 2 ** 32) >>> 0 });
  }

  togglePause(): void {
    const s = this.session;
    if (!s) return;
    s.paused = !s.paused;
    if (s.paused) this.showPause();
    else this.closeOverlay();
  }

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
    const cams = CAMERA_MODES.filter((c) => c !== 'free' || practice);
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
    const modeLabel = practice ? t('practice') : s.cfg.mode === 'tournament' ? t('tournament') : s.cfg.mode === 'local' ? t('local') : t('match');
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
            ${this.tournamentCtx ? '' : `<button data-a="restart" data-nav>${I.restart}<span>${t('restart')}</span></button>`}
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
            rig && s.rigs.length === 1
              ? `<h3>${t('camera')}</h3><div class="ps-cams">${cams.map((c) => `<button class="chipbtn ${rig.mode === c ? 'on' : ''}" data-nav data-a="c:${c}">${t(`cam_${c}` as TKey)}</button>`).join('')}</div>`
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
        else if (a === 'quit') this.quitToMenu();
        else if (a.startsWith('t:')) {
          const k = a.slice(2);
          if (k === 'cameraShake') this.settings.cameraShake = !this.settings.cameraShake;
          else {
            const key = k as 'autoAim' | 'shootOnMove' | 'aimGuide' | 'fieldRelative';
            d[key] = !d[key];
            if (key === 'fieldRelative') for (const r of s.players()) r.fieldRelative = d.fieldRelative;
          }
          this.save();
          this.showPause(a);
        } else if (a.startsWith('c:')) {
          s.setCamera(a.slice(2) as CameraMode);
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
    const inputs = this.input.poll();
    const s = this.session;
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
      const t2 = performance.now();
      this.fpsAcc.sim += t1 - t0;
      this.fpsAcc.gpu += t2 - t1;
      this.updateHud(s);
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

  private updateHud(s: GameSession): void {
    // Contadores de PIN (G418) encima del robot pineado
    const pins = s.referee?.activePins() ?? [];
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
    const r = s.playerRobot(0);
    if (r) this.touch.setActive('intake', r.intakeOn);
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
            climb: r.climbing ? `CLIMB L${r.climb.level()}${r.climb.attached ? '' : '…'}` : null,
            outpost: (() => {
              const hp = s.humanPlayers[r.alliance];
              const f = s.fuel;
              return `${t('chute')} ${f.chute[r.alliance].length}${hp.doorOpen ? ' ▼' : ''} · ${t('corral')} ${f.corral[r.alliance].length}`;
            })(),
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

/**
 * Robots de la IA: los robots reales de la temporada, sin repetir el del jugador. En Fácil van en
 * orden fijo (lo usan los escenarios e2e); en las demás dificultades, al azar.
 */
function aiRobotPool(difficulty: string, playerId: string): RobotSpec[] {
  const top = CAD_ROBOTS.filter((r) => r.id !== playerId);
  if (difficulty === 'easy') return top;
  return top.map((v) => [Math.random(), v] as const).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
}
