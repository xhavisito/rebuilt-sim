/**
 * Audio con Web Audio. Los cues del FMS (Tabla 5-4): "Cavalry Charge", "Buzzer", "3 Bells",
 * "Power Up – Linear Popping", "Steam Whistle" se tocan con las grabaciones reales del
 * campo (`public/sounds/*.wav`, ver `public/sounds/LICENSES.md`); si un archivo no carga, se usa la
 * versión sintetizada (también "Foghorn", que no tiene grabación).
 * Más efectos y voces (SpeechSynthesis). Volumen separado para efectos y voces; sin música.
 */
import type { Settings } from '../config/settings';

type Wave = OscillatorType;

/** Grabaciones del campo: cue → archivo en `public/sounds/`. */
const FIELD_SOUNDS = {
  start: 'start.wav', // Cavalry Charge
  end: 'end.wav', // Buzzer
  resume: 'resume.wav', // 3 Bells
  shift: 'shift_change.wav', // Power Up – Linear Popping
  warning: 'warning.wav', // Steam Whistle
} as const;
type FieldSound = keyof typeof FIELD_SOUNDS;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private out!: DynamicsCompressorNode;
  private sfxBus!: GainNode;
  private noiseBuf: AudioBuffer | null = null;
  private lastHit = 0;
  private sampleData = new Map<FieldSound, Promise<ArrayBuffer | null>>();
  private samples = new Map<FieldSound, AudioBuffer>();

  constructor(private settings: Settings) {
    // se descargan desde el inicio; se decodifican al crear el AudioContext (requiere un gesto)
    for (const [k, file] of Object.entries(FIELD_SOUNDS) as Array<[FieldSound, string]>)
      this.sampleData.set(
        k,
        fetch(`${import.meta.env.BASE_URL}sounds/${file}`)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null),
      );
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
    this.out = comp;
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    for (const [k, data] of this.sampleData)
      void data.then(async (buf) => {
        if (!buf) return;
        try {
          this.samples.set(k, await ctx.decodeAudioData(buf));
        } catch {
          /* formato no soportado: queda la versión sintetizada */
        }
      });
    return ctx;
  }

  /** Toca la grabación del campo si ya está lista; false si hay que sintetizar. */
  private playSample(k: FieldSound, t: number): boolean {
    const buf = this.samples.get(k);
    if (!buf) return false;
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.connect(this.sfxBus);
    src.start(t);
    return true;
  }

  /** Copia de la mezcla final (para el audio de un video); `stop` la desconecta. */
  tap(): { stream: MediaStream; stop: () => void } | null {
    const ctx = this.ensure();
    if (!ctx || typeof ctx.createMediaStreamDestination !== 'function') return null;
    const dest = ctx.createMediaStreamDestination();
    this.out.connect(dest);
    return { stream: dest.stream, stop: () => this.out.disconnect(dest) };
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
    if (this.playSample('start', t)) return;
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
    if (this.playSample('end', t)) return;
    this.tone(110, t, 1.1, { wave: 'square', gain: 0.16, filter: 1400 });
    this.tone(165, t, 1.1, { wave: 'sawtooth', gain: 0.1, filter: 1200 });
  }

  /** Inicio de TELEOP: "3 Bells". */
  threeBells(): void {
    const t = this.now();
    if (t === null) return;
    if (this.playSample('resume', t)) return;
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
    if (this.playSample('shift', t)) return;
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
    if (this.playSample('warning', t)) return;
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
