/**
 * Diseñador de AUTO: vista superior de la mitad azul del campo (la rutina se refleja sola
 * para la alianza roja). Toca para agregar waypoints, arrástralos para moverlos y elige
 * las acciones de cada uno (intake, disparar, esperar, trepar L1).
 */
import { BUILTIN_ROUTINES, crossesCenter, loadRoutines, saveCustomRoutines, type AutoRoutine, type AutoWaypoint } from '../auto/AutoRoutine';
import * as F from '../config/field';
import { defaultStart } from '../core/startRules';
import type { StationNumber } from '../core/types';
import { bind, esc, seg, select, type Opt } from './forms';
import { t } from './i18n';

const X0 = -F.HALF_L - 0.25;
const X1 = 1.2;
const Z0 = -F.HALF_W - 0.15;
const Z1 = F.HALF_W + 0.15;
const ROBOT_HALF = 0.43;

export class AutoDesigner {
  private routines: AutoRoutine[] = [];
  private cur!: AutoRoutine;
  private sel = -1;
  private station: StationNumber = 2;
  private canvas!: HTMLCanvasElement;
  private drag = -1;

  constructor(
    private root: HTMLElement,
    private onBack: () => void,
    private onTest: (routineId: string, station: StationNumber) => void,
  ) {}

  open(routineId?: string): void {
    this.routines = loadRoutines();
    this.cur = structuredClone(this.routines.find((r) => r.id === routineId && !r.builtin) ?? this.newRoutine());
    this.render();
  }

  private newRoutine(): AutoRoutine {
    const base = BUILTIN_ROUTINES.find((r) => r.id === 'default-score')!;
    return { id: `custom-${Date.now().toString(36)}`, name: `${t('myRoutine')} ${this.routines.filter((r) => !r.builtin).length + 1}`, shootPreload: true, waypoints: structuredClone(base.waypoints) };
  }

  private render(): void {
    const opts: Opt[] = this.routines.map((r) => ({ value: r.id, label: `${r.builtin ? '🔒 ' : ''}${r.name}` }));
    if (!this.routines.some((r) => r.id === this.cur.id)) opts.push({ value: this.cur.id, label: `✎ ${this.cur.name}` });
    this.root.innerHTML = `<div class="inner">
      <div class="brandbar"><div class="brand">REBUILT <span>SIM</span></div><div class="ctx">2026 REBUILT</div><div class="grow"></div><button class="chipbtn" data-back>← ${t('back')}</button></div>
      <h1>${t('autoDesigner')}</h1>
      <div class="split">
        <div class="designer panel"><canvas></canvas><div class="msg" data-info style="margin-top:6px"></div></div>
        <div class="panel form" data-side></div>
      </div>
    </div>`;
    this.root.querySelector('[data-back]')!.addEventListener('click', () => this.onBack());
    this.canvas = this.root.querySelector('canvas')!;
    this.attachCanvas();
    this.renderSide(opts);
    this.draw();
  }

