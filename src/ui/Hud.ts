/**
 * HUD estilo "audience display" (diseño propio, sin logos): marcador rojo vs azul, timer,
 * periodo, estado de cada HUB (activo / inactivo / aviso), cuenta al próximo SHIFT,
 * progreso ENERGIZED → SUPERCHARGED, TOWER, hopper del jugador y avisos.
 */
import { formatTimer, phaseBounds, timerSeconds, timeToNextShiftChange } from '../core/clock';
import type { Match } from '../core/match';
import { RP_THRESHOLDS } from '../core/rp';
import type { Alliance, EventType, HubLight, Phase } from '../core/types';
import { t } from './i18n';

export const PHASE_LABEL: Record<Phase, string> = {
  PRE: 'PRE-MATCH',
  AUTO: 'AUTO',
  AUTO_PAUSE: 'AUTO',
  TRANSITION: 'TRANSITION',
  SHIFT1: 'SHIFT 1',
  SHIFT2: 'SHIFT 2',
  SHIFT3: 'SHIFT 3',
  SHIFT4: 'SHIFT 4',
  END_GAME: 'END GAME',
  POST: 'TELEOP',
  DONE: 'FINAL',
};

export interface PlayerHudInfo {
  robotName: string;
  team: number;
  alliance: Alliance;
  hopper: number;
  capacity: number;
  fieldRelative: boolean;
  camera: string;
  intakeOn: boolean;
  autoAim: boolean;
  climb: string | null;
  /** Estado del OUTPOST propio (CHUTE / CORRAL). */
  outpost: string;
  disabled: boolean;
  /** Mensaje contextual (p. ej. "AUTO: tu robot ejecuta la rutina"). */
  note: string | null;
}

const ICON_CAM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 4 7.2 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.2L15 4H9Zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/></svg>';

export class Hud {
  readonly root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private lastKey = '';

  constructor(parent: HTMLElement, onPause: () => void, onCamera: () => void) {
    const r = document.createElement('div');
    r.className = 'hud';
    // Marcador estilo transmisión: cada alianza con su HUB y el progreso de FUEL hacia
    // ENERGIZED/SUPERCHARGED; al centro el timer, el periodo y cuánto falta del periodo.
    const side = (a: Alliance) => `
        <div class="sb-side ${a}" data-k="${a}Side">
          <div class="sb-info">
            <div class="sb-top"><span class="sb-name">${t(a)}</span><div class="hub" data-k="${a}Hub"><i></i><span></span></div></div>
            <div class="sb-rp" data-k="${a}Rp"><div class="meter"><i></i></div><div class="sb-rp-txt"><b></b><em></em></div></div>
          </div>
          <div class="sb-score" data-k="${a}Score">0</div>
        </div>`;
    r.innerHTML = `
      <div class="scorebug">
        ${side('red')}
        <div class="sb-center">
          <div class="timer" data-k="timer">0:20</div>
          <div class="period" data-k="period">AUTO</div>
          <div class="sb-prog"><i data-k="prog"></i></div>
        </div>
        ${side('blue')}
      </div>
      <div class="sb-under">
        <div class="shiftline" data-k="shift"></div>
        <div class="banner" data-k="banner"></div>
      </div>
      <div class="player" data-k="player">
        <div class="p-head"><span class="p-num" data-k="pnum"></span><span class="p-name" data-k="pname"></span></div>
        <div class="p-hopper">
          <div class="p-fuel"><b data-k="hcount">0</b><small data-k="hcap">/0</small><span>FUEL</span></div>
          <div class="hbar"><i data-k="hbar"></i></div>
        </div>
        <div class="chips" data-k="chips"></div>
        <div class="pnote" data-k="pnote"></div>
      </div>
      <div class="hud-tr">
        <button class="cam-btn" data-k="cam" aria-label="${t('camera')}">${ICON_CAM}<span data-k="camname"></span><kbd>C</kbd></button>
        <button class="pause-btn" data-k="pause" aria-label="${t('paused')}">${ICON_PAUSE}</button>
      </div>
      <div class="pin-layer" data-k="pins"></div>
      <div class="coach" data-k="coach"></div>
    `;
    parent.appendChild(r);
    this.root = r;
    r.querySelectorAll<HTMLElement>('[data-k]').forEach((el) => (this.els[el.dataset.k!] = el));
    this.els.pause.addEventListener('click', (e) => {
      onPause();
      (e.currentTarget as HTMLElement).blur();
    });
    this.els.cam.addEventListener('click', (e) => {
      onCamera();
      (e.currentTarget as HTMLElement).blur();
    });
  }

  /** Mensaje del drive coach (se quedan los últimos 4; se borran solos a los 12 s). */
  coach(text: string, kind: 'call' | 'tip' | 'team' | 'warn'): void {
    const box = this.els.coach;
    box.querySelectorAll('.cm').forEach((e) => e.classList.add('old'));
    const el = document.createElement('div');
    el.className = `cm cm-${kind}`;
    el.innerHTML = `<b>${kind === 'team' ? '📻' : 'COACH'}</b>`;
    el.appendChild(document.createTextNode(text));
    box.appendChild(el);
    while (box.children.length > 4) box.firstElementChild?.remove();
    setTimeout(() => el.remove(), 12000);
  }

