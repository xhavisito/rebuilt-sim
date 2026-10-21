/**
 * Planeador de estrategia (3 vs 3): vista superior de todo el campo, desde el lado azul. Para
 * cada DRIVER STATION se elige rol, carril y nivel de climb, y en el campo se dibuja su línea de
 * recolección (toca para agregar puntos, arrástralos), su punto de tiro, su posición inicial y su
 * rutina de AUTO (en automático se reparten sin choques; se ve la ruta). La estrategia se usa
 * para tu alianza o para el rival; para la alianza roja se refleja sola (ver src/ai/Strategy.ts).
 */
import { BUILTIN_STRATEGIES, LANE_EDGE, LANES, loadStrategies, plan, ROLES, saveCustomStrategies, type Lane, type Pt, type Role, type Strategy } from '../ai/Strategy';
import { assignAutos, loadRoutines, type AutoRoutine } from '../auto/AutoRoutine';
import * as F from '../config/field';
import { defaultStart, separateStarts } from '../core/startRules';
import type { StationNumber } from '../core/types';
import { bind, esc, seg, select, type Opt } from './forms';
import { t, type TKey } from './i18n';

const X0 = -F.HALF_L - 0.25;
const X1 = F.HALF_L + 0.25;
const Z0 = -F.HALF_W - 0.15;
const Z1 = F.HALF_W + 0.15;
const ROBOT_HALF = 0.43;
/** Color de cada DRIVER STATION (líneas y puntos). */
const DS_COLOR = ['#ff9f1c', '#2ec4b6', '#c77dff'];

type Tool = 'route' | 'shoot' | 'start';

export class StrategyPlanner {
  private list: Strategy[] = [];
  private cur!: Strategy;
  private ds: StationNumber = 1;
  private tool: Tool = 'route';
  private canvas!: HTMLCanvasElement;
  private drag = -1;
  private routines: AutoRoutine[] = [];

  constructor(
    private root: HTMLElement,
    private onBack: () => void,
    /** Elige la estrategia para tu alianza (`mine`) o el rival. */
    private onUse: (id: string, mine: boolean) => void,
    private current: () => { mine: string; opp: string },
  ) {}

  open(id?: string): void {
    this.list = loadStrategies();
    this.routines = loadRoutines();
    this.cur = structuredClone(this.list.find((s) => s.id === id) ?? this.list[0]);
    this.render();
  }

  private name(s: Strategy): string {
    return s.builtin ? t(s.name as TKey) : s.name;
  }

  private newStrategy(): Strategy {
    const n = this.list.filter((s) => !s.builtin).length + 1;
    return { id: `strat-${Date.now().toString(36)}`, name: `${t('myStrategyName')} ${n}`, plans: [plan(), plan(), plan()] };
  }

  private render(): void {
    this.root.innerHTML = `<div class="inner">
      <div class="brandbar"><div class="brand">REBUILT <span>SIM</span></div><div class="ctx">3 vs 3</div><div class="grow"></div><button class="chipbtn" data-back>← ${t('back')}</button></div>
      <h1>${t('strategyPlanner')}</h1>
      <div class="split">
        <div class="designer panel"><canvas></canvas><div class="msg" style="margin-top:6px">${t('planHint')}</div></div>
        <div class="panel form" data-side></div>
      </div>
    </div>`;
    this.root.querySelector('[data-back]')!.addEventListener('click', () => this.onBack());
    this.canvas = this.root.querySelector('canvas')!;
    this.attachCanvas();
    this.renderSide();
    this.draw();
  }

