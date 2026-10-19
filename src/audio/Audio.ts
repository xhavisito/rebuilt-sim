/**
 * Audio 100 % sintetizado con Web Audio (sin archivos ni audio oficial).
 * Cues del FMS (Tabla 5-4): "Cavalry Charge", "Buzzer", "3 Bells", "Power Up – Linear Popping",
 * "Steam Whistle", "Foghorn". Más efectos, un loop de música ligero y voces (SpeechSynthesis).
 * Buses de volumen separados: música, efectos y voces.
 */
import type { Settings } from '../config/settings';

type Wave = OscillatorType;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;
  private lastHit = 0;

  constructor(private settings: Settings) {
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    return ctx;
  }

  updateSettings(s: Settings): void {
    this.settings = s;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const a = this.settings.audio;
    this.master.gain.value = a.master;
    this.sfxBus.gain.value = a.sfx;
    this.musicBus.gain.value = a.music * 0.5;
  }

  // ------------------------------------------------------------------ primitivas
  private tone(
    freq: number,
    start: number,
    dur: number,
    opts: { wave?: Wave; gain?: number; attack?: number; release?: number; to?: number; filter?: number; bus?: GainNode; vibrato?: number } = {},
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = opts.wave ?? 'sine';
    o.frequency.setValueAtTime(freq, start);
    if (opts.to) o.frequency.linearRampToValueAtTime(opts.to, start + dur);
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 5.5;
      lg.gain.value = opts.vibrato;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(start);
      lfo.stop(start + dur + 0.3);
    }
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.3;
    const atk = opts.attack ?? 0.01;
    const rel = opts.release ?? 0.08;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + atk);
    g.gain.setValueAtTime(peak, start + Math.max(atk, dur - rel));
    g.gain.linearRampToValueAtTime(0, start + dur);
    let node: AudioNode = o;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.filter;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(opts.bus ?? this.sfxBus);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  private noise(start: number, dur: number, opts: { gain?: number; filter?: number; type?: BiquadFilterType; q?: number; bus?: GainNode; decay?: boolean } = {}): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.filter ?? 1000;
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.2;
    g.gain.setValueAtTime(peak, start);
    if (opts.decay) g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    else g.gain.setValueAtTime(0, start + dur);
    src.connect(f).connect(g).connect(opts.bus ?? this.sfxBus);
    src.start(start, Math.random() * 0.5);
    src.stop(start + dur + 0.05);
  }

  /** Tiempo de audio actual, o null si el contexto aún no se desbloqueó con un gesto. */
  private now(): number | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    return ctx.currentTime;
  }

  // ------------------------------------------------------------------ cues del FMS
  /** Inicio del match: "Cavalry Charge" (trompeta sintetizada). */
  cavalryCharge(): void {
    const t = this.now();
    if (t === null) return;
    const N = { G4: 392, C5: 523.25, E5: 659.25, G5: 783.99 };
    const seq: Array<[number, number, number]> = [
      [N.G4, 0, 0.13],
      [N.C5, 0.15, 0.13],
      [N.E5, 0.3, 0.13],
      [N.G5, 0.45, 0.32],
      [N.E5, 0.82, 0.13],
      [N.G5, 0.97, 0.75],
    ];
    for (const [f, s, d] of seq) {
      this.tone(f, t + s, d, { wave: 'sawtooth', gain: 0.18, attack: 0.02, filter: 2600, vibrato: s > 0.9 ? 6 : 0 });
      this.tone(f * 2, t + s, d, { wave: 'square', gain: 0.03, attack: 0.02, filter: 3000 });
    }
  }

  /** Fin de AUTO / fin del match: "Buzzer". */
  buzzer(): void {
    const t = this.now();
    if (t === null) return;
    this.tone(110, t, 1.1, { wave: 'square', gain: 0.16, filter: 1400 });
    this.tone(165, t, 1.1, { wave: 'sawtooth', gain: 0.1, filter: 1200 });
  }

  /** Inicio de TELEOP: "3 Bells". */
  threeBells(): void {
    const t = this.now();
    if (t === null) return;
    for (let k = 0; k < 3; k++) {
      const s = t + k * 0.42;
      for (const [mul, g] of [
        [1, 0.22],
        [2.76, 0.08],
        [5.4, 0.04],
      ] as const)
        this.tone(988 * mul, s, 1.4, { gain: g, attack: 0.003, release: 1.3 });
    }
  }

  /** Inicio de cada ALLIANCE SHIFT: "Power Up – Linear Popping". */
  powerUp(): void {
    const t = this.now();
    if (t === null) return;
    this.tone(220, t, 0.9, { wave: 'triangle', to: 1100, gain: 0.16, attack: 0.05 });
    // "pops" cada vez más rápidos y agudos (burbujeo)
    let s = 0;
    for (let k = 0; k < 14; k++) {
      const f = 400 + k * 70;
      this.tone(f, t + s, 0.05, { wave: 'sine', to: f * 1.6, gain: 0.14, attack: 0.002, release: 0.04 });
      s += Math.max(0.03, 0.09 - k * 0.005);
    }
  }

  /** Inicio de END GAME: "Steam Whistle". */
  steamWhistle(): void {
    const t = this.now();
    if (t === null) return;
    for (const f of [523, 659, 784]) this.tone(f, t, 1.6, { wave: 'sine', gain: 0.09, attack: 0.12, release: 0.3, vibrato: 3 });
    this.noise(t, 1.6, { gain: 0.08, filter: 3200, q: 0.8 });
  }

  /** Match detenido: "Foghorn". */
  foghorn(): void {
    const t = this.now();
    if (t === null) return;
    this.tone(82, t, 2.2, { wave: 'sawtooth', gain: 0.22, attack: 0.15, release: 0.5, filter: 380 });
    this.tone(83.5, t, 2.2, { wave: 'sawtooth', gain: 0.18, attack: 0.15, release: 0.5, filter: 380 });
  }

  // ------------------------------------------------------------------ efectos
  shoot(): void {
    const t = this.now();
    if (t === null) return;
    this.tone(160, t, 0.09, { wave: 'triangle', to: 70, gain: 0.12 });
    this.noise(t, 0.07, { gain: 0.06, filter: 1800, decay: true });
  }

  score(): void {
    const t = this.now();
    if (t === null) return;
    this.tone(1320, t, 0.12, { gain: 0.06, attack: 0.002 });
    this.tone(1760, t + 0.05, 0.14, { gain: 0.05, attack: 0.002 });
  }

  intakeTick(): void {
    const t = this.now();
    if (t === null) return;
    this.tone(300 + Math.random() * 60, t, 0.04, { wave: 'square', gain: 0.025, filter: 900 });
  }

  /** Golpe robot-robot o contra el campo (fuerza 0–1). */
  hit(strength: number): void {
    const t = this.now();
    if (t === null || t - this.lastHit < 0.08) return;
    this.lastHit = t;
    const s = Math.min(1, strength);
    this.noise(t, 0.18, { gain: 0.08 + 0.25 * s, filter: 220 + 300 * s, type: 'lowpass', decay: true });
    this.tone(70, t, 0.12, { wave: 'sine', to: 40, gain: 0.15 * s });
  }

  /** Silbato del árbitro (falta). */
  whistle(): void {
    const t = this.now();
    if (t === null) return;
    this.tone(2900, t, 0.35, { wave: 'sine', gain: 0.07, vibrato: 60 });
    this.noise(t, 0.35, { gain: 0.03, filter: 2900, q: 6 });
  }

  beep(high = false): void {
    const t = this.now();
    if (t === null) return;
    this.tone(high ? 1200 : 800, t, 0.08, { wave: 'square', gain: 0.05, filter: 2500 });
  }

  // ------------------------------------------------------------------ música
  startMusic(): void {
    const ctx = this.ctx;
    if (!ctx || this.musicTimer !== null) return;
    this.musicStep = 0;
    this.nextNoteTime = ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 50);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const stepDur = 60 / 124 / 4; // semicorcheas a 124 BPM
    // progresión: Am – F – C – G
    const roots = [110, 87.31, 130.81, 98];
    while (this.nextNoteTime < ctx.currentTime + 0.2) {
      const s = this.musicStep;
      const bar = Math.floor(s / 16) % 4;
      const root = roots[bar];
      const t = this.nextNoteTime;
      if (s % 4 === 0) this.tone(root, t, stepDur * 3.5, { wave: 'sawtooth', gain: 0.11, filter: 420, bus: this.musicBus });
      if (s % 2 === 0) {
        const third = bar === 0 ? 3 : 4; // La menor; los demás acordes mayores
        const arp = [0, 7, 12, 7, third, 7, 12, 12 + third];
        const semi = arp[(s / 2) % arp.length];
        this.tone(root * 4 * Math.pow(2, semi / 12), t, stepDur * 1.6, { wave: 'triangle', gain: 0.035, bus: this.musicBus });
      }
      if (s % 4 === 2) this.noise(t, 0.04, { gain: 0.03, filter: 8000, type: 'highpass', bus: this.musicBus, decay: true });
      if (s % 8 === 0) this.tone(55, t, 0.15, { wave: 'sine', to: 35, gain: 0.25, bus: this.musicBus });
      this.nextNoteTime += stepDur;
      this.musicStep++;
    }
  }

  // ------------------------------------------------------------------ voz
  speak(text: string, lang: 'es' | 'en'): void {
    if (!('speechSynthesis' in window) || this.settings.audio.voice <= 0) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'es' ? 'es-MX' : 'en-US';
      u.volume = Math.min(1, this.settings.audio.voice * this.settings.audio.master);
      u.rate = 1.08;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* sin soporte */
    }
  }
}