  clearCoach(): void {
    this.els.coach.innerHTML = '';
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  setColorblind(on: boolean): void {
    this.root.classList.toggle('cb', on);
  }

  /** Modo práctica: sin reloj ni marcador, solo panel del jugador. */
  setPractice(on: boolean): void {
    this.root.classList.toggle('practice', on);
  }

  private hubLabel(light: HubLight): [string, string] {
    switch (light) {
      case 'active':
      case 'chase':
        return ['on', t('hubActive')];
      case 'pulse':
        return ['warn', t('hubWarning')];
      case 'white':
        return ['eval', '…'];
      default:
        return ['off', t('hubInactive')];
    }
  }

  update(m: Match | null, ev: EventType, player: PlayerHudInfo | null): void {
    const e = this.els;
    if (m) {
      e.redScore.textContent = String(m.score('red'));
      e.blueScore.textContent = String(m.score('blue'));
      e.period.textContent = PHASE_LABEL[m.phase];
      const sec = m.phase === 'PRE' ? 20 : timerSeconds(m.t);
      e.timer.textContent = formatTimer(sec);
      e.timer.classList.toggle('low', (m.phase === 'END_GAME' && sec <= 10) || (m.phase === 'AUTO' && sec <= 3));
      // Avance del periodo actual (barra bajo el timer)
      const [p0, p1] = m.phase === 'PRE' || m.phase === 'DONE' ? [0, 1] : phaseBounds(m.phase);
      const prog = m.phase === 'PRE' ? 0 : m.phase === 'DONE' ? 1 : Math.min(1, Math.max(0, (m.t - p0) / Math.max(0.001, p1 - p0)));
      e.prog.style.transform = `scaleX(${prog.toFixed(3)})`;
      const nx = timeToNextShiftChange(m.t);
      const shiftTxt = nx !== null && m.phase !== 'AUTO_PAUSE' ? `${t('nextShift')} ${Math.ceil(nx)} s` : '';
      if (e.shift.textContent !== shiftTxt) e.shift.textContent = shiftTxt;
      e.shift.classList.toggle('soon', nx !== null && nx <= 5);
      for (const a of ['red', 'blue'] as Alliance[]) {
        const [cls, label] = this.hubLabel(m.light(a));
        const h = e[`${a}Hub`];
        h.className = `hub ${cls}`;
        h.querySelector('span')!.textContent = `HUB ${label}`;
        e[`${a}Side`].classList.toggle('hub-off', cls === 'off');
        e[`${a}Side`].classList.toggle('mine', player?.alliance === a);
        // Progreso ENERGIZED → SUPERCHARGED (como el letrero de la DRIVER STATION)
        const th = RP_THRESHOLDS[ev];
        const fuel = m.fuelPoints(a);
        const goal = fuel >= th.energized ? th.supercharged : th.energized;
        const rp = e[`${a}Rp`];
        rp.querySelector('b')!.textContent = `FUEL ${fuel}/${goal}`;
        (rp.querySelector('.meter i') as HTMLElement).style.transform = `scaleX(${Math.min(1, fuel / goal).toFixed(3)})`;
        rp.classList.toggle('energized', fuel >= th.energized);
        rp.classList.toggle('supercharged', fuel >= th.supercharged);
        rp.querySelector('em')!.textContent = `${t('towerPts')} ${m.towerPoints(a)}`;
      }
      // Aviso de quién queda inactivo en SHIFT 1 (durante TRANSITION)
      const fi = m.firstInactive;
      e.banner.textContent =
        m.phase === 'TRANSITION' && fi ? t('inactiveFirst', { a: `HUB ${t(fi)}`.toUpperCase() }) : '';
      e.banner.className = `banner ${fi && m.phase === 'TRANSITION' ? fi : ''}`;
    }
    e.player.style.display = player ? '' : 'none';
    e.cam.style.display = player ? '' : 'none';
    if (player && e.camname.textContent !== player.camera) e.camname.textContent = player.camera;
    if (player) {
      const key = JSON.stringify(player);
      if (key !== this.lastKey) {
        this.lastKey = key;
        const full = player.hopper >= player.capacity;
        e.player.className = `player ${player.alliance}${full ? ' full' : ''}${player.disabled ? ' disabled' : ''}`;
        e.pnum.textContent = String(player.team);
        e.pname.textContent = player.robotName;
        (e.hbar as HTMLElement).style.transform = `scaleX(${Math.min(1, player.hopper / Math.max(1, player.capacity)).toFixed(3)})`;
        e.hcount.textContent = String(player.hopper);
        e.hcap.textContent = `/${player.capacity}`;
        const chip = (txt: string, on?: boolean) => `<span class="${on === undefined ? '' : on ? 'on' : 'off'}">${txt}</span>`;
        const chips = [chip(player.fieldRelative ? t('fieldRel') : t('robotRel')), chip('INTAKE', player.intakeOn), chip('AUTO-AIM', player.autoAim)];
        if (player.climb) chips.push(chip(player.climb, true));
        chips.push(`<span class="wide">${player.outpost}</span>`);
        e.chips.innerHTML = chips.join('');
        e.pnote.textContent = player.disabled ? t('disabled') : (player.note ?? '');
      }
    }
  }

  /** Contadores de PIN (G418) sobre los robots, en coordenadas de pantalla. */
  setPins(pins: Array<{ x: number; y: number; seconds: number }>): void {
    const layer = this.els.pins;
    while (layer.children.length < pins.length) {
      const d = document.createElement('div');
      d.className = 'pin';
      layer.appendChild(d);
    }
    Array.from(layer.children).forEach((el, i) => {
      const p = pins[i];
      const h = el as HTMLElement;
      if (!p) {
        h.style.display = 'none';
        return;
      }
      h.style.display = '';
      h.style.transform = `translate(${p.x}px, ${p.y}px)`;
      h.textContent = `PIN ${p.seconds.toFixed(1)}`;
      h.classList.toggle('hot', p.seconds >= 3);
    });
  }
}
