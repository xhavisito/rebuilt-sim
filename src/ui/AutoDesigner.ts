/**
 * Diseñador de AUTO tipo PathPlanner: vista superior de la mitad azul del campo (la rutina se
 * refleja sola para la alianza roja). Toca para agregar waypoints (sobre la ruta, la parte en
 * dos), arrastra los puntos, las manijas de la curva y la flecha de rumbo, y elige las acciones de
 * cada uno (intake, disparar, esperar, trepar L1, detenerse). La ruta se colorea por velocidad
 * con el mismo perfil que sigue el robot en el match (`auto/Trajectory.ts`), marca los choques
 * con el campo y se puede reproducir con la línea de tiempo.
 */
import { BUILTIN_ROUTINES, loadRoutines, sanitizeRoutine, saveCustomRoutines, type AutoRoutine, type AutoWaypoint } from '../auto/AutoRoutine';
import { buildTrajectory, constraintsFor, handles, headingOf, isStop, pathIssues, sampleAt, type PathIssue, type Trajectory } from '../auto/Trajectory';
import * as F from '../config/field';
import { allRobots, fitsUnderTrench, robotById, type RobotSpec } from '../config/robots';
import { defaultStart } from '../core/startRules';
import type { StationNumber } from '../core/types';
import { bind, esc, seg, select, type Opt } from './forms';
import { t, type TKey } from './i18n';
import { backBtn, brandbar, ic } from './chrome';
import { alpha, box, CANVAS_FONT, FIELD_PAL } from './fieldStyle';

const X0 = -F.HALF_L - 0.25;
const X1 = 1.2;
const Z0 = -F.HALF_W - 0.15;
const Z1 = F.HALF_W + 0.15;
const SPEEDS = ['0.5', '0.7', '0.85', '1'];
/** Tiempo de la precarga y de cada acción en la vista previa (s). */
const PRELOAD_T = 2.0;

type Drag = { kind: 'wp'; i: number } | { kind: 'hin' | 'hout'; i: number } | { kind: 'rot'; i: number } | null;

export class AutoDesigner {
  private routines: AutoRoutine[] = [];
  private cur!: AutoRoutine;
  private sel = -1;
  private station: StationNumber = 2;
  private spec: RobotSpec = robotById('');
  private canvas!: HTMLCanvasElement;
  private drag: Drag = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** Trayectoria de la vista previa (marco azul) y su línea de tiempo. */
  private traj: Trajectory | null = null;
  private issues: Array<PathIssue | null> = [];
  private playT = 0;
  private playing = false;
  private raf = 0;
  /** Aviso temporal (guardado, importado…) y hasta cuándo se muestra. */
  private flash = '';
  private flashUntil = 0;
  /** Estado antes de arrastrar (para deshacer el arrastre completo de una vez). */
  private dragBefore = '';
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(
    private root: HTMLElement,
    private onBack: () => void,
    private onTest: (routineId: string, station: StationNumber) => void,
  ) {}

  open(routineId?: string, robotId?: string): void {
    this.routines = loadRoutines();
    if (robotId !== undefined) this.spec = robotById(robotId);
    const found = this.routines.find((r) => r.id === routineId);
    this.cur = structuredClone(found && !found.builtin ? found : this.newRoutine());
    this.sel = -1;
    this.undoStack = [];
    this.redoStack = [];
    this.render();
    document.removeEventListener('keydown', this.keyHandler);
    document.addEventListener('keydown', this.keyHandler);
  }

  private close(): void {
    this.stop();
    document.removeEventListener('keydown', this.keyHandler);
    this.onBack();
  }

  private newRoutine(): AutoRoutine {
    const base = BUILTIN_ROUTINES.find((r) => r.id === 'spline-sweep')!;
    return {
      id: `custom-${Date.now().toString(36)}`,
      name: `${t('myRoutine')} ${this.routines.filter((r) => !r.builtin).length + 1}`,
      shootPreload: true,
      spline: true,
      speed: 0.85,
      mirrorToStart: true,
      waypoints: structuredClone(base.waypoints),
    };
  }

  private get readonly(): boolean {
    return !!this.cur.builtin;
  }