  private renderSide(opts: Opt[]): void {
    const side = this.root.querySelector<HTMLElement>('[data-side]')!;
    const w = this.cur.waypoints[this.sel];
    const ro = !!this.cur.builtin;
    const headOpts: Opt[] = [
      { value: 'auto', label: t('headingAuto') },
      { value: '0', label: '→ 0°' },
      { value: '90', label: '↑ 90°' },
      { value: '180', label: '← 180°' },
      { value: '270', label: '↓ 270°' },
    ];
    const hv = w ? (w.heading === null ? 'auto' : String(Math.round(((w.heading * 180) / Math.PI + 360) % 360))) : 'auto';
    side.innerHTML = `
      <label>${t('autoRoutine')}</label>${select('routine', opts, this.cur.id)}
      <label>${t('routineName')}</label><input type="text" data-name value="${esc(this.cur.name)}" ${ro ? 'disabled' : ''}/>
      <label>${t('station')}</label>${seg('station', ['1', '2', '3'].map((v) => ({ value: v, label: v })), String(this.station))}
      <label>${t('shootPreload')}</label>${seg('preload', [{ value: '1', label: t('on') }, { value: '0', label: t('off') }], this.cur.shootPreload ? '1' : '0')}
      <h3>${w ? `${t('waypoint')} ${this.sel + 1}` : t('tapToAdd')}</h3>
      ${
        w
          ? `<label>${t('heading')}</label>${seg('heading', headOpts, hv)}
        <label>INTAKE</label>${seg('intake', [{ value: 'keep', label: '—' }, { value: 'on', label: t('on') }, { value: 'off', label: t('off') }], w.intake === undefined ? 'keep' : w.intake ? 'on' : 'off')}
        <label>${t('a_shoot')}</label>${seg('shoot', [{ value: '1', label: t('on') }, { value: '0', label: t('off') }], w.shoot ? '1' : '0')}
        <label>${t('wait')}</label>${seg('wait', ['0', '0.5', '1', '2', '3'].map((v) => ({ value: v, label: `${v} s` })), String(w.wait ?? 0))}
        <label>${t('climbL1')}</label>${seg('climb', [{ value: '1', label: t('on') }, { value: '0', label: t('off') }], w.climb ? '1' : '0')}
        <label></label><div class="row"><button class="chipbtn" data-del>${t('delete')}</button><button class="chipbtn" data-desel>✓</button></div>`
          : ''
      }
      <label></label><div class="row">
        <button class="chipbtn" data-new>${t('newRoutine')}</button>
        <button class="chipbtn" data-dup>${t('duplicate')}</button>
        ${ro ? '' : `<button class="chipbtn" data-save>${t('save')}</button><button class="chipbtn" data-delr>${t('delete')}</button>`}
        <button class="chipbtn on" data-test>▶ ${t('test')}</button>
      </div>`;
    if (ro) side.querySelectorAll<HTMLButtonElement>('[data-seg] button').forEach((b) => (b.disabled = !b.closest('[data-seg="station"]')));
    bind(side, (name, v) => {
      if (name === 'routine') {
        const r = this.routines.find((x) => x.id === v);
        if (r) this.cur = structuredClone(r);
        this.sel = -1;
        this.render();
        return;
      }
      if (name === 'station') this.station = Number(v) as StationNumber;
      if (name === 'preload') this.cur.shootPreload = v === '1';
      const wp = this.cur.waypoints[this.sel];
      if (wp) {
        if (name === 'heading') wp.heading = v === 'auto' ? null : (Number(v) * Math.PI) / 180;
        if (name === 'intake') wp.intake = v === 'keep' ? undefined : v === 'on';
        if (name === 'shoot') wp.shoot = v === '1';
        if (name === 'wait') wp.wait = Number(v) || undefined;
        if (name === 'climb') wp.climb = v === '1';
      }
      this.draw();
    });
    side.querySelector<HTMLInputElement>('[data-name]')?.addEventListener('input', (e) => (this.cur.name = (e.target as HTMLInputElement).value));
    side.querySelector('[data-del]')?.addEventListener('click', () => {
      this.cur.waypoints.splice(this.sel, 1);
      this.sel = -1;
      this.renderSide(opts);
      this.draw();
    });
    side.querySelector('[data-desel]')?.addEventListener('click', () => {
      this.sel = -1;
      this.renderSide(opts);
      this.draw();
    });
    side.querySelector('[data-new]')!.addEventListener('click', () => {
      this.cur = this.newRoutine();
      this.cur.waypoints = [];
      this.sel = -1;
      this.render();
    });
    side.querySelector('[data-dup]')!.addEventListener('click', () => {
      this.cur = { ...structuredClone(this.cur), id: `custom-${Date.now().toString(36)}`, name: `${this.cur.name} (2)`, builtin: false };
      this.render();
    });
    side.querySelector('[data-save]')?.addEventListener('click', () => this.save());
    side.querySelector('[data-delr]')?.addEventListener('click', () => {
      this.routines = this.routines.filter((r) => r.id !== this.cur.id);
      saveCustomRoutines(this.routines);
      this.cur = structuredClone(BUILTIN_ROUTINES[2]);
      this.render();
    });
    side.querySelector('[data-test]')!.addEventListener('click', () => {
      if (!this.cur.builtin) this.save();
      this.onTest(this.cur.id, this.station);
    });
  }

  private save(): void {
    const i = this.routines.findIndex((r) => r.id === this.cur.id);
    if (i >= 0) this.routines[i] = structuredClone(this.cur);
    else this.routines.push(structuredClone(this.cur));
    saveCustomRoutines(this.routines);
    this.render();
  }

