/**
 * HUD estilo "audience display" (diseño propio, sin logos): marcador rojo vs azul, timer,
 * periodo, estado de cada HUB (activo / inactivo / aviso), cuenta al próximo SHIFT,
 * progreso ENERGIZED → SUPERCHARGED, TOWER, hopper del jugador y avisos.
 */
import { formatTimer, timerSeconds, timeToNextShiftChange } from '../core/clock';
import type { Match } from '../core/match';
import { RP_THRESHOLDS } from '../core/rp';
import type { Alliance, EventType, HubLight, Phase } from '../core/types';
import { t } from './i18n';

const PHASE_LABEL: Record<Phase, string> = {
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

export class Hud {
  readonly root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private lastKey = '';

  constructor(parent: HTMLElement, onPause: () => void) {
    const r = document.createElement('div');
    r.className = 'hud';
    r.innerHTML = `
      <div class="scorebar">
        <div class="side red">
          <div class="hub" data-k="redHub"><i></i><span></span></div>
          <div class="score" data-k="redScore">0</div>
        </div>
        <div class="center">
          <div class="period" data-k="period">AUTO</div>
          <div class="timer" data-k="timer">0:20</div>
          <div class="next" data-k="next"></div>
        </div>
        <div class="side blue">
          <div class="score" data-k="blueScore">0</div>
          <div class="hub" data-k="blueHub"><i></i><span></span></div>
        </div>
      </div>
      <div class="subbar">
        <div class="rp red" data-k="redRp"><b></b><div class="meter"><i></i></div><em></em></div>
        <div class="banner" data-k="banner"></div>
        <div class="rp blue" data-k="blueRp"><b></b><div class="meter"><i></i></div><em></em></div>
      </div>
      <div class="player" data-k="player">
        <div class="pname" data-k="pname"></div>
        <div class="hopper"><div class="hbar"><i data-k="hbar"></i></div><span data-k="htext"></span></div>
        <div class="chips" data-k="chips"></div>
        <div class="pnote" data-k="pnote"></div>
      </div>
      <button class="pause-btn" data-k="pause" aria-label="pause">❚❚</button>
      <div class="pin-layer" data-k="pins"></div>
    `;
    parent.appendChild(r);
    this.root = r;
    r.querySelectorAll<HTMLElement>('[data-k]').forEach((el) => (this.els[el.dataset.k!] = el));
    this.els.pause.addEventListener('click', onPause);
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
      const nx = timeToNextShiftChange(m.t);
      e.next.textContent = nx !== null && m.phase !== 'AUTO_PAUSE' ? `${t('nextShift')} ${Math.ceil(nx)} s` : '';
      for (const a of ['red', 'blue'] as Alliance[]) {
        const [cls, label] = this.hubLabel(m.light(a));
        const h = e[`${a}Hub`];
        h.className = `hub ${cls}`;
        h.querySelector('span')!.textContent = `HUB ${label}`;
        // Progreso ENERGIZED → SUPERCHARGED (como el letrero de la DRIVER STATION)
        const th = RP_THRESHOLDS[ev];
        const fuel = m.fuelPoints(a);
        const goal = fuel >= th.energized ? th.supercharged : th.energized;
        const rp = e[`${a}Rp`];
        rp.querySelector('b')!.textContent = `FUEL ${fuel}/${goal}`;
        (rp.querySelector('.meter i') as HTMLElement).style.width = `${Math.min(100, (fuel / goal) * 100)}%`;
        rp.classList.toggle('energized', fuel >= th.energized);
        rp.classList.toggle('supercharged', fuel >= th.supercharged);
        rp.querySelector('em')!.textContent = `${t('towerPts')} ${m.towerPoints(a)}`;
      }
      // Aviso de quién queda inactivo en SHIFT 1 (durante TRANSITION)
      const fi = m.firstInactive;
      e.banner.textContent =
        m.phase === 'TRANSITION' && fi ? t('inactiveFirst', { a: `${fi === 'red' ? '🔴' : '🔵'} HUB ${t(fi)}`.toUpperCase() }) : '';
      e.banner.className = `banner ${fi && m.phase === 'TRANSITION' ? fi : ''}`;
    }
    e.player.style.display = player ? '' : 'none';
    if (player) {
      const key = JSON.stringify(player);
      if (key !== this.lastKey) {
        this.lastKey = key;
        e.player.className = `player ${player.alliance}`;
        e.pname.textContent = `${player.team} · ${player.robotName}`;
        (e.hbar as HTMLElement).style.width = `${Math.min(100, (player.hopper / Math.max(1, player.capacity)) * 100)}%`;
        e.htext.textContent = `${t('hopper')} ${player.hopper}/${player.capacity}`;
        const chips = [
          player.fieldRelative ? t('fieldRel') : t('robotRel'),
          `${t('camera')}: ${player.camera}`,
          player.intakeOn ? 'INTAKE ●' : 'INTAKE ○',
        ];
        if (player.autoAim) chips.push('AIM ◎');
        if (player.climb) chips.push(player.climb);
        chips.push(player.outpost);
        e.chips.innerHTML = chips.map((c) => `<span>${c}</span>`).join('');
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