  // ------------------------------------------------------------------ deshacer
  private snapshot(): void {
    this.undoStack.push(JSON.stringify(this.cur));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
  }
  private undo(redo = false): void {
    const from = redo ? this.redoStack : this.undoStack;
    const to = redo ? this.undoStack : this.redoStack;
    const s = from.pop();
    if (!s) return;
    to.push(JSON.stringify(this.cur));
    this.cur = JSON.parse(s) as AutoRoutine;
    this.sel = Math.min(this.sel, this.cur.waypoints.length - 1);
    this.renderSide();
    this.changed();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.canvas?.isConnected) {
      document.removeEventListener('keydown', this.keyHandler);
      return;
    }
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      this.undo(e.shiftKey);
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
      e.preventDefault();
      this.undo(true);
    } else if ((e.code === 'Delete' || e.code === 'Backspace') && this.sel >= 0 && !this.readonly) {
      e.preventDefault();
      this.removeSelected();
    } else if (e.code === 'Space') {
      e.preventDefault();
      this.togglePlay();
    } else if (e.code === 'Escape') {
      this.sel = -1;
      this.renderSide();
      this.draw();
    }
  }

  private removeSelected(): void {
    if (this.sel < 0) return;
    this.snapshot();
    this.cur.waypoints.splice(this.sel, 1);
    this.sel = -1;
    this.renderSide();
    this.changed();
  }

  // ------------------------------------------------------------------ pantalla
  private render(): void {
    this.stop();
    this.root.innerHTML = `<div class="inner">
      ${brandbar('2026 REBUILT', backBtn('data-back'))}
      <h1>${t('autoDesigner')}</h1>
      <div class="split">
        <div class="designer panel">
          <canvas></canvas>
          <div class="timeline">
            <button class="chipbtn" data-play aria-label="play">${ic.play}</button>
            <input type="range" data-scrub min="0" max="1" step="0.01" value="0"/>
            <span data-clock>0.0 s</span>
          </div>
          <div class="msg" data-info></div>
          <div class="hint">${t('designerHelp')}</div>
        </div>
        <div class="panel form" data-side></div>
      </div>
    </div>`;
    this.root.querySelector('[data-back]')!.addEventListener('click', () => this.close());
    this.canvas = this.root.querySelector('canvas')!;
    this.root.querySelector('[data-play]')!.addEventListener('click', () => this.togglePlay());
    this.root.querySelector<HTMLInputElement>('[data-scrub]')!.addEventListener('input', (e) => {
      this.playing = false;
      this.playT = Number((e.target as HTMLInputElement).value);
      this.syncTimeline();
      this.draw();
    });
    this.attachCanvas();
    this.renderSide();
    this.changed();
  }

  private routineOpts(): Opt[] {
    const opts: Opt[] = this.routines.map((r) => ({ value: r.id, label: `${r.builtin ? '🔒 ' : ''}${r.name}` }));
    if (!this.routines.some((r) => r.id === this.cur.id)) opts.push({ value: this.cur.id, label: `✎ ${this.cur.name}` });
    return opts;
  }

  private renderSide(): void {
    const side = this.root.querySelector<HTMLElement>('[data-side]');
    if (!side) return;
    const w = this.cur.waypoints[this.sel];
    const ro = this.readonly;
    const spline = !!this.cur.spline;
    const headOpts: Opt[] = [
      { value: 'auto', label: t('headingAuto') },
      { value: '0', label: '→ 0°' },
      { value: '90', label: '↑ 90°' },
      { value: '180', label: '← 180°' },
      { value: '270', label: '↓ 270°' },
    ];
    const deg = w && w.heading !== null ? Math.round(((w.heading * 180) / Math.PI + 360) % 360) : null;
    const hv = w ? (deg === null ? 'auto' : String(deg)) : 'auto';
    const robots: Opt[] = allRobots().map((r) => ({ value: r.id, label: r.teamNumber ? `${r.teamNumber} · ${r.name}` : r.name }));
    const speed = String(this.cur.speed ?? 0.85);
    const onoff = (v: boolean | undefined): string => (v ? '1' : '0');
    const yn: Opt[] = [
      { value: '1', label: t('on') },
      { value: '0', label: t('off') },
    ];
    side.innerHTML = `
      <label>${t('autoRoutine')}</label>${select('routine', this.routineOpts(), this.cur.id)}
      <label>${t('routineName')}</label><input type="text" data-name maxlength="48" value="${esc(this.cur.name)}" ${ro ? 'disabled' : ''}/>
      ${ro ? `<div class="msg warn" style="grid-column:1/-1">${t('routineReadonly')}</div>` : ''}
      <label>${t('pathMode')}</label>${seg('mode', [{ value: '1', label: t('pathSmooth') }, { value: '0', label: t('pathPoints') }], onoff(spline))}
      ${spline ? `<label>${t('pathSpeed')}</label>${seg('speed', SPEEDS.map((v) => ({ value: v, label: `${Math.round(Number(v) * 100)}%` })), SPEEDS.includes(speed) ? speed : '0.85')}` : ''}
      <label>${t('shootPreload')}</label>${seg('preload', yn, onoff(this.cur.shootPreload))}
      <label>${t('station')}</label>${seg('station', ['1', '2', '3'].map((v) => ({ value: v, label: v })), String(this.station))}
      <label>${t('mirrorStart')}</label>${seg('mirror', yn, onoff(this.cur.mirrorToStart))}
      <label>${t('previewRobot')}</label>${select('robot', robots, this.spec.id)}
      <h3>${w ? `${t('waypoint')} ${this.sel + 1}` : t('tapToAdd')}</h3>
      ${
        w
          ? `<label>${t('heading')}${deg !== null ? ` (${deg}°)` : ''}</label>${seg('heading', headOpts, hv)}
        <label>INTAKE</label>${seg('intake', [{ value: 'keep', label: '—' }, { value: 'on', label: t('on') }, { value: 'off', label: t('off') }], w.intake === undefined ? 'keep' : w.intake ? 'on' : 'off')}
        <label>${t('a_shoot')}</label>${seg('shoot', yn, onoff(w.shoot))}
        <label>${t('wait')}</label>${seg('wait', ['0', '0.5', '1', '2', '3'].map((v) => ({ value: v, label: `${v} s` })), String(w.wait ?? 0))}
        <label>${t('climbL1')}</label>${seg('climb', yn, onoff(w.climb))}
        ${spline ? `<label>${t('stopHere')}</label>${seg('stop', yn, onoff(isStop(w, this.sel === this.cur.waypoints.length - 1)))}` : ''}
        <label></label><div class="row">
          ${spline && (w.hin || w.hout) ? `<button class="chipbtn" data-reset>${t('resetHandles')}</button>` : ''}
          <button class="chipbtn" data-del>${t('delete')}</button><button class="chipbtn" data-desel>${ic.check}</button></div>`
          : ''
      }
      <label></label><div class="row">
        <button class="chipbtn" data-new>${t('newRoutine')}</button>
        <button class="chipbtn" data-dup>${t('duplicate')}</button>
        ${ro ? '' : `<button class="chipbtn" data-save>${t('save')}</button><button class="chipbtn" data-delr>${t('delete')}</button>`}
        <button class="chipbtn" data-undo ${this.undoStack.length ? '' : 'disabled'}>${ic.undo}${t('undo')}</button>
      </div>
      <label></label><div class="row">
        <button class="chipbtn" data-export>${ic.download}${t('exportJson')}</button>
        <label class="chipbtn" style="cursor:pointer">${ic.upload}${t('importJson')}<input type="file" accept=".json,application/json" data-import hidden/></label>
        <button class="chipbtn on" data-test>${ic.play}${t('test')}</button>
      </div>`;
    if (ro) side.querySelectorAll<HTMLButtonElement>('[data-seg] button').forEach((b) => (b.disabled = !b.closest('[data-seg="station"]')));
    bind(side, (name, v) => {
      if (name === 'routine') {
        const r = this.routines.find((x) => x.id === v);
        if (r) this.cur = structuredClone(r);
        this.sel = -1;
        this.undoStack = [];
        this.redoStack = [];
        this.render();
        return;
      }
      if (name === 'station') {
        this.station = Number(v) as StationNumber;
        this.changed();
        return;
      }
      if (name === 'robot') {
        this.spec = robotById(String(v));
        this.changed();
        return;
      }
      this.snapshot();
      if (name === 'preload') this.cur.shootPreload = v === '1';
      if (name === 'mode') {
        this.cur.spline = v === '1';
        this.renderSide();
      }
      if (name === 'speed') this.cur.speed = Number(v);
      if (name === 'mirror') this.cur.mirrorToStart = v === '1' || undefined;
      const wp = this.cur.waypoints[this.sel];
      if (wp) {
        if (name === 'heading') wp.heading = v === 'auto' ? null : (Number(v) * Math.PI) / 180;
        if (name === 'intake') wp.intake = v === 'keep' ? undefined : v === 'on';
        if (name === 'shoot') wp.shoot = v === '1';
        if (name === 'wait') wp.wait = Number(v) || undefined;
        if (name === 'climb') wp.climb = v === '1';
        if (name === 'stop') wp.stop = v === '1' || undefined;
        if (name === 'heading' || name === 'stop' || name === 'shoot' || name === 'wait' || name === 'climb') this.renderSide();
      }
      this.changed();
    });
    side.querySelector<HTMLInputElement>('[data-name]')?.addEventListener('input', (e) => (this.cur.name = (e.target as HTMLInputElement).value));
    side.querySelector('[data-del]')?.addEventListener('click', () => this.removeSelected());
    side.querySelector('[data-reset]')?.addEventListener('click', () => {
      const wp = this.cur.waypoints[this.sel];
      if (!wp) return;
      this.snapshot();
      delete wp.hin;
      delete wp.hout;
      this.renderSide();
      this.changed();
    });
    side.querySelector('[data-desel]')?.addEventListener('click', () => {
      this.sel = -1;
      this.renderSide();
      this.draw();
    });
    side.querySelector('[data-new]')!.addEventListener('click', () => {
      this.cur = this.newRoutine();
      this.cur.waypoints = [];
      this.sel = -1;
      this.render();
    });
    side.querySelector('[data-dup]')!.addEventListener('click', () => {
      // Al duplicar una incluida se queda con su modo (punto a punto) y se puede cambiar a suave
      this.cur = { ...structuredClone(this.cur), id: `custom-${Date.now().toString(36)}`, name: `${this.cur.name} (2)`, builtin: false };
      this.render();
    });
    side.querySelector('[data-undo]')?.addEventListener('click', () => this.undo());
    side.querySelector('[data-save]')?.addEventListener('click', () => {
      this.save();
      this.render();
      this.notify(t('saved'));
    });
    side.querySelector('[data-delr]')?.addEventListener('click', () => {
      this.routines = this.routines.filter((r) => r.id !== this.cur.id);
      saveCustomRoutines(this.routines);
      this.cur = structuredClone(BUILTIN_ROUTINES[2]);
      this.render();
    });
    side.querySelector('[data-export]')!.addEventListener('click', () => this.exportJson());
    side.querySelector<HTMLInputElement>('[data-import]')!.addEventListener('change', (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) void f.text().then((txt) => this.importJson(txt));
    });
    side.querySelector('[data-test]')!.addEventListener('click', () => {
      if (!this.readonly) this.save();
      this.stop();
      document.removeEventListener('keydown', this.keyHandler);
      this.onTest(this.cur.id, this.station);
    });
  }

  private save(): void {
    if (!this.cur.name.trim()) this.cur.name = t('myRoutine');
    const i = this.routines.findIndex((r) => r.id === this.cur.id);
    if (i >= 0) this.routines[i] = structuredClone(this.cur);
    else this.routines.push(structuredClone(this.cur));
    saveCustomRoutines(this.routines);
  }

  private notify(msg: string): void {
    this.flash = msg;
    this.flashUntil = performance.now() + 4000;
    this.draw();
    setTimeout(() => this.draw(), 4100);
  }

  private exportJson(): void {
    const { id: _id, builtin: _b, ...data } = this.cur;
    const blob = new Blob([JSON.stringify({ format: 'rebuilt-sim-auto', version: 1, ...data }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.cur.name.replace(/[^\w\- ]+/g, '').trim() || 'auto'}.auto.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** Importa una rutina (JSON exportado); se guarda como nueva. */
  importJson(txt: string): boolean {
    let r: AutoRoutine | null = null;
    try {
      r = sanitizeRoutine(JSON.parse(txt));
    } catch {
      r = null;
    }
    if (!r) {
      this.notify(`✗ ${t('importBad')}`);
      return false;
    }
    this.cur = r;
    this.sel = -1;
    this.save();
    this.routines = loadRoutines();
    this.render();
    this.notify(t('imported', { n: r.name }));
    return true;
  }

  // ------------------------------------------------------------------ trayectoria
  private get halfL(): number {
    return (this.spec.lengthIn / 2 + this.spec.bumperIn) * F.IN;
  }
  private get halfW(): number {
    return (this.spec.widthIn / 2 + this.spec.bumperIn) * F.IN;
  }
  /**
   * Salida de la DS elegida. Con "se adapta a su lado" el robot refleja la rutina en z si sale del
   * otro lado (`AutoExecutor`); aquí, para no editar una ruta reflejada, se refleja la salida.
   */
  private startPose(): { x: number; z: number; heading: number } {
    const st = defaultStart('blue', this.station, this.halfL);
    return this.mirrored(st.z) ? { ...st, z: -st.z } : st;
  }
  private mirrored(z: number): boolean {
    const first = this.cur.waypoints.find((w) => Math.abs(w.z) > 0.3);
    return !!this.cur.mirrorToStart && !!first && Math.sign(first.z) !== Math.sign(z) && Math.abs(z) > 0.3;
  }
  /** Retraso inicial: la precarga (con turret se tira mientras avanza). */
  private get preT(): number {
    return this.cur.shootPreload && (this.spec.shooter.type !== 'turret' || !this.cur.waypoints.length) ? PRELOAD_T : 0;
  }

  /** Waypoints tal como los recorre el robot: punto a punto = paradas en línea recta. */
  private pathWps(): AutoWaypoint[] {
    if (this.cur.spline) return this.cur.waypoints;
    return this.cur.waypoints.map((w) => ({ ...w, stop: true, hin: undefined, hout: undefined }));
  }

  /** Recalcula la trayectoria y redibuja (después de cualquier cambio). */
  private changed(): void {
    const wps = this.pathWps();
    const turret = this.spec.shooter.type === 'turret';
    this.traj = wps.length
      ? buildTrajectory(this.startPose(), wps, constraintsFor(this.spec, this.cur.spline ? this.cur.speed : 0.9), {
          dwell: (w) => (w.wait ?? 0) + (w.shoot ? (turret ? 1.2 : 2) : 0) + (w.climb ? 3 : 0),
        })
      : null;
    this.issues = this.traj ? pathIssues(this.traj.samples, Math.min(this.halfL, this.halfW) * 0.9, fitsUnderTrench(this.spec), this.halfL) : [];
    this.playT = Math.min(this.playT, this.total);
    this.syncTimeline();
    this.draw();
    const u = this.root.querySelector<HTMLButtonElement>('[data-undo]');
    if (u) u.disabled = !this.undoStack.length;
  }

  private get total(): number {
    return this.preT + (this.traj?.duration ?? 0);
  }

  private togglePlay(): void {
    if (this.playing) {
      this.stop();
      return;
    }
    if (this.playT >= this.total - 1e-3) this.playT = 0;
    this.playing = true;
    let last = performance.now();
    const step = (now: number) => {
      if (!this.playing || !this.canvas.isConnected) return this.stop();
      this.playT = Math.min(this.total, this.playT + (now - last) / 1000);
      last = now;
      this.syncTimeline();
      this.draw();
      if (this.playT >= this.total) return this.stop();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
    this.syncTimeline();
  }

  private stop(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.syncTimeline();
  }

  private syncTimeline(): void {
    const s = this.root.querySelector<HTMLInputElement>('[data-scrub]');
    if (!s) return;
    s.max = String(Math.max(0.01, this.total));
    s.value = String(this.playT);
    this.root.querySelector('[data-clock]')!.textContent = `${this.playT.toFixed(1)} / ${this.total.toFixed(1)} s`;
    this.root.querySelector('[data-play]')!.innerHTML = this.playing ? ic.pause : ic.play;
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

  /** Puntos de las manijas del waypoint i (posición absoluta). */
  private handlePts(i: number): { hin: { x: number; z: number }; hout: { x: number; z: number } | null } {
    const wps = this.cur.waypoints;
    const h = handles(this.startPose(), wps);
    const w = wps[i];
    return { hin: { x: w.x + h.hin[i].x, z: w.z + h.hin[i].z }, hout: i < wps.length - 1 ? { x: w.x + h.hout[i].x, z: w.z + h.hout[i].z } : null };
  }

  /** Punta de la flecha de rumbo del waypoint i. */
  private rotPt(i: number): { x: number; z: number } {
    const w = this.cur.waypoints[i];
    let h = w.heading;
    if (h === null) {
      const near = this.traj?.samples.find((q) => q.wp === i && Math.hypot(q.x - w.x, q.z - w.z) < 1e-6);
      h = near ? near.heading : 0;
    }
    const L = this.halfL + 0.25;
    return { x: w.x + Math.cos(h) * L, z: w.z - Math.sin(h) * L };
  }

  private attachCanvas(): void {
    const c = this.canvas;
    const resize = () => {
      if (!c.isConnected) return window.removeEventListener('resize', resize);
      // Cabe a lo ancho del panel y a lo alto de la ventana (teléfono horizontal)
      const aspect = (X1 - X0) / (Z1 - Z0);
      const w = Math.round(Math.max(280, Math.min(c.parentElement?.clientWidth || 600, (window.innerHeight - 150) * aspect)));
      c.style.width = `${w}px`;
      c.width = Math.round(w * (window.devicePixelRatio || 1));
      c.height = Math.round(c.width * ((Z1 - Z0) / (X1 - X0)));
      this.draw();
    };
    requestAnimationFrame(resize);
    window.addEventListener('resize', resize);
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return this.toField(((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height);
    };
    c.addEventListener('pointerdown', (e) => {
      if (this.readonly) return;
      const p = pos(e);
      // tolerancia de toque: más grande con el dedo
      const tol = e.pointerType === 'touch' ? 0.45 : 0.3;
      const near = (q: { x: number; z: number } | null) => !!q && Math.hypot(q.x - p.x, q.z - p.z) < tol;
      this.dragBefore = JSON.stringify(this.cur);
      let drag: Drag = null;
      if (this.sel >= 0 && this.cur.waypoints[this.sel]) {
        if (this.cur.spline) {
          const hp = this.handlePts(this.sel);
          if (near(hp.hout)) drag = { kind: 'hout', i: this.sel };
          else if (near(hp.hin)) drag = { kind: 'hin', i: this.sel };
        }
        if (!drag && this.cur.spline && near(this.rotPt(this.sel))) drag = { kind: 'rot', i: this.sel };
      }
      if (!drag) {
        const hit = this.cur.waypoints.findIndex((w) => Math.hypot(w.x - p.x, w.z - p.z) < tol);
        if (hit >= 0) drag = { kind: 'wp', i: hit };
      }
      if (!drag) {
        // Sobre la ruta: inserta un waypoint en ese tramo; si no, después del seleccionado / al final
        let at = this.sel >= 0 ? this.sel + 1 : this.cur.waypoints.length;
        if (this.traj) {
          let best = tol;
          for (const q of this.traj.samples) {
            const d = Math.hypot(q.x - p.x, q.z - p.z);
            if (d < best) {
              best = d;
              at = Math.min(q.wp, this.cur.waypoints.length);
            }
          }
        }
        this.cur.waypoints.splice(at, 0, { x: clampX(p.x), z: clampZ(p.z), heading: null });
        drag = { kind: 'wp', i: at };
      }
      this.sel = drag.i;
      this.drag = drag;
      c.setPointerCapture(e.pointerId);
      this.renderSide();
      this.changed();
    });
    c.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const p = pos(e);
      const w = this.cur.waypoints[d.i];
      if (!w) return;
      if (d.kind === 'wp') {
        w.x = clampX(p.x);
        w.z = clampZ(p.z);
      } else if (d.kind === 'rot') {
        // con 5° de paso (15° con Shift)
        const step = ((e.shiftKey ? 15 : 5) * Math.PI) / 180;
        w.heading = Math.round(headingOf(p.x - w.x, p.z - w.z) / step) * step;
      } else {
        // Manija: la contraria se mueve en línea (curva suave) salvo en las paradas (esquina libre)
        const off = { x: p.x - w.x, z: p.z - w.z };
        const other = d.kind === 'hout' ? 'hin' : 'hout';
        const free = isStop(w, d.i === this.cur.waypoints.length - 1);
        const hp = this.handlePts(d.i);
        const op = other === 'hin' ? hp.hin : hp.hout;
        w[d.kind] = off;
        if (!free && op) {
          const len = Math.hypot(op.x - w.x, op.z - w.z);
          const m = Math.hypot(off.x, off.z) || 1;
          w[other] = { x: (-off.x / m) * len, z: (-off.z / m) * len };
        }
      }
      this.changed();
    });
    const up = () => {
      if (!this.drag) return;
      if (this.dragBefore && this.dragBefore !== JSON.stringify(this.cur)) {
        this.undoStack.push(this.dragBefore);
        this.redoStack = [];
      }
      this.dragBefore = '';
      this.drag = null;
      this.renderSide();
      this.changed();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  draw(): void {
    const c = this.canvas;
    if (!c || !c.width) return;
    const g = c.getContext('2d')!;
    const S = this.scale;
    const P = FIELD_PAL;
    const lw = Math.max(1, S * 0.025);
    g.fillStyle = P.bg;
    g.fillRect(0, 0, c.width, c.height);
    const rect = (x0: number, z0: number, x1: number, z1: number, fill: string | null, stroke: string | null = null) => {
      const [a, b] = this.toPx(Math.min(x0, x1), Math.min(z0, z1));
      box(g, a, b, Math.abs(x1 - x0) * S, Math.abs(z1 - z0) * S, fill, stroke, lw);
    };
    // Campo y zonas (cuadrícula de 1 m como referencia)
    rect(-F.HALF_L, -F.HALF_W, X1, F.HALF_W, P.floor, P.edge);
    rect(-F.HALF_L, -F.HALF_W, F.STARTING_LINE_X_BLUE, F.HALF_W, alpha(P.blue, 0.13));
    g.strokeStyle = P.grid;
    g.lineWidth = 1;
    for (let x = Math.ceil(-F.HALF_L); x <= X1; x++) {
      const [a] = this.toPx(x, 0);
      g.beginPath();
      g.moveTo(a, this.toPx(0, -F.HALF_W)[1]);
      g.lineTo(a, this.toPx(0, F.HALF_W)[1]);
      g.stroke();
    }
    for (let z = Math.ceil(-F.HALF_W); z <= F.HALF_W; z++) {
      const [, b] = this.toPx(0, z);
      g.beginPath();
      g.moveTo(this.toPx(-F.HALF_L, 0)[0], b);
      g.lineTo(this.toPx(X1, 0)[0], b);
      g.stroke();
    }
    rect(F.STARTING_LINE_X_BLUE - F.TAPE_WIDTH, -F.HALF_W, F.STARTING_LINE_X_BLUE, F.HALF_W, P.blue);
    g.strokeStyle = P.center;
    g.setLineDash([S * 0.2, S * 0.14]);
    g.beginPath();
    g.moveTo(...this.toPx(0, -F.HALF_W));
    g.lineTo(...this.toPx(0, F.HALF_W));
    g.stroke();
    g.setLineDash([]);
    // HUB, BUMPS, TRENCHES
    const hx = F.HUB_CENTER_X_BLUE;
    rect(hx - F.HUB_SIZE / 2, -F.HUB_SIZE / 2, hx + F.HUB_SIZE / 2, F.HUB_SIZE / 2, alpha(P.blue, 0.28), P.blue);
    for (const s of [-1, 1]) {
      rect(hx - F.BUMP_DEPTH / 2, (s * F.HUB_SIZE) / 2, hx + F.BUMP_DEPTH / 2, s * (F.HUB_SIZE / 2 + F.BUMP_WIDTH), alpha(P.blue, 0.12), P.blue);
      rect(hx - F.TRENCH_DEPTH / 2, s * F.TRENCH_INNER_Z, hx + F.TRENCH_DEPTH / 2, s * (F.HALF_W - F.TRENCH_CLEAR_WIDTH), null, P.blue);
      rect(hx - 0.08, s * (F.HALF_W - F.TRENCH_CLEAR_WIDTH), hx + 0.08, s * F.HALF_W, alpha(P.tower, 0.5));
    }
    // TOWER, DEPOT, OUTPOST
    const tw = F.towerInfo('blue');
    rect(-F.HALF_L, tw.cz - F.TOWER_BASE_WIDTH / 2, -F.HALF_L + F.TOWER_BASE_DEPTH, tw.cz + F.TOWER_BASE_WIDTH / 2, alpha(P.blue, 0.1), P.blue);
    rect(tw.uprightX - 0.05, tw.cz - F.UPRIGHT_GAP / 2 - 0.2, tw.uprightX + 0.05, tw.cz + F.UPRIGHT_GAP / 2 + 0.2, P.blue);
    const dp = F.depotCenter('blue');
    rect(-F.HALF_L, dp.z - F.DEPOT_WIDTH / 2, -F.HALF_L + F.DEPOT_DEPTH, dp.z + F.DEPOT_WIDTH / 2, alpha(P.fuel, 0.18), alpha(P.fuel, 0.6));
    const op = F.outpostInfo('blue');
    rect(-F.HALF_L - 0.2, op.z - 0.42, -F.HALF_L, op.z + 0.42, P.blue);
    // Etiquetas
    g.fillStyle = P.label;
    g.font = `600 ${Math.round(S * 0.22)}px ${CANVAS_FONT}`;
    const label = (txt: string, x: number, z: number) => {
      const [a, b] = this.toPx(x, z);
      g.fillText(txt, a, b);
    };
    label('HUB', hx - 0.3, 0.08);
    label('TOWER', -F.HALF_L + 0.05, tw.cz + 0.75);
    label('DEPOT', -F.HALF_L + 0.05, dp.z - 0.6);
    label('OUTPOST', -F.HALF_L + 0.05, op.z + 0.15);
    label('CENTER LINE', 0.08, -F.HALF_W + 0.3);
    // Robot en la posición inicial (DS seleccionada)
    const st = this.startPose();
    this.robotBox(g, st.x, st.z, st.heading, 'rgba(30,136,229,.85)', '#bfe0ff');
    if (this.mirrored(defaultStart('blue', this.station, this.halfL).z)) {
      // salida reflejada: la DS real queda del otro lado
      g.fillStyle = '#bfe0ff';
      g.font = `600 ${Math.round(S * 0.3)}px ${CANVAS_FONT}`;
      const [a, b] = this.toPx(st.x, st.z);
      g.fillText('⇅', a - S * 0.1, b + S * 0.1);
    }
    const tr = this.traj;
    const wps = this.cur.waypoints;
    // Ruta coloreada por velocidad (azul lento → amarillo → rojo rápido); choques en rojo intenso
    if (tr) {
      const vmax = constraintsFor(this.spec, 1).maxVel;
      g.lineCap = 'round';
      g.lineWidth = Math.max(3, S * 0.06);
      for (let i = 1; i < tr.samples.length; i++) {
        const a = tr.samples[i - 1];
        const b = tr.samples[i];
        g.strokeStyle = this.issues[i] ? '#ff1744' : speedColor(b.v / vmax);
        g.beginPath();
        g.moveTo(...this.toPx(a.x, a.z));
        g.lineTo(...this.toPx(b.x, b.z));
        g.stroke();
      }
      // marcas de tiempo cada segundo
      g.fillStyle = 'rgba(255,255,255,.85)';
      let nextT = 1;
      for (const q of tr.samples) {
        if (q.t + this.preT >= nextT) {
          const [a, b] = this.toPx(q.x, q.z);
          g.beginPath();
          g.arc(a, b, Math.max(1.5, S * 0.035), 0, Math.PI * 2);
          g.fill();
          nextT = Math.floor(q.t + this.preT) + 1;
        }
      }
    }
    // Waypoints: huella del robot con su rumbo, número y acciones
    wps.forEach((w, i) => {
      const [a, b] = this.toPx(w.x, w.z);
      const selected = i === this.sel;
      const stop = this.cur.spline ? isStop(w, i === wps.length - 1) : true;
      if (w.heading !== null || selected) this.robotBox(g, w.x, w.z, w.heading ?? this.rotHeading(i), 'rgba(0,0,0,0)', selected ? '#ffffff' : 'rgba(255,255,255,.45)');
      g.fillStyle = selected ? '#ffffff' : stop ? '#f2c400' : '#9be7ff';
      g.beginPath();
      if (stop) g.arc(a, b, S * 0.17, 0, Math.PI * 2);
      else {
        // de paso: rombo
        const r = S * 0.17;
        g.moveTo(a, b - r);
        g.lineTo(a + r, b);
        g.lineTo(a, b + r);
        g.lineTo(a - r, b);
        g.closePath();
      }
      g.fill();
      g.fillStyle = '#111';
      g.font = `600 ${Math.round(S * 0.2)}px ${CANVAS_FONT}`;
      g.textAlign = 'center';
      g.fillText(String(i + 1), a, b + S * 0.07);
      g.textAlign = 'left';
      const stopT = tr?.stops.find((s) => s.wp === i);
      const tags = [
        w.intake === true ? 'I+' : w.intake === false ? 'I−' : '',
        w.shoot ? '⦿' : '',
        w.wait ? `${w.wait}s` : '',
        w.climb ? 'L1' : '',
        stopT ? `@${(stopT.t + this.preT).toFixed(1)}s` : '',
      ]
        .filter(Boolean)
        .join(' ');
      if (tags) {
        g.fillStyle = '#fff';
        g.font = `600 ${Math.round(S * 0.18)}px ${CANVAS_FONT}`;
        g.fillText(tags, a + S * 0.22, b - S * 0.18);
      }
    });
    // Manijas y flecha de rumbo del seleccionado
    const w = wps[this.sel];
    if (w && this.cur.spline) {
      const hp = this.handlePts(this.sel);
      const [a, b] = this.toPx(w.x, w.z);
      for (const h of [hp.hin, hp.hout]) {
        if (!h) continue;
        const [hx2, hy2] = this.toPx(h.x, h.z);
        g.strokeStyle = 'rgba(255,255,255,.8)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(a, b);
        g.lineTo(hx2, hy2);
        g.stroke();
        g.fillStyle = '#ff9800';
        g.beginPath();
        g.arc(hx2, hy2, S * 0.1, 0, Math.PI * 2);
        g.fill();
      }
      const rp = this.rotPt(this.sel);
      const [ra, rb] = this.toPx(rp.x, rp.z);
      g.strokeStyle = '#e040fb';
      g.lineWidth = 2;
      g.setLineDash(w.heading === null ? [4, 4] : []);
      g.beginPath();
      g.moveTo(a, b);
      g.lineTo(ra, rb);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#e040fb';
      g.beginPath();
      g.arc(ra, rb, S * 0.09, 0, Math.PI * 2);
      g.fill();
    }
    // Robot de la vista previa en el tiempo de la línea de tiempo
    if (tr && (this.playT > 0 || this.playing)) {
      const q = sampleAt(tr, this.playT - this.preT);
      this.robotBox(g, q.x, q.z, q.heading, 'rgba(242,196,0,.35)', '#f2c400');
    }
    // Resumen: tiempo total y avisos
    const info = this.root.querySelector<HTMLElement>('[data-info]');
    if (info) {
      const kinds = [...new Set(this.issues.filter((k): k is PathIssue => !!k))];
      const warns = kinds.map((k) => (k === 'center' ? t('g403warn') : t(`issue_${k}` as TKey)));
      if (this.total > 20) warns.push(t('over20'));
      const len = tr ? ` · ${tr.length.toFixed(1)} m` : '';
      const bad = kinds.length > 0;
      info.className = `msg ${bad ? 'bad' : this.total > 20 ? 'warn' : 'ok'}`;
      info.textContent = `${t('estTime')}: ${this.total.toFixed(1)} s / 20 s${len}${warns.length ? ` · ${warns.join(' · ')}` : ''}${this.flash && performance.now() < this.flashUntil ? ` · ${this.flash}` : ''}`;
    }
  }

  /** Rumbo que lleva la trayectoria al pasar por el waypoint i. */
  private rotHeading(i: number): number {
    const w = this.cur.waypoints[i];
    const q = this.traj?.samples.find((s) => s.wp === i && Math.hypot(s.x - w.x, s.z - w.z) < 1e-6);
    return q?.heading ?? 0;
  }

  /** Huella del robot (con BUMPERS) y una marca al frente. */
  private robotBox(g: CanvasRenderingContext2D, x: number, z: number, h: number, fill: string, stroke: string): void {
    const S = this.scale;
    const [a, b] = this.toPx(x, z);
    g.save();
    g.translate(a, b);
    g.rotate(-h);
    const L = this.halfL * S;
    const W = this.halfW * S;
    g.fillStyle = fill;
    g.fillRect(-L, -W, 2 * L, 2 * W);
    g.strokeStyle = stroke;
    g.lineWidth = 2;
    g.strokeRect(-L, -W, 2 * L, 2 * W);
    g.beginPath();
    g.moveTo(L, -W * 0.5);
    g.lineTo(L + S * 0.12, 0);
    g.lineTo(L, W * 0.5);
    g.stroke();
    g.restore();
  }
}

/** Color por velocidad relativa (0 = azul, 0.5 = amarillo, 1 = rojo). */
function speedColor(f: number): string {
  const k = Math.max(0, Math.min(1, f));
  const hue = k < 0.5 ? 200 - (k / 0.5) * 150 : 50 - ((k - 0.5) / 0.5) * 45;
  return `hsl(${hue.toFixed(0)}, 90%, 55%)`;
}

const clampX = (x: number) => Math.max(-F.HALF_L + 0.45, Math.min(X1 - 0.1, x));
const clampZ = (z: number) => Math.max(-F.HALF_W + 0.45, Math.min(F.HALF_W - 0.45, z));