  // ------------------------------------------------------------------ lienzo
  private get scale(): number {
    return this.canvas.width / (X1 - X0);
  }
  private toPx(x: number, z: number): [number, number] {
    return [(x - X0) * this.scale, (z - Z0) * this.scale];
  }
  private toField(px: number, py: number): { x: number; z: number } {
    return { x: px / this.scale + X0, z: py / this.scale + Z0 };
  }

  private attachCanvas(): void {
    const c = this.canvas;
    const resize = () => {
      const w = Math.max(300, c.clientWidth || 600);
      c.width = Math.round(w * (window.devicePixelRatio || 1));
      c.height = Math.round(c.width * ((Z1 - Z0) / (X1 - X0)));
      this.draw();
    };
    requestAnimationFrame(resize);
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return this.toField(((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height);
    };
    c.addEventListener('pointerdown', (e) => {
      if (this.cur.builtin) return;
      const p = pos(e);
      const hit = this.cur.waypoints.findIndex((w) => Math.hypot(w.x - p.x, w.z - p.z) < 0.35);
      if (hit >= 0) {
        this.sel = hit;
        this.drag = hit;
      } else {
        const wp: AutoWaypoint = { x: clampX(p.x), z: clampZ(p.z), heading: null };
        const at = this.sel >= 0 ? this.sel + 1 : this.cur.waypoints.length;
        this.cur.waypoints.splice(at, 0, wp);
        this.sel = at;
        this.drag = at;
      }
      c.setPointerCapture(e.pointerId);
      this.renderSide(this.routines.map((r) => ({ value: r.id, label: r.name })));
      this.draw();
    });
    c.addEventListener('pointermove', (e) => {
      if (this.drag < 0) return;
      const p = pos(e);
      const w = this.cur.waypoints[this.drag];
      w.x = clampX(p.x);
      w.z = clampZ(p.z);
      this.draw();
    });
    const up = () => (this.drag = -1);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  draw(): void {
    const c = this.canvas;
    if (!c || !c.width) return;
    const g = c.getContext('2d')!;
    const S = this.scale;
    g.fillStyle = '#4b4f56';
    g.fillRect(0, 0, c.width, c.height);
    const rect = (x0: number, z0: number, x1: number, z1: number, fill: string) => {
      const [a, b] = this.toPx(Math.min(x0, x1), Math.min(z0, z1));
      g.fillStyle = fill;
      g.fillRect(a, b, Math.abs(x1 - x0) * S, Math.abs(z1 - z0) * S);
    };
    // Campo y zonas
    rect(-F.HALF_L, -F.HALF_W, X1, F.HALF_W, '#5d6168');
    rect(-F.HALF_L, -F.HALF_W, F.STARTING_LINE_X_BLUE, F.HALF_W, '#566070');
    rect(F.STARTING_LINE_X_BLUE - F.TAPE_WIDTH, -F.HALF_W, F.STARTING_LINE_X_BLUE, F.HALF_W, '#1e88e5');
    rect(-0.03, -F.HALF_W, 0.03, F.HALF_W, '#f0f0f0');
    // HUB, BUMPS, TRENCHES
    const hx = F.HUB_CENTER_X_BLUE;
    rect(hx - F.HUB_SIZE / 2, -F.HUB_SIZE / 2, hx + F.HUB_SIZE / 2, F.HUB_SIZE / 2, '#d9dde2');
    for (const s of [-1, 1]) {
      rect(hx - F.BUMP_DEPTH / 2, s * F.HUB_SIZE / 2, hx + F.BUMP_DEPTH / 2, s * (F.HUB_SIZE / 2 + F.BUMP_WIDTH), '#2c6cc4');
      rect(hx - F.TRENCH_DEPTH / 2, s * F.TRENCH_INNER_Z, hx + F.TRENCH_DEPTH / 2, s * (F.HALF_W - F.TRENCH_CLEAR_WIDTH), '#1b4f9c');
      rect(hx - 0.08, s * (F.HALF_W - F.TRENCH_CLEAR_WIDTH), hx + 0.08, s * F.HALF_W, '#9aa6b8');
    }
    // TOWER, DEPOT, OUTPOST
    const tw = F.towerInfo('blue');
    rect(-F.HALF_L, tw.cz - F.TOWER_BASE_WIDTH / 2, -F.HALF_L + F.TOWER_BASE_DEPTH, tw.cz + F.TOWER_BASE_WIDTH / 2, '#3e4249');
    rect(tw.uprightX - 0.05, tw.cz - F.UPRIGHT_GAP / 2 - 0.2, tw.uprightX + 0.05, tw.cz + F.UPRIGHT_GAP / 2 + 0.2, '#1e88e5');
    const dp = F.depotCenter('blue');
    rect(-F.HALF_L, dp.z - F.DEPOT_WIDTH / 2, -F.HALF_L + F.DEPOT_DEPTH, dp.z + F.DEPOT_WIDTH / 2, '#c9a400');
    const op = F.outpostInfo('blue');
    rect(-F.HALF_L - 0.2, op.z - 0.42, -F.HALF_L, op.z + 0.42, '#1e88e5');
    // Etiquetas
    g.fillStyle = '#fff';
    g.font = `bold ${Math.round(S * 0.22)}px sans-serif`;
    const label = (txt: string, x: number, z: number) => {
      const [a, b] = this.toPx(x, z);
      g.fillText(txt, a, b);
    };
    label('HUB', hx - 0.3, 0.05);
    label('TOWER', -F.HALF_L + 0.05, tw.cz + 0.75);
    label('DEPOT', -F.HALF_L + 0.05, dp.z - 0.6);
    label('OUTPOST', -F.HALF_L + 0.05, op.z + 0.15);
    label('CENTER LINE', 0.08, -F.HALF_W + 0.3);
    // Posición inicial (DS seleccionada)
    const st = defaultStart('blue', this.station, ROBOT_HALF);
    const [sx, sy] = this.toPx(st.x, st.z);
    g.fillStyle = 'rgba(30,136,229,.85)';
    g.fillRect(sx - ROBOT_HALF * S, sy - ROBOT_HALF * S, 2 * ROBOT_HALF * S, 2 * ROBOT_HALF * S);
    // Ruta
    g.strokeStyle = '#f2c400';
    g.lineWidth = Math.max(2, S * 0.04);
    g.beginPath();
    g.moveTo(sx, sy);
    for (const w of this.cur.waypoints) g.lineTo(...this.toPx(w.x, w.z));
    g.stroke();
    let warn = false;
    this.cur.waypoints.forEach((w, i) => {
      const [a, b] = this.toPx(w.x, w.z);
      const bad = crossesCenter(w, ROBOT_HALF);
      warn ||= bad;
      g.fillStyle = bad ? '#e53935' : i === this.sel ? '#ffffff' : '#f2c400';
      g.beginPath();
      g.arc(a, b, S * 0.17, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.font = `bold ${Math.round(S * 0.2)}px sans-serif`;
      g.fillText(String(i + 1), a - S * 0.06, b + S * 0.07);
      const tags = [w.intake === true ? 'I+' : w.intake === false ? 'I−' : '', w.shoot ? '⦿' : '', w.wait ? `${w.wait}s` : '', w.climb ? 'L1' : ''].filter(Boolean).join(' ');
      if (tags) {
        g.fillStyle = '#fff';
        g.fillText(tags, a + S * 0.2, b - S * 0.15);
      }
      if (w.heading !== null) {
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(a, b);
        g.lineTo(a + Math.cos(w.heading) * S * 0.4, b - Math.sin(w.heading) * S * 0.4);
        g.stroke();
      }
    });
    // Tiempo estimado (velocidad media ~3 m/s + acciones)
    let dist = 0;
    let prev = { x: st.x, z: st.z };
    for (const w of this.cur.waypoints) {
      dist += Math.hypot(w.x - prev.x, w.z - prev.z);
      prev = w;
    }
    const est = (this.cur.shootPreload ? 2.0 : 0) + dist / 3 + this.cur.waypoints.reduce((a, w) => a + (w.wait ?? 0) + (w.shoot ? 2 : 0) + (w.climb ? 3 : 0), 0);
    const info = this.root.querySelector<HTMLElement>('[data-info]');
    if (info) {
      info.className = `msg ${warn ? 'bad' : est > 20 ? 'warn' : 'ok'}`;
      info.textContent = `${t('estTime')}: ${est.toFixed(1)} s / 20 s${warn ? ` · ${t('g403warn')}` : ''}`;
    }
  }
}

const clampX = (x: number) => Math.max(-F.HALF_L + 0.45, Math.min(X1 - 0.1, x));
const clampZ = (z: number) => Math.max(-F.HALF_W + 0.45, Math.min(F.HALF_W - 0.45, z));