  private renderSide(): void {
    const side = this.root.querySelector<HTMLElement>('[data-side]')!;
    const opts: Opt[] = this.list.map((s) => ({ value: s.id, label: `${s.builtin ? '🔒 ' : ''}${this.name(s)}` }));
    if (!this.list.some((s) => s.id === this.cur.id)) opts.push({ value: this.cur.id, label: `✎ ${this.cur.name}` });
    const ro = !!this.cur.builtin;
    const p = this.cur.plans[this.ds - 1];
    const now = this.current();
    side.innerHTML = `
      <label>${t('strategy')}</label>${select('strategy', opts, this.cur.id)}
      <label>${t('routineName')}</label><input type="text" data-name value="${esc(this.name(this.cur))}" ${ro ? 'disabled' : ''}/>
      <label>${t('station')}</label>${seg('ds', ['1', '2', '3'].map((v, i) => ({ value: v, label: `DS ${v}`, cls: `ds${i + 1}` })), String(this.ds))}
      <label>${t('role')}</label>${seg('role', ROLES.map((r) => ({ value: r, label: t(`role_${r}` as TKey) })), p.role)}
      <label></label><div class="msg">${t(`roleHelp_${p.role}` as TKey)}</div>
      <label>${t('lane')}</label>${seg('lane', LANES.map((l) => ({ value: l, label: t(`lane_${l}` as TKey) })), p.lane)}
      <label>${t('endgameClimb')}</label>${seg('climb', ['auto', '0', '1', '2', '3'].map((v) => ({ value: v, label: v === 'auto' ? 'Auto' : v === '0' ? '—' : `L${v}` })), String(p.climb))}
      <label>${t('autoRoutine')}</label>${select('auto', [{ value: '', label: t('autoAssigned') }, ...this.routines.map((r) => ({ value: r.id, label: r.name }))], p.auto ?? '')}
      <label>${t('tool')}</label>${seg('tool', [{ value: 'route', label: t('tool_route') }, { value: 'shoot', label: t('tool_shoot') }, { value: 'start', label: t('tool_start') }], this.tool)}
      <label></label><div class="row">
        <button class="chipbtn" data-clearroute ${ro ? 'disabled' : ''}>${t('clearRoute')}</button>
        <button class="chipbtn" data-clearshoot ${ro ? 'disabled' : ''}>${t('clearShoot')}</button>
        <button class="chipbtn" data-clearstart ${ro ? 'disabled' : ''}>${t('clearStart')}</button>
      </div>
      <label></label><div class="row">
        <button class="chipbtn" data-new>${t('newStrategy')}</button>
        <button class="chipbtn" data-dup>${t('duplicate')}</button>
        ${ro ? '' : `<button class="chipbtn" data-save>${t('save')}</button><button class="chipbtn" data-del>${t('delete')}</button>`}
      </div>
      <label></label><div class="row">
        <button class="chipbtn ${now.mine === this.cur.id ? 'on' : ''}" data-mine>✓ ${t('useMine')}</button>
        <button class="chipbtn ${now.opp === this.cur.id ? 'on' : ''}" data-opp>✓ ${t('useOpp')}</button>
      </div>`;
    if (ro) side.querySelectorAll<HTMLButtonElement>('[data-seg] button').forEach((b) => (b.disabled = !b.closest('[data-seg="ds"]') && !b.closest('[data-seg="tool"]')));
    bind(side, (name, v) => {
      if (name === 'strategy') {
        const s = this.list.find((x) => x.id === v);
        if (s) this.cur = structuredClone(s);
        this.renderSide();
        this.draw();
        return;
      }
      const pl = this.cur.plans[this.ds - 1];
      if (name === 'ds') this.ds = Number(v) as StationNumber;
      if (name === 'tool') this.tool = v as Tool;
      if (name === 'role') pl.role = v as Role;
      if (name === 'lane') pl.lane = v as Lane;
      if (name === 'climb') pl.climb = v === 'auto' ? 'auto' : (Number(v) as 0 | 1 | 2 | 3);
      if (name === 'auto') pl.auto = v ? String(v) : null;
      if (name === 'ds' || name === 'role') this.renderSide();
      this.draw();
    });
    side.querySelector<HTMLInputElement>('[data-name]')?.addEventListener('input', (e) => (this.cur.name = (e.target as HTMLInputElement).value));
    side.querySelector('[data-clearroute]')?.addEventListener('click', () => {
      this.cur.plans[this.ds - 1].route = [];
      this.draw();
    });
    side.querySelector('[data-clearshoot]')?.addEventListener('click', () => {
      this.cur.plans[this.ds - 1].shootSpot = null;
      this.draw();
    });
    side.querySelector('[data-clearstart]')?.addEventListener('click', () => {
      this.cur.plans[this.ds - 1].startZ = null;
      this.draw();
    });
    if (ro) side.querySelector<HTMLSelectElement>('[data-sel="auto"]')?.setAttribute('disabled', '');
    side.querySelector('[data-new]')!.addEventListener('click', () => {
      this.cur = this.newStrategy();
      this.renderSide();
      this.draw();
    });
    side.querySelector('[data-dup]')!.addEventListener('click', () => {
      this.cur = { ...structuredClone(this.cur), id: `strat-${Date.now().toString(36)}`, name: `${this.name(this.cur)} (2)`, builtin: false };
      this.renderSide();
      this.draw();
    });
    side.querySelector('[data-save]')?.addEventListener('click', () => this.save());
    side.querySelector('[data-del]')?.addEventListener('click', () => {
      this.list = this.list.filter((s) => s.id !== this.cur.id);
      saveCustomStrategies(this.list);
      this.cur = structuredClone(BUILTIN_STRATEGIES[0]);
      this.renderSide();
      this.draw();
    });
    const use = (mine: boolean) => {
      if (!this.cur.builtin) this.save();
      this.onUse(this.cur.id, mine);
      this.renderSide();
    };
    side.querySelector('[data-mine]')!.addEventListener('click', () => use(true));
    side.querySelector('[data-opp]')!.addEventListener('click', () => use(false));
  }

