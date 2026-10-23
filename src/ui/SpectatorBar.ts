/**
 * Barra del espectador (abajo): cámaras (con el director automático) y a qué robot seguir. En
 * una repetición, además, la línea de tiempo con los periodos del match y los momentos
 * destacados, play/pausa, velocidad, saltos y el recorte de clips (archivo o video).
 *
 * Teclas (repetición): Espacio play/pausa · ←/→ ±5 s · , . cuadro a cuadro · [ ] velocidad ·
 * I / O inicio y fin del clip · 0 director · 1–6 robot.
 */
import { formatTimer, phaseAt, timerSeconds } from '../core/clock';
import type { Phase } from '../core/types';
import { SPECTATOR_CAMS, type GameSession, type SpectatorCam } from '../game/GameSession';
import { frameMatchTime, type Highlight } from '../replay/Recording';
import { REPLAY_SPEEDS, type ReplayPlayer } from '../replay/ReplayPlayer';
import { PHASE_LABEL } from './Hud';
import { t, type TKey } from './i18n';

export interface SpectatorBarOpts {
  session: GameSession;
  /** Repetición: línea de tiempo y controles de reproducción. */
  player?: ReplayPlayer;
  highlights?: Highlight[];
  /** ¿Se puede exportar video en este navegador? */
  canVideo?: boolean;
  onClipFile?(t0: number, t1: number): void;
  onClipVideo?(t0: number, t1: number): void;
  /** Descargar / compartir la repetición completa. */
  onShare?(): void;
}

const PHASE_CLS: Partial<Record<Phase, string>> = {
  AUTO: 'auto',
  AUTO_PAUSE: 'pause',
  TRANSITION: 'trans',
  SHIFT1: 'shift',
  SHIFT2: 'shift b',
  SHIFT3: 'shift',
  SHIFT4: 'shift b',
  END_GAME: 'end',
  POST: 'pause',
};

const I = {
  play: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M11 6v12l-8.5-6L11 6Zm9.5 0v12L12 12l8.5-6Z"/></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M13 6v12l8.5-6L13 6ZM3.5 6v12L12 12 3.5 6Z"/></svg>',
  clip: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M6 4v16M18 4v16M6 8h12M6 16h12"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 4 7.2 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.2L15 4H9Zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3 7 8h3.5v7h3V8H17l-5-5ZM5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6h-2v6H7v-6H5Z"/></svg>',
};

