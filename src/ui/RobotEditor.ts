/**
 * Editor de robots: dimensiones (perímetro ≤ 110 in, altura ≤ 30 in), drivetrain, velocidad,
 * hopper, shooter, climb, número de equipo y colores. Validación en vivo contra el manual
 * y esquema 2D (vista superior y lateral). Se guarda en localStorage.
 * CAD propio (.glb / .gltf) en IndexedDB (src/render/customCad.ts), con escala, ejes, corrimiento
 * y piezas que se mueven (turret, intake); exportar / importar el robot como archivo.
 */
import * as F from '../config/field';
import { inch } from '../config/field';
import { allRobots, DEFAULT_ROBOT_ID, fitScalePct, fitsUnderTrench, guessCadUnit, loadCustomRobots, newRobotTemplate, perimeterIn, ROBOT_PRESETS, robotById, saveCustomRobots, validateSpec, LED_MODES, PAINT_FINISHES, resolveLook, type CustomCad, type RobotSpec } from '../config/robots';
import { decodeRobotFile, encodeRobotFile, MAX_CAD_BYTES } from '../config/robotFile';
import { communityEnabled } from '../config/community';
import { loadSettings } from '../config/settings';
import { publishHubRobot } from '../net/robotHub';
import { cadNodeNames, cadSize, customModel, deleteCadFile, getCadFile, optimizeCad, parseCad, putCadFile, registerCustomModel, sceneTriangles } from '../render/customCad';
import { bind, esc, num, seg, select, type Opt } from './forms';
import { t, tx, type TKey } from './i18n';
import { backBtn, brandbar, ic } from './chrome';
import { CANVAS_FONT, FIELD_PAL } from './fieldStyle';
import type { Showroom } from '../render/Showroom';