  private save(): void {
    const i = this.list.findIndex((s) => s.id === this.cur.id);
    if (i >= 0) this.list[i] = structuredClone(this.cur);
    else this.list.push(structuredClone(this.cur));
    saveCustomStrategies(this.list);
    this.renderSide();
  }

  // ------------------------------------------------------------------ lienzo
  private get scale(): number {
    return this.canvas.width / (X1 - X0);
  }
  private toPx(x: number, z: number): [number, number] {
    return [(x - X0) * this.scale, (z - Z0) * this.scale];
  }
  private toField(px: number, py: number): Pt {
    return { x: px / this.scale + X0, z: py / this.scale + Z0 };
  }

  private attachCanvas(): void {
    const c = this.canvas;
    const resize = () => {
      const w = Math.max(300, c.clientWidth || 700);
      c.width = Math.round(w * (window.devicePixelRatio || 1));
      c.height = Math.round(c.width * ((Z1 - Z0) / (X1 - X0)));
      this.draw();
    };
    requestAnimationFrame(resize);
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      const p = this.toField(((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height);
      return { x: clampX(p.x), z: clampZ(p.z) };
    };
    c.addEventListener('pointerdown', (e) => {
      if (this.cur.builtin) return;
      const p = pos(e);
      const pl = this.cur.plans[this.ds - 1];
      if (this.tool === 'shoot') {
        pl.shootSpot = p;
        this.drag = -2;
      } else if (this.tool === 'start') {
        pl.startZ = p.z;
        this.drag = -3;
      } else {
        const hit = pl.route.findIndex((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.35);
        if (hit >= 0) this.drag = hit;
        else {
          pl.route.push(p);
          this.drag = pl.route.length - 1;
        }
      }
      c.setPointerCapture(e.pointerId);
      this.draw();
    });
    c.addEventListener('pointermove', (e) => {
      if (this.drag === -1) return;
      const p = pos(e);
      const pl = this.cur.plans[this.ds - 1];
      if (this.drag === -2) pl.shootSpot = p;
      else if (this.drag === -3) pl.startZ = p.z;
      else if (pl.route[this.drag]) pl.route[this.drag] = p;
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
    // Campo, ALLIANCE ZONES y CENTER LINE
    rect(-F.HALF_L, -F.HALF_W, F.HALF_L, F.HALF_W, '#5d6168');
    rect(-F.HALF_L, -F.HALF_W, F.STARTING_LINE_X_BLUE, F.HALF_W, '#566070');
    rect(-F.STARTING_LINE_X_BLUE, -F.HALF_W, F.HALF_L, F.HALF_W, '#6a5a5e');
    rect(-0.03, -F.HALF_W, 0.03, F.HALF_W, '#f0f0f0');
    // Carril elegido del DS seleccionado
    const p = this.cur.plans[this.ds - 1];
    if (p.lane !== 'any') {
      const [z0, z1] = p.lane === 'top' ? [-F.HALF_W, -LANE_EDGE] : p.lane === 'bottom' ? [LANE_EDGE, F.HALF_W] : [-LANE_EDGE, LANE_EDGE];
      rect(-F.HALF_L, z0, F.HALF_L, z1, 'rgba(255,255,255,.08)');
    }
    g.strokeStyle = 'rgba(255,255,255,.25)';
    g.setLineDash([S * 0.15, S * 0.15]);
    for (const z of [-LANE_EDGE, LANE_EDGE]) {
      g.beginPath();
      g.moveTo(...this.toPx(-F.HALF_L, z));
      g.lineTo(...this.toPx(F.HALF_L, z));
      g.stroke();
    }
    g.setLineDash([]);
    // HUBS, BUMPS, TRENCHES, TOWERS y DEPOTS de las dos alianzas
    for (const [sx, col, dark] of [[1, '#2c6cc4', '#1b4f9c'], [-1, '#c43c3c', '#8f2a2a']] as const) {
      const hx = sx * F.HUB_CENTER_X_BLUE;
      rect(hx - F.HUB_SIZE / 2, -F.HUB_SIZE / 2, hx + F.HUB_SIZE / 2, F.HUB_SIZE / 2, '#d9dde2');
      for (const s of [-1, 1]) {
        rect(hx - F.BUMP_DEPTH / 2, (s * F.HUB_SIZE) / 2, hx + F.BUMP_DEPTH / 2, s * (F.HUB_SIZE / 2 + F.BUMP_WIDTH), col);
        rect(hx - F.TRENCH_DEPTH / 2, s * F.TRENCH_INNER_Z, hx + F.TRENCH_DEPTH / 2, s * (F.HALF_W - F.TRENCH_CLEAR_WIDTH), dark);
      }
      const tw = F.towerInfo(sx > 0 ? 'blue' : 'red');
      rect(tw.cx, tw.cz - F.TOWER_BASE_WIDTH / 2, tw.cx + sx * F.TOWER_BASE_DEPTH, tw.cz + F.TOWER_BASE_WIDTH / 2, '#3e4249');
      const dp = F.depotCenter(sx > 0 ? 'blue' : 'red');
      rect(dp.x - F.DEPOT_DEPTH / 2, dp.z - F.DEPOT_WIDTH / 2, dp.x + F.DEPOT_DEPTH / 2, dp.z + F.DEPOT_WIDTH / 2, '#c9a400');
    }
    g.fillStyle = '#fff';
    g.font = `bold ${Math.round(S * 0.22)}px sans-serif`;
    const label = (txt: string, x: number, z: number, color = '#fff') => {
      const [a, b] = this.toPx(x, z);
      g.fillStyle = color;
      g.fillText(txt, a, b);
    };
    label('HUB', F.HUB_CENTER_X_BLUE - 0.3, 0.05, '#222');
    label('NEUTRAL ZONE', -0.9, -F.HALF_W + 0.35);
    if (p.lane !== 'any') label(t(`lane_${p.lane}` as TKey), -F.HALF_L + 0.2, p.lane === 'top' ? -LANE_EDGE - 0.2 : p.lane === 'bottom' ? LANE_EDGE + 0.45 : 0.05);
    // Posiciones iniciales (como quedan en el match: sin encimarse) y rutas de AUTO
    const starts = separateStarts(this.cur.plans.map((pl, i) => ({ z: pl.startZ ?? defaultStart('blue', (i + 1) as StationNumber, ROBOT_HALF).z, halfZ: ROBOT_HALF })));
    const autos = assignAutos(
      this.cur.plans.map((pl, i) => ({ station: (i + 1) as StationNumber, canClimb: true, z: starts[i], fixed: pl.auto ?? undefined })),
      this.routines,
    );
    this.cur.plans.forEach((_, i) => {
      const r = this.routines.find((x) => x.id === autos[i]);
      const st = defaultStart('blue', (i + 1) as StationNumber, ROBOT_HALF);
      if (!r) return;
      g.globalAlpha = (i + 1) === this.ds ? 0.95 : 0.5;
      g.strokeStyle = DS_COLOR[i];
      g.lineWidth = Math.max(1.5, S * 0.035);
      g.setLineDash([S * 0.12, S * 0.1]);
      g.beginPath();
      g.moveTo(...this.toPx(st.x, starts[i]));
      for (const w of r.waypoints) g.lineTo(...this.toPx(w.x, w.z));
      g.stroke();
      g.setLineDash([]);
      if (i + 1 === this.ds) {
        g.fillStyle = DS_COLOR[i];
        g.font = `bold ${Math.round(S * 0.17)}px sans-serif`;
        g.fillText(`AUTO: ${r.name}`, ...this.toPx(-1.3 - r.name.length * 0.085, F.HALF_W - 0.25));
      }
      g.globalAlpha = 1;
    });
    // Robots (posición inicial), líneas y puntos de tiro de cada DS
    this.cur.plans.forEach((pl, i) => {
      const ds = (i + 1) as StationNumber;
      const color = DS_COLOR[i];
      const on = ds === this.ds;
      const st = defaultStart('blue', ds, ROBOT_HALF);
      const [sx, sy] = this.toPx(st.x, starts[i]);
      g.globalAlpha = on ? 1 : 0.55;
      g.fillStyle = color;
      g.fillRect(sx - ROBOT_HALF * S, sy - ROBOT_HALF * S, 2 * ROBOT_HALF * S, 2 * ROBOT_HALF * S);
      g.fillStyle = '#111';
      g.font = `bold ${Math.round(S * 0.24)}px sans-serif`;
      g.fillText(String(ds), sx - S * 0.08, sy + S * 0.09);
      g.fillStyle = '#fff';
      g.font = `bold ${Math.round(S * 0.18)}px sans-serif`;
      g.fillText(t(`role_${pl.role}` as TKey), sx - ROBOT_HALF * S, sy - ROBOT_HALF * S - S * 0.08);
      // Línea de recolección
      if (pl.route.length) {
        g.strokeStyle = color;
        g.lineWidth = Math.max(2, S * (on ? 0.06 : 0.04));
        g.beginPath();
        pl.route.forEach((q, k) => (k ? g.lineTo(...this.toPx(q.x, q.z)) : g.moveTo(...this.toPx(q.x, q.z))));
        g.stroke();
        pl.route.forEach((q, k) => {
          const [a, b] = this.toPx(q.x, q.z);
          g.fillStyle = color;
          g.beginPath();
          g.arc(a, b, S * (on ? 0.15 : 0.1), 0, Math.PI * 2);
          g.fill();
          if (on) {
            g.fillStyle = '#111';
            g.font = `bold ${Math.round(S * 0.17)}px sans-serif`;
            g.fillText(String(k + 1), a - S * 0.05, b + S * 0.06);
          }
        });
      }
      // Punto de tiro (mira)
      if (pl.shootSpot) {
        const [a, b] = this.toPx(pl.shootSpot.x, pl.shootSpot.z);
        g.strokeStyle = color;
        g.lineWidth = Math.max(2, S * 0.05);
        g.beginPath();
        g.arc(a, b, S * 0.22, 0, Math.PI * 2);
        g.moveTo(a - S * 0.32, b);
        g.lineTo(a + S * 0.32, b);
        g.moveTo(a, b - S * 0.32);
        g.lineTo(a, b + S * 0.32);
        g.stroke();
      }
      g.globalAlpha = 1;
    });
  }
}

const clampX = (x: number) => Math.max(-F.HALF_L + 0.45, Math.min(F.HALF_L - 0.45, x));
const clampZ = (z: number) => Math.max(-F.HALF_W + 0.45, Math.min(F.HALF_W - 0.45, z));