const clock = (s: number) => {
  const v = Math.max(0, Math.floor(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

export class SpectatorBar {
  readonly root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private clip: [number, number] | null = null;
  private drag: 'head' | 'in' | 'out' | null = null;
  private key = '';
  private onKey = (e: KeyboardEvent) => {
    this.wake();
    this.keydown(e);
  };
  /** Segundos sin tocar nada: con la repetición corriendo, la barra se esconde (vuelve al mover). */
  private idle = 0;
  private wake = () => {
    this.idle = 0;
    this.root.classList.remove('idle');
  };

  constructor(
    parent: HTMLElement,
    private o: SpectatorBarOpts,
  ) {
    const p = o.player;
    const r = document.createElement('div');
    r.className = `spec-bar${p ? ' replay' : ''}`;
    r.innerHTML = `
      ${
        p
          ? `<div class="sp-tl" data-k="tl">
              <div class="sp-phases">${this.phaseSegments()}</div>
              <div class="sp-range" data-k="range" hidden><i data-h="in"></i><i data-h="out"></i></div>
              ${(o.highlights ?? []).map((h) => `<button class="sp-mark ${h.kind} ${h.alliance ?? ''}" style="left:${this.pct(h.t)}%" data-seek="${h.t}" title="${t(`hl_${h.kind}` as TKey)}"></button>`).join('')}
              <div class="sp-head" data-k="head"></div>
            </div>`
          : ''
      }
      <div class="sp-row">
        ${
          p
            ? `<div class="sp-transport">
                <button class="sp-btn" data-a="back" aria-label="−5 s">${I.back}</button>
                <button class="sp-btn sp-play" data-a="play" data-k="play" aria-label="${t('rp_play')}"></button>
                <button class="sp-btn" data-a="fwd" aria-label="+5 s">${I.fwd}</button>
                <span class="sp-time" data-k="time"></span>
                <button class="sp-chip" data-a="speed" data-k="speed"></button>
              </div>`
            : `<div class="sp-live"><i></i>${t('sp_live')}</div>`
        }
        <div class="sp-group"><button class="sp-chip sp-camsel" data-a="cams" data-k="camsel" aria-haspopup="true">${I.cam}<span data-k="camname"></span><b>▾</b></button></div>
        <div class="sp-group sp-robots" data-k="robots">
          <button class="sp-chip" data-focus="-1">${t('sp_auto')}</button>
          ${o.session.robots.map((rb, i) => `<button class="sp-chip team ${rb.alliance}" data-focus="${i}">${rb.spec.teamNumber}</button>`).join('')}
        </div>
        ${
          p
            ? `<div class="sp-actions">
                <button class="sp-chip" data-a="clip" data-k="clipbtn">${I.clip}<span>${t('rp_clip')}</span></button>
                ${o.onShare ? `<button class="sp-chip" data-a="share">${I.share}<span>${t('rp_share')}</span></button>` : ''}
              </div>`
            : ''
        }
      </div>
      ${
        p
          ? `<div class="sp-clipbar" data-k="clipbar" hidden>
              <span data-k="cliplen"></span>
              <button class="sp-chip" data-a="in">${t('rp_setIn')} <kbd>I</kbd></button>
              <button class="sp-chip" data-a="out">${t('rp_setOut')} <kbd>O</kbd></button>
              <div class="grow"></div>
              <button class="sp-chip primary" data-a="clipFile">${t('rp_clipFile')}</button>
              ${o.canVideo ? `<button class="sp-chip primary" data-a="clipVideo">${t('rp_clipVideo')}</button>` : ''}
              <button class="sp-chip" data-a="clipCancel">${t('cancel')}</button>
            </div>`
          : ''
      }
      <div class="sp-menu" data-k="cams" hidden>${SPECTATOR_CAMS.map((c) => `<button class="sp-chip" data-cam="${c}">${t(`cam_${c}` as TKey)}</button>`).join('')}</div>`;
    parent.appendChild(r);
    this.root = r;
    r.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.els[e.dataset.k!] = e));
    r.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', () => this.action(b.dataset.a!)));
    r.querySelectorAll<HTMLElement>('[data-cam]').forEach((b) =>
      b.addEventListener('click', () => {
        o.session.setSpectatorCam(b.dataset.cam as SpectatorCam);
        this.els.cams.hidden = true;
      }),
    );
    r.querySelectorAll<HTMLElement>('[data-focus]').forEach((b) => b.addEventListener('click', () => o.session.setFocus(Number(b.dataset.focus))));
    r.querySelectorAll<HTMLElement>('[data-seek]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        p?.seek(Number(b.dataset.seek));
      }),
    );
    // (los botones no se quedan con el foco: Espacio y las flechas son de la repetición)
    r.addEventListener('pointerup', () => (document.activeElement as HTMLElement | null)?.blur?.());
    const tl = this.els.tl;
    if (tl && p) {
      tl.addEventListener('pointerdown', (e) => {
        const h = (e.target as HTMLElement).dataset.h as 'in' | 'out' | undefined;
        if ((e.target as HTMLElement).dataset.seek) return;
        this.drag = h ?? 'head';
        tl.setPointerCapture(e.pointerId);
        this.dragTo(e);
      });
      tl.addEventListener('pointermove', (e) => this.drag && this.dragTo(e));
      tl.addEventListener('pointerup', () => (this.drag = null));
      tl.addEventListener('pointercancel', () => (this.drag = null));
    }
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('pointermove', this.wake);
    window.addEventListener('pointerdown', this.wake);
  }

  /** Tiempo (s del host) → % de la línea de tiempo. */
  private pct(time: number): number {
    const p = this.o.player!;
    return (100 * (time - p.start)) / Math.max(1e-3, p.end - p.start);
  }

  private timeAt(e: PointerEvent): number {
    const p = this.o.player!;
    const r = this.els.tl.getBoundingClientRect();
    const k = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    return p.start + k * (p.end - p.start);
  }

  private dragTo(e: PointerEvent): void {
    const p = this.o.player!;
    const x = this.timeAt(e);
    if (this.drag === 'head') p.seek(x);
    else if (this.clip && this.drag === 'in') this.clip = [Math.min(x, this.clip[1] - 0.5), this.clip[1]];
    else if (this.clip && this.drag === 'out') this.clip = [this.clip[0], Math.max(x, this.clip[0] + 0.5)];
  }

  /** Periodos del match a lo largo de la grabación. */
  private phaseSegments(): string {
    const p = this.o.player!;
    const d = p.data;
    const rd = p.reader;
    const N = 240;
    const segs: Array<[Phase, number, number]> = [];
    for (let k = 0; k <= N; k++) {
      const tt = p.start + ((p.end - p.start) * k) / N;
      const ph = phaseAt(frameMatchTime(d.frames[rd.indexAt(tt)]));
      const last = segs[segs.length - 1];
      if (last && last[0] === ph) last[2] = k;
      else segs.push([ph, k, k]);
    }
    return segs
      .map(([ph, a, b], i) => {
        const w = ((b - a + (i < segs.length - 1 ? 1 : 0)) * 100) / N;
        return `<i class="${PHASE_CLS[ph] ?? 'pause'}" style="width:${w}%" title="${PHASE_LABEL[ph]}">${w > 7 ? `<span>${PHASE_LABEL[ph]}</span>` : ''}</i>`;
      })
      .join('');
  }

  private action(a: string): void {
    if (a === 'cams') {
      // menú de cámaras arriba del botón (la fila puede desplazarse de lado)
      const m = this.els.cams;
      m.hidden = !m.hidden;
      if (!m.hidden) {
        const b = this.els.camsel.getBoundingClientRect();
        const r = this.root.getBoundingClientRect();
        m.style.left = `${Math.max(0, Math.min(b.left - r.left, r.width - m.offsetWidth))}px`;
      }
      return;
    }
    const p = this.o.player;
    if (!p) return;
    if (a === 'play') p.togglePlay();
    else if (a === 'back') p.seek(p.t - 5);
    else if (a === 'fwd') p.seek(p.t + 5);
    else if (a === 'speed') p.speed = REPLAY_SPEEDS[(REPLAY_SPEEDS.indexOf(p.speed) + 1) % REPLAY_SPEEDS.length];
    else if (a === 'clip') this.clip = this.clip ? null : [Math.max(p.start, p.t - 10), Math.min(p.end, p.t + 5)];
    else if (a === 'in' && this.clip) this.clip = [Math.min(p.t, this.clip[1] - 0.5), this.clip[1]];
    else if (a === 'out' && this.clip) this.clip = [this.clip[0], Math.max(p.t, this.clip[0] + 0.5)];
    else if (a === 'clipCancel') this.clip = null;
    else if (a === 'clipFile' && this.clip) this.o.onClipFile?.(...this.clip);
    else if (a === 'clipVideo' && this.clip) this.o.onClipVideo?.(...this.clip);
    else if (a === 'share') this.o.onShare?.();
  }

  private keydown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || this.o.session.paused || this.root.classList.contains('hidden')) return;
    const p = this.o.player;
    const s = this.o.session;
    if (/^Digit[0-6]$/.test(e.code)) {
      const n = Number(e.code.slice(5));
      s.setFocus(n === 0 ? -1 : n - 1);
      return;
    }
    if (!p) return;
    const map: Record<string, () => void> = {
      Space: () => p.togglePlay(),
      ArrowLeft: () => p.seek(p.t - (e.shiftKey ? 1 : 5)),
      ArrowRight: () => p.seek(p.t + (e.shiftKey ? 1 : 5)),
      Comma: () => p.stepFrame(-1),
      Period: () => p.stepFrame(1),
      BracketLeft: () => (p.speed = REPLAY_SPEEDS[Math.max(0, REPLAY_SPEEDS.indexOf(p.speed) - 1)]),
      BracketRight: () => (p.speed = REPLAY_SPEEDS[Math.min(REPLAY_SPEEDS.length - 1, REPLAY_SPEEDS.indexOf(p.speed) + 1)]),
      KeyI: () => (this.clip ? this.action('in') : (this.clip = [p.t, Math.min(p.end, p.t + 10)])),
      KeyO: () => (this.clip ? this.action('out') : (this.clip = [Math.max(p.start, p.t - 10), p.t])),
    };
    const fn = map[e.code];
    if (fn) {
      e.preventDefault();
      fn();
    }
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  /** Cada frame: estado de los botones, cabezal y rango del clip. */
  update(dt = 0): void {
    const busy = !this.o.player?.playing || !!this.clip || !this.els.cams.hidden || !!this.drag;
    this.idle = busy ? 0 : this.idle + dt;
    if (this.idle > 3.5 && !this.root.classList.contains('idle')) this.root.classList.add('idle');
    const s = this.o.session;
    const p = this.o.player;
    const e = this.els;
    const key = `${s.spectatorCam}|${s.spectatorCam === 'director' ? -1 : s.focus}|${p ? `${p.playing}|${p.speed}|${!!this.clip}` : ''}`;
    if (key !== this.key) {
      this.key = key;
      e.cams.querySelectorAll<HTMLElement>('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === s.spectatorCam));
      e.camname.textContent = t(`cam_${s.spectatorCam}` as TKey);
      const f = s.spectatorCam === 'director' ? -1 : s.focus;
      e.robots.querySelectorAll<HTMLElement>('[data-focus]').forEach((b) => b.classList.toggle('on', Number(b.dataset.focus) === f));
      if (p) {
        e.play.innerHTML = p.playing ? I.pause : I.play;
        e.speed.textContent = `${p.speed}×`;
        e.clipbar.hidden = !this.clip;
        e.range.hidden = !this.clip;
        e.clipbtn.classList.toggle('on', !!this.clip);
      }
    }
    // el robot que está siguiendo el director
    const vf = s.viewFocus;
    e.robots.querySelectorAll<HTMLElement>('[data-focus]').forEach((b) => b.classList.toggle('live', s.spectatorCam === 'director' && Number(b.dataset.focus) === vf));
    if (!p) return;
    e.head.style.left = `${this.pct(p.t)}%`;
    const m = s.match;
    e.time.textContent = `${m ? formatTimer(m.phase === 'PRE' ? 20 : timerSeconds(m.t)) : ''} · ${clock(p.t - p.start)} / ${clock(p.end - p.start)}`;
    if (this.clip) {
      const [a, b] = this.clip;
      e.range.style.left = `${this.pct(a)}%`;
      e.range.style.width = `${this.pct(b) - this.pct(a)}%`;
      e.cliplen.textContent = `${t('rp_clip')} ${clock(a - p.start)} – ${clock(b - p.start)} · ${(b - a).toFixed(1)} s`;
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointermove', this.wake);
    window.removeEventListener('pointerdown', this.wake);
    this.root.remove();
  }
}