const UNIT_OPTS: Opt[] = [
  { value: '1', label: 'm' },
  { value: '0.01', label: 'cm' },
  { value: '0.001', label: 'mm' },
  { value: '0.0254', label: 'in' },
];
const IN_PER_M = 1 / 0.0254;
/** Lo más que se acepta al importar (se aligera antes de guardarlo; ver src/render/cadOptimize.ts). */
const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;
/** Arriba de esto el CAD se aligera (archivo o triángulos). */
const OPTIMIZE_ABOVE_BYTES = 12 * 1024 * 1024;
const OPTIMIZE_ABOVE_TRIS = 400_000;
const isGlb = (b: ArrayBuffer) => new TextDecoder().decode(new Uint8Array(b, 0, Math.min(4, b.byteLength))) === 'glTF';
const round = (x: number, step: number) => Math.round(x / step) * step;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export class RobotEditor {
  private spec!: RobotSpec;

  constructor(
    private root: HTMLElement,
    private showroom: Showroom,
    private onBack: () => void,
    private onUse: (id: string) => void,
    /** Galería de la comunidad (src/ui/CommunityScreen.ts). */
    private onCommunity: () => void = () => {},
  ) {}

  open(id?: string): void {
    this.spec = id === 'new' ? newRobotTemplate() : robotById(id ?? DEFAULT_ROBOT_ID);
    this.render();
  }

  private get isPreset(): boolean {
    return ROBOT_PRESETS.some((p) => p.id === this.spec.id);
  }

  private render(): void {
    const s = this.spec;
    const ro = this.isPreset;
    const list = allRobots();
    const opts: Opt[] = list.map((r) => ({ value: r.id, label: `${ROBOT_PRESETS.some((p) => p.id === r.id) ? '🔒 ' : ''}${r.name} (${r.teamNumber})` }));
    if (!list.some((r) => r.id === s.id)) opts.push({ value: s.id, label: `${s.name} *` }); // nuevo, sin guardar
    opts.push({ value: 'new', label: `＋ ${t('newRobot')}` });
    this.root.innerHTML = `<div class="inner">
      ${brandbar('2026 REBUILT', `<button class="chipbtn" data-hub>${ic.globe}${t('hub_open')}</button>${backBtn('data-back')}`)}
      <h1>${t('robotEditor')}</h1>
      <div class="split">
        <div class="panel editprev" style="display:flex;flex-direction:column;gap:10px"><div class="preview" data-preview style="height:300px"></div><canvas data-schem style="width:100%;height:auto;display:block"></canvas><div data-valid style="display:flex;flex-direction:column;gap:4px;margin-top:8px"></div></div>
        <div class="panel form">
          <label>${t('robot')}</label>${select('pick', opts, s.id)}
          ${ro ? `<label></label><div class="msg warn">${t('presetReadonly')}</div>` : ''}
          <label>${t('routineName')}</label><input type="text" data-name value="${esc(s.name)}"/>
          <label>${t('teamNumber')}</label>${num('team', s.teamNumber, 1, 1, 99999)}
          <h3>${t('dimensions')}</h3>
          <label>${t('width')} (in)</label>${num('width', s.widthIn, 0.5, 15, 40)}
          <label>${t('length')} (in)</label>${num('length', s.lengthIn, 0.5, 15, 40)}
          <label>${t('height')} (in)</label>${num('height', s.heightIn, 0.25, 10, 34)}
          <label>${t('mass')} (kg)</label>${num('mass', s.massKg, 0.5, 30, 70)}
          <h3>${t('drivetrain')}</h3>
          <label>${t('drivetrain')}</label>${seg('drive', [{ value: 'swerve', label: 'Swerve' }, { value: 'tank', label: 'Tank / West Coast' }], s.drivetrain)}
          <label>${t('maxSpeed')} (m/s)</label>${num('speed', s.maxSpeed, 0.1, 2, 6)}
          <label>${t('maxAccel')} (m/s²)</label>${num('accel', s.maxAccel, 0.5, 4, 20)}
          <label>${t('maxOmega')} (rad/s)</label>${num('omega', s.maxOmega, 0.5, 3, 16)}
          <label>${t('traction')} (μ)</label>${num('traction', s.traction, 0.05, 0.6, 1.6)}
          <h3>INTAKE / HOPPER</h3>
          <label>${t('intakeWidth')} (in)</label>${num('iwidth', s.intake.widthIn, 0.5, 8, 40)}
          <label>${t('extension')} (in)</label>${num('iext', s.intake.extensionIn, 0.5, 0, 16)}
          <label>${t('rate')} (FUEL/s)</label>${num('irate', s.intake.rate, 0.5, 1, 32)}
          <label>${t('hopper')}</label>${num('hopper', s.hopperCapacity, 1, 8, 100)}
          <label>${t('preload')}</label>${num('preload', s.preload, 1, 0, 8)}
          <h3>SHOOTER</h3>
          <label>${t('type')}</label>${seg('stype', [{ value: 'fixed', label: t('fixed') }, { value: 'turret', label: 'Turret' }], s.shooter.type)}
          <label>${t('rate')} (FUEL/s)</label>${num('srate', s.shooter.rate, 0.5, 1, 20)}
          <label>${t('exitSpeed')} (m/s)</label>${num('sspeed', s.shooter.maxSpeed, 0.5, 6, 18)}
          <label>${t('hoodMin')} (°)</label>${num('amin', s.shooter.minAngle, 1, 10, 85)}
          <label>${t('hoodMax')} (°)</label>${num('amax', s.shooter.maxAngle, 1, 15, 88)}
          <label>${t('accuracy')} (0–1)</label>${num('acc', s.shooter.accuracy, 0.01, 0.3, 1)}
          <label>${t('exitHeight')} (in)</label>${num('exitH', s.shooter.exitHeightIn, 0.5, 8, 30)}
          <label>${t('lanes')}</label>${seg('lanes', ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v })), String(s.shooter.lanes ?? 1))}
          ${s.shooter.type === 'fixed' ? `<label>${t('shotDir')}</label>${seg('syaw', [
            { value: '0', label: t('shotFront') },
            { value: '90', label: t('shotLeft') },
            { value: '-90', label: t('shotRight') },
            { value: '180', label: t('shotBack') },
          ], String(s.shooter.yawDeg ?? 0))}` : ''}
          <label>${t('backspin')} (rad/s)</label>${num('spin', s.shooter.backspin, 5, 0, 120)}
          <h3>CLIMB</h3>
          <label>${t('maxLevel')}</label>${seg('climb', ['0', '1', '2', '3'].map((v) => ({ value: v, label: v === '0' ? '—' : `L${v}` })), String(s.climb.maxLevel))}
          <label>L1 / L2 / L3 (s)</label><div class="row trio">${num('t1', s.climb.timeL1, 0.1, 1, 15)}${num('t2', s.climb.timeL2, 0.1, 2, 20)}${num('t3', s.climb.timeL3, 0.1, 3, 25)}</div>
          <h3>${t('colors')}</h3>
          <label>${t('colors')}</label><div class="row"><input type="color" data-c1 value="${s.colors.primary}"/><input type="color" data-c2 value="${s.colors.accent}"/></div>
          ${this.lookSection()}
          ${this.cadSection()}
          <label></label><div class="row">
            <button class="chipbtn" data-saveas>${t('saveAsNew')}</button>
            ${ro ? '' : `<button class="chipbtn" data-save>${t('save')}</button><button class="chipbtn" data-del>${t('delete')}</button>`}
            <button class="chipbtn on" data-use>${t('useRobot')}</button>
          </div>
          <label></label><div class="row">
            <button class="chipbtn" data-export>${ic.download}${t('exportRobot')}</button>
            <button class="chipbtn" data-import>${ic.upload}${t('importRobot')}</button>
            <input type="file" data-robotfile accept=".json,application/json" hidden/>
            ${communityEnabled() ? `<button class="chipbtn" data-publish>${ic.globe}${t('hub_publish')}</button>` : ''}
          </div>
          <label></label><div data-filemsg></div>
        </div>
      </div></div>`;
    const r = this.root;
    this.showroom.mount(r.querySelector<HTMLElement>('[data-preview]')!, 2.6);
    r.querySelector('[data-back]')!.addEventListener('click', () => this.onBack());
    bind(r, (name, v) => {
      if (name === 'pick') {
        this.spec = v === 'new' ? newRobotTemplate() : robotById(String(v));
        this.render();
        return;
      }
      const n = Number(v);
      const sp = this.spec;
      const c = sp.customCad;
      const cad: Record<string, (c: CustomCad) => void> = {
        cunit: (c) => (c.unit = n),
        cscale: (c) => (c.scalePct = clamp(n, 1, 100000)),
        cup: (c) => (c.upAxis = v === 'z' ? 'z' : 'y'),
        cyaw: (c) => (c.yawDeg = n),
        cox: (c) => (c.offsetIn[0] = n),
        coy: (c) => (c.offsetIn[1] = n),
        coz: (c) => (c.offsetIn[2] = n),
        cturret: (c) => (c.turretNode = v ? String(v) : undefined),
        cintake: (c) => (c.intakeNode = v ? String(v) : undefined),
      };
      if (cad[name]) {
        if (c) cad[name](c);
        this.update();
        return;
      }
      const map: Record<string, () => void> = {
        team: () => (sp.teamNumber = Math.round(n)),
        width: () => (sp.widthIn = n),
        length: () => (sp.lengthIn = n),
        height: () => (sp.heightIn = n),
        mass: () => (sp.massKg = n),
        drive: () => (sp.drivetrain = v as RobotSpec['drivetrain']),
        speed: () => (sp.maxSpeed = n),
        traction: () => (sp.traction = n),
        accel: () => (sp.maxAccel = n),
        omega: () => (sp.maxOmega = n),
        lanes: () => (sp.shooter.lanes = Math.round(n)),
        syaw: () => (sp.shooter.yawDeg = n),
        spin: () => (sp.shooter.backspin = n),
        iwidth: () => (sp.intake.widthIn = n),
        iext: () => (sp.intake.extensionIn = n),
        irate: () => (sp.intake.rate = n),
        hopper: () => (sp.hopperCapacity = Math.round(n)),
        preload: () => (sp.preload = Math.round(n)),
        stype: () => (sp.shooter.type = v as RobotSpec['shooter']['type']),
        srate: () => (sp.shooter.rate = n),
        sspeed: () => (sp.shooter.maxSpeed = n),
        amin: () => (sp.shooter.minAngle = n),
        amax: () => (sp.shooter.maxAngle = n),
        acc: () => (sp.shooter.accuracy = n),
        exitH: () => (sp.shooter.exitHeightIn = n),
        climb: () => (sp.climb.maxLevel = Number(v) as 0 | 1 | 2 | 3),
        t1: () => (sp.climb.timeL1 = n),
        t2: () => (sp.climb.timeL2 = n),
        t3: () => (sp.climb.timeL3 = n),
        finish: () => (sp.look = { ...resolveLook(sp.look), finish: v as never }),
        leds: () => (sp.look = { ...resolveLook(sp.look), leds: v as never }),
        ug: () => (sp.look = { ...resolveLook(sp.look), underglow: v === 'color' ? this.ugColor() : String(v) }),
      };
      map[name]?.();
      if (name === 'stype') return this.render();
      this.update();
    });
    this.bindCad();
    r.querySelector<HTMLInputElement>('[data-name]')!.addEventListener('input', (e) => (this.spec.name = (e.target as HTMLInputElement).value));
    r.querySelector<HTMLInputElement>('[data-c1]')!.addEventListener('input', (e) => {
      this.spec.colors.primary = (e.target as HTMLInputElement).value;
      this.update();
    });
    r.querySelector<HTMLInputElement>('[data-c2]')!.addEventListener('input', (e) => {
      this.spec.colors.accent = (e.target as HTMLInputElement).value;
      this.update();
    });
    r.querySelector<HTMLInputElement>('[data-ugc]')!.addEventListener('input', (e) => {
      this.spec.look = { ...resolveLook(this.spec.look), underglow: (e.target as HTMLInputElement).value };
      r.querySelectorAll('[data-seg="ug"] button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.v === 'color'));
      this.update();
    });
    r.querySelector('[data-saveas]')!.addEventListener('click', () => {
      // Copia propia: ya no es el robot real (sin ficha de la galería), aunque conserve su modelo
      this.spec = { ...structuredClone(this.spec), id: `custom-${Date.now().toString(36)}`, name: this.isPreset ? `${this.spec.name} (mío)` : this.spec.name, real: undefined };
      this.persist();
    });
    r.querySelector('[data-save]')?.addEventListener('click', () => this.persist());
    r.querySelector('[data-del]')?.addEventListener('click', () => {
      const rest = loadCustomRobots().filter((x) => x.id !== this.spec.id);
      saveCustomRobots(rest);
      const cadId = this.spec.customCad?.id;
      if (cadId && !rest.some((x) => x.customCad?.id === cadId)) void deleteCadFile(cadId).catch(() => undefined);
      this.open(DEFAULT_ROBOT_ID);
    });
    r.querySelector('[data-use]')!.addEventListener('click', () => {
      if (validateSpec(this.spec).some((i) => i.fatal)) return;
      if (!this.isPreset) this.persist(false);
      this.onUse(this.spec.id);
    });
    requestAnimationFrame(() => this.update());
  }

  // ------------------------------------------------------------------ CAD propio

  /** Color elegido para la luz inferior (o uno por omisión si es de alianza / apagada). */
  private ugColor(): string {
    return this.root.querySelector<HTMLInputElement>('[data-ugc]')?.value ?? '#00e5ff';
  }

  /** Estética: acabado de la pintura, luz bajo el chasis y LEDs. */
  private lookSection(): string {
    const look = resolveLook(this.spec.look);
    const custom = look.underglow.startsWith('#');
    const hasCad = !!(this.spec.cad || this.spec.customCad);
    return `<h3>${t('lookTitle')}</h3>
      <label>${t('lookFinish')}</label><div>${seg('finish', PAINT_FINISHES.map((f) => ({ value: f, label: t(`finish_${f}` as TKey) })), look.finish)}${hasCad ? `<small style="display:block;margin-top:6px;font-size:12px;opacity:.7">${t('lookFinishCad')}</small>` : ''}</div>
      <label>${t('lookUnderglow')}</label><div class="row">${seg('ug', [
        { value: 'alliance', label: t('lookAlliance') },
        { value: 'color', label: t('lookCustom') },
        { value: 'off', label: t('lookOff') },
      ], custom ? 'color' : look.underglow)}<input type="color" data-ugc value="${custom ? look.underglow : '#00e5ff'}"/></div>
      <label>LEDs</label>${seg('leds', LED_MODES.map((m) => ({ value: m, label: t(`leds_${m}` as TKey) })), look.leds)}`;
  }

  private cadSection(): string {
    const s = this.spec;
    const c = s.customCad;
    const input = `<input type="file" data-cadfile accept=".glb,.gltf,model/gltf-binary,model/gltf+json" hidden/>`;
    const importBtn = `<button class="chipbtn" data-cadimport>${ic.upload}${t('cadImport')}</button>`;
    let body: string;
    if (!c) {
      body = `<label></label><div class="msg">${s.cad ? t('cadTeam') : t('cadNoModel')} ${t('cadHint')}</div>
        <label></label><div class="row">${importBtn}${input}</div>`;
    } else {
      const model = customModel(c.id);
      const nodes: Opt[] = [{ value: '', label: t('cadNone') }, ...(model ? cadNodeNames(model) : []).map((n) => ({ value: n, label: n }))];
      body = `<label></label><div class="row"><b style="overflow-wrap:anywhere">${esc(c.name)}</b>${importBtn}${input}<button class="chipbtn" data-cadrm>${t('cadRemove')}</button></div>
        ${model ? '' : `<label></label><div class="msg warn">${t('cadMissing')}</div>`}
        <label>${t('cadUnit')}</label>${seg('cunit', UNIT_OPTS, String(c.unit))}
        <label>${t('cadScale')}</label><div class="row">${num('cscale', c.scalePct, 0.5, 1, 100000)}<button class="chipbtn" data-cadfit>${t('cadFit')}</button></div>
        <label>${t('cadUp')}</label>${seg('cup', [{ value: 'y', label: 'Y (glTF)' }, { value: 'z', label: 'Z (CAD / AdvantageScope)' }], c.upAxis)}
        <label>${t('cadFront')}</label>${seg('cyaw', ['0', '90', '180', '270'].map((v) => ({ value: v, label: `${v}°` })), String(c.yawDeg))}
        <label>${t('cadOffset')}</label><div class="row trio">${num('cox', c.offsetIn[0], 0.25, -30, 30)}${num('coy', c.offsetIn[1], 0.25, -30, 30)}${num('coz', c.offsetIn[2], 0.25, -30, 30)}</div>
        <label>${t('cadTurret')}</label>${select('cturret', nodes, c.turretNode ?? '')}
        <label>${t('cadIntake')}</label>${select('cintake', nodes, c.intakeNode ?? '')}
        <label></label><div class="row"><button class="chipbtn" data-cadmeasure>${ic.ruler}${t('cadMeasure')}</button></div>`;
    }
    return `<h3>${t('cadModel')}</h3>${body}<label></label><div data-cadmsg></div>`;
  }

  private bindCad(): void {
    const r = this.root;
    const file = r.querySelector<HTMLInputElement>('[data-cadfile]');
    r.querySelector('[data-cadimport]')?.addEventListener('click', () => file?.click());
    file?.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) void this.importCad(f);
    });
    r.querySelector('[data-cadrm]')?.addEventListener('click', () => {
      delete this.spec.customCad; // el archivo se borra al arrancar si ya no lo usa nadie
      this.render();
    });
    r.querySelector('[data-cadfit]')?.addEventListener('click', () => {
      const c = this.spec.customCad;
      const m = c && customModel(c.id);
      if (!c || !m) return;
      const sz = cadSize(m, c).multiplyScalar(c.unit);
      c.scalePct = fitScalePct(sz.x, sz.z, inch(this.spec.lengthIn), inch(this.spec.widthIn));
      this.render();
    });
    r.querySelector('[data-cadmeasure]')?.addEventListener('click', () => {
      const s = this.spec;
      const c = s.customCad;
      const m = c && customModel(c.id);
      if (!c || !m) return;
      const sz = cadSize(m, c).multiplyScalar((c.unit * c.scalePct) / 100 * IN_PER_M);
      s.lengthIn = clamp(round(sz.x, 0.25), 15, 40);
      s.widthIn = clamp(round(sz.z, 0.25), 15, 40);
      s.heightIn = clamp(round(sz.y, 0.25), 10, 34);
      this.render();
    });
    const rf = r.querySelector<HTMLInputElement>('[data-robotfile]')!;
    r.querySelector('[data-import]')!.addEventListener('click', () => rf.click());
    rf.addEventListener('change', () => {
      const f = rf.files?.[0];
      if (f) void this.importRobot(f);
    });
    r.querySelector('[data-export]')!.addEventListener('click', () => void this.exportRobot());
    r.querySelector('[data-hub]')!.addEventListener('click', () => this.onCommunity());
    r.querySelector('[data-publish]')?.addEventListener('click', () => void this.publish());
  }

  private say(sel: string, cls: '' | 'ok' | 'warn' | 'bad', text: string): void {
    const el = this.root.querySelector<HTMLElement>(sel);
    if (el) el.innerHTML = `<div class="msg ${cls}">${esc(text)}</div>`;
  }

  private async importCad(f: File): Promise<void> {
    const msg = (cls: '' | 'ok' | 'warn' | 'bad', text: string) => this.say('[data-cadmsg]', cls, text);
    if (f.size > MAX_IMPORT_BYTES) return msg('bad', t('cadErrBig', { max: MAX_IMPORT_BYTES / 1024 / 1024 }));
    msg('', t('cadLoading'));
    const errMsg = (e: unknown) => {
      const code = (e as Error)?.message;
      return msg('bad', code === 'external' ? t('cadErrExternal') : code === 'draco' ? t('cadErrDraco') : t('cadErrParse', { err: String(code ?? e).slice(0, 200) }));
    };
    let buf = await f.arrayBuffer();
    const sizeIn = buf.byteLength;
    let scene: Awaited<ReturnType<typeof parseCad>> | undefined;
    let report = '';
    try {
      // Los chicos se leen tal cual; si pesan o traen demasiados triángulos, se aligeran en un worker
      if (sizeIn <= OPTIMIZE_ABOVE_BYTES) scene = await parseCad(buf);
      if (!scene || sceneTriangles(scene) > OPTIMIZE_ABOVE_TRIS) {
        if (!isGlb(buf) && /"uri"\s*:\s*"(?!data:)/.test(new TextDecoder().decode(buf))) throw new Error('external');
        const r = await optimizeCad(buf, (step) => msg('', t('cadOptimizing', { step: t(`cadStep_${step}`) })));
        buf = r.glb.buffer.slice(r.glb.byteOffset, r.glb.byteOffset + r.glb.byteLength) as ArrayBuffer;
        scene = await parseCad(buf);
        report = t('cadOptimized', {
          inMb: (sizeIn / 1024 / 1024).toFixed(1),
          outMb: (buf.byteLength / 1024 / 1024).toFixed(1),
          trisIn: r.trianglesIn.toLocaleString(),
          trisOut: r.trianglesOut.toLocaleString(),
          parts: r.removedParts,
        });
      }
    } catch (e) {
      return errMsg(e);
    }
    if (buf.byteLength > MAX_CAD_BYTES) return msg('bad', t('cadErrBig', { max: MAX_CAD_BYTES / 1024 / 1024 }));
    const id = `cad-${Date.now().toString(36)}`;
    try {
      await putCadFile(id, buf);
    } catch {
      return msg('bad', t('cadErrStore'));
    }
    registerCustomModel(id, scene);
    const s = this.spec;
    const c: CustomCad = { id, name: f.name.slice(0, 80), unit: 1, scalePct: 100, upAxis: 'y', yawDeg: 0, offsetIn: [0, 0, 0] };
    // Un modelo "acostado" con Y arriba (más alto que largo) casi seguro viene con Z arriba
    const sy = cadSize(scene, c);
    if (sy.y > 1.3 * Math.max(sy.x, sy.z)) c.upAxis = 'z';
    const sz = cadSize(scene, c);
    c.unit = guessCadUnit(Math.max(sz.x, sz.z), inch(Math.max(s.lengthIn, s.widthIn)));
    const fit = fitScalePct(sz.x * c.unit, sz.z * c.unit, inch(s.lengthIn), inch(s.widthIn));
    if (fit < 75 || fit > 133) c.scalePct = fit;
    // Piezas que se mueven, si el CAD las nombra así
    const names = cadNodeNames(scene);
    c.turretNode = names.find((n) => /turret|torreta/i.test(n));
    c.intakeNode = names.find((n) => /intake/i.test(n) && n !== c.turretNode);
    s.customCad = c;
    delete s.cad; // reemplaza al CAD del equipo (en esta copia)
    this.render();
    this.say('[data-cadmsg]', 'ok', report || t('cadLoaded', { size: (buf.byteLength / 1024 / 1024).toFixed(1) }));
  }

  private async exportRobot(): Promise<void> {
    const s = this.spec;
    const cad = s.customCad ? await getCadFile(s.customCad.id).catch(() => undefined) : undefined;
    const blob = new Blob([encodeRobotFile(s, cad)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const slug = s.name.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'robot';
    a.download = `${s.teamNumber}-${slug}.rebuilt-robot.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** Publica el robot (con su CAD) en la galería de la comunidad. Pide confirmar con un segundo clic. */
  private publishArmed = false;
  private async publish(): Promise<void> {
    const msg = (cls: '' | 'ok' | 'warn' | 'bad', text: string) => this.say('[data-filemsg]', cls, text);
    const s = this.spec;
    if (validateSpec(s).some((i) => i.fatal)) return;
    const name = loadSettings().driverName.trim();
    if (!this.publishArmed) {
      this.publishArmed = true;
      msg('warn', t('hub_publishTerms', { name: name || t('hub_anon') }));
      return;
    }
    this.publishArmed = false;
    msg('', t('hub_publishing'));
    try {
      const cad = s.customCad ? await getCadFile(s.customCad.id) : undefined;
      await publishHubRobot(s, name, cad);
      msg('ok', t('hub_published'));
    } catch (e) {
      const code = String((e as Error).message ?? e);
      msg('bad', code === 'too-big' ? t('cadErrBig', { max: 50 }) : t('hub_publishErr', { err: code.slice(0, 160) }));
    }
  }

  private async importRobot(f: File): Promise<void> {
    const msg = (cls: '' | 'ok' | 'warn' | 'bad', text: string) => this.say('[data-filemsg]', cls, text);
    let res: ReturnType<typeof decodeRobotFile>;
    try {
      res = decodeRobotFile(await f.text());
    } catch (e) {
      const code = (e as Error).message;
      return msg('bad', code === 'newer-version' ? t('robotFileNewer') : code === 'too-big' ? t('cadErrBig', { max: MAX_CAD_BYTES / 1024 / 1024 }) : t('robotFileErr'));
    }
    const { spec, cad } = res;
    if (cad && spec.customCad) {
      try {
        registerCustomModel(spec.customCad.id, await parseCad(cad));
        await putCadFile(spec.customCad.id, cad);
      } catch {
        delete spec.customCad;
      }
    }
    this.spec = spec;
    this.persist(false);
    this.render();
    this.say('[data-filemsg]', 'ok', t('robotImported', { name: spec.name }));
  }

  private persist(rerender = true): void {
    if (validateSpec(this.spec).some((i) => i.fatal)) return;
    const list = loadCustomRobots().filter((x) => x.id !== this.spec.id);
    list.push(structuredClone(this.spec));
    saveCustomRobots(list);
    if (rerender) this.render();
  }

  private update(): void {
    const s = this.spec;
    const issues = validateSpec(s);
    const v = this.root.querySelector<HTMLElement>('[data-valid]')!;
    const per = perimeterIn(s);
    const lines = [
      `<div class="msg ${per <= 110 ? 'ok' : 'bad'}">${t('perimeter')}: ${per.toFixed(1)} / 110 in (R104)</div>`,
      `<div class="msg ${fitsUnderTrench(s) ? 'ok' : 'warn'}">${fitsUnderTrench(s) ? t('fitsTrench') : t('noTrench')} (${s.heightIn} in · TRENCH 22.25 in)</div>`,
      ...issues.map((i) => `<div class="msg ${i.fatal ? 'bad' : 'warn'}">${i.rule}: ${esc(tx(i.message))}</div>`),
    ];
    if (!issues.length) lines.push(`<div class="msg ok">✓ ${t('robotLegal')}</div>`);
    v.innerHTML = lines.join('');
    // la vitrina 3D refleja los cambios (dimensiones, colores, número…)
    if (!issues.some((i) => i.fatal)) this.showroom.setRobot(s, 'blue');
    this.drawSchematic();
  }

  private drawSchematic(): void {
    const c = this.root.querySelector<HTMLCanvasElement>('[data-schem]');
    if (!c) return;
    const s = this.spec;
    const w = Math.max(280, c.clientWidth || 400);
    c.width = Math.round(w * (window.devicePixelRatio || 1));
    c.height = Math.round(c.width * 0.62);
    const g = c.getContext('2d')!;
    const P = FIELD_PAL;
    g.fillStyle = P.bg;
    g.fillRect(0, 0, c.width, c.height);
    const S = c.width / 100; // px por pulgada (vista superior ocupa ~la mitad)
    // retícula de plano cada 4 in
    g.strokeStyle = P.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x < c.width; x += 4 * S) (g.moveTo(x, 0), g.lineTo(x, c.height));
    for (let y = 0; y < c.height; y += 4 * S) (g.moveTo(0, y), g.lineTo(c.width, y));
    g.stroke();
    const bt = s.bumperIn;
    // Vista superior
    const ox = c.width * 0.27;
    const oy = c.height * 0.5;
    const L = s.lengthIn;
    const W = s.widthIn;
    g.fillStyle = P.blue;
    g.fillRect(ox - (L / 2 + bt) * S, oy - (W / 2 + bt) * S, (L + 2 * bt) * S, (W + 2 * bt) * S);
    g.fillStyle = s.colors.primary;
    g.fillRect(ox - (L / 2) * S, oy - (W / 2) * S, L * S, W * S);
    // extensión de la intake (frente = derecha), límite de 12 in (R105)
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.setLineDash([4, 4]);
    g.strokeRect(ox + (L / 2) * S, oy - (W / 2) * S, 12 * S, W * S);
    g.setLineDash([]);
    g.fillStyle = s.intake.extensionIn > 12 ? P.red : s.colors.accent;
    g.fillRect(ox + (L / 2) * S, oy - (s.intake.widthIn / 2) * S, s.intake.extensionIn * S, s.intake.widthIn * S * 0.12 + 2);
    g.fillRect(ox + (L / 2 + s.intake.extensionIn - 1) * S, oy - (s.intake.widthIn / 2) * S, 1 * S, s.intake.widthIn * S);
    // Vista lateral
    const sx = c.width * 0.62;
    const gy = c.height * 0.85;
    const HS = c.height / 40; // px por pulgada vertical
    g.strokeStyle = P.tower;
    g.beginPath();
    g.moveTo(sx - 30 * HS * 0.5, gy);
    g.lineTo(c.width - 8, gy);
    g.stroke();
    const lineY = (inch: number) => gy - inch * HS;
    const dash = (inch: number, label: string, color: string) => {
      g.strokeStyle = color;
      g.setLineDash([5, 4]);
      g.beginPath();
      g.moveTo(sx - 20, lineY(inch));
      g.lineTo(c.width - 8, lineY(inch));
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = color;
      g.font = `600 ${Math.round(HS * 1.3)}px ${CANVAS_FONT}`;
      g.fillText(label, c.width - 8 - g.measureText(label).width, lineY(inch) - 3);
    };
    const bodyW = Math.min(L * HS * 0.8, c.width - sx - 30);
    g.fillStyle = s.colors.primary;
    g.fillRect(sx, lineY(s.heightIn), bodyW, (s.heightIn - 7) * HS);
    g.fillStyle = P.blue;
    g.fillRect(sx - 6, lineY(7), bodyW + 12, 4.5 * HS);
    g.fillStyle = '#111';
    for (const k of [0.15, 0.85]) {
      g.beginPath();
      g.arc(sx + bodyW * k, gy - 2 * HS, 2 * HS, 0, Math.PI * 2);
      g.fill();
    }
    // límites encima del robot para que se lean
    dash(30, '30 in (R107)', '#ff8a83');
    dash(F.TRENCH_CLEAR_HEIGHT / F.IN, 'TRENCH 22.25 in', P.fuel);
    g.fillStyle = '#fff';
    g.font = `700 ${Math.round(S * 3)}px ${CANVAS_FONT}`;
    g.fillText(String(s.teamNumber), ox - S * 6, oy + S * 1);
  }
}
