/**
 * Editor de robots: dimensiones (perímetro ≤ 110 in, altura ≤ 30 in), drivetrain, velocidad,
 * hopper, shooter, climb, número de equipo y colores. Validación en vivo contra el manual
 * y esquema 2D (vista superior y lateral). Se guarda en localStorage.
 */
import * as F from '../config/field';
import { allRobots, DEFAULT_ROBOT_ID, fitsUnderTrench, loadCustomRobots, newRobotTemplate, perimeterIn, ROBOT_PRESETS, robotById, saveCustomRobots, validateSpec, type RobotSpec } from '../config/robots';
import { bind, esc, num, seg, select, type Opt } from './forms';
import { t, tx } from './i18n';
import type { Showroom } from '../render/Showroom';

export class RobotEditor {
  private spec!: RobotSpec;

  constructor(
    private root: HTMLElement,
    private showroom: Showroom,
    private onBack: () => void,
    private onUse: (id: string) => void,
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
      <div class="brandbar"><div class="brand">REBUILT <span>SIM</span></div><div class="ctx">2026 REBUILT</div><div class="grow"></div><button class="chipbtn" data-back>← ${t('back')}</button></div>
      <h1>${t('robotEditor')}</h1>
      <div class="split">
        <div class="panel" style="display:flex;flex-direction:column;gap:10px"><div class="preview" data-preview style="height:300px"></div><canvas data-schem style="width:100%;height:auto;display:block"></canvas><div data-valid style="display:flex;flex-direction:column;gap:4px;margin-top:8px"></div></div>
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
          <label>${t('traction')} (μ)</label>${num('traction', s.traction, 0.05, 0.6, 1.6)}
          <h3>INTAKE / HOPPER</h3>
          <label>${t('intakeWidth')} (in)</label>${num('iwidth', s.intake.widthIn, 0.5, 8, 40)}
          <label>${t('extension')} (in)</label>${num('iext', s.intake.extensionIn, 0.5, 0, 16)}
          <label>${t('rate')} (FUEL/s)</label>${num('irate', s.intake.rate, 0.5, 1, 20)}
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
          <h3>CLIMB</h3>
          <label>${t('maxLevel')}</label>${seg('climb', ['0', '1', '2', '3'].map((v) => ({ value: v, label: v === '0' ? '—' : `L${v}` })), String(s.climb.maxLevel))}
          <label>L1 / L2 / L3 (s)</label><div class="row">${num('t1', s.climb.timeL1, 0.1, 1, 15)}${num('t2', s.climb.timeL2, 0.1, 2, 20)}${num('t3', s.climb.timeL3, 0.1, 3, 25)}</div>
          <h3>${t('colors')}</h3>
          <label>${t('colors')}</label><div class="row"><input type="color" data-c1 value="${s.colors.primary}"/><input type="color" data-c2 value="${s.colors.accent}"/></div>
          <label></label><div class="row">
            <button class="chipbtn" data-saveas>${t('saveAsNew')}</button>
            ${ro ? '' : `<button class="chipbtn" data-save>${t('save')}</button><button class="chipbtn" data-del>${t('delete')}</button>`}
            <button class="chipbtn on" data-use>${t('useRobot')}</button>
          </div>
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
      const map: Record<string, () => void> = {
        team: () => (sp.teamNumber = Math.round(n)),
        width: () => (sp.widthIn = n),
        length: () => (sp.lengthIn = n),
        height: () => (sp.heightIn = n),
        mass: () => (sp.massKg = n),
        drive: () => (sp.drivetrain = v as RobotSpec['drivetrain']),
        speed: () => (sp.maxSpeed = n),
        traction: () => (sp.traction = n),
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
      };
      map[name]?.();
      this.update();
    });
    r.querySelector<HTMLInputElement>('[data-name]')!.addEventListener('input', (e) => (this.spec.name = (e.target as HTMLInputElement).value));
    r.querySelector<HTMLInputElement>('[data-c1]')!.addEventListener('input', (e) => {
      this.spec.colors.primary = (e.target as HTMLInputElement).value;
      this.update();
    });
    r.querySelector<HTMLInputElement>('[data-c2]')!.addEventListener('input', (e) => {
      this.spec.colors.accent = (e.target as HTMLInputElement).value;
      this.update();
    });
    r.querySelector('[data-saveas]')!.addEventListener('click', () => {
      // Copia propia: ya no es el robot real (sin ficha de la galería), aunque conserve su modelo
      this.spec = { ...structuredClone(this.spec), id: `custom-${Date.now().toString(36)}`, name: this.isPreset ? `${this.spec.name} (mío)` : this.spec.name, real: undefined };
      this.persist();
    });
    r.querySelector('[data-save]')?.addEventListener('click', () => this.persist());
    r.querySelector('[data-del]')?.addEventListener('click', () => {
      saveCustomRobots(loadCustomRobots().filter((x) => x.id !== this.spec.id));
      this.open(DEFAULT_ROBOT_ID);
    });
    r.querySelector('[data-use]')!.addEventListener('click', () => {
      if (validateSpec(this.spec).some((i) => i.fatal)) return;
      if (!this.isPreset) this.persist(false);
      this.onUse(this.spec.id);
    });
    requestAnimationFrame(() => this.update());
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
    g.fillStyle = '#111216';
    g.fillRect(0, 0, c.width, c.height);
    const S = c.width / 100; // px por pulgada (vista superior ocupa ~la mitad)
    const bt = s.bumperIn;
    // Vista superior
    const ox = c.width * 0.27;
    const oy = c.height * 0.5;
    const L = s.lengthIn;
    const W = s.widthIn;
    g.fillStyle = '#1e88e5';
    g.fillRect(ox - (L / 2 + bt) * S, oy - (W / 2 + bt) * S, (L + 2 * bt) * S, (W + 2 * bt) * S);
    g.fillStyle = s.colors.primary;
    g.fillRect(ox - (L / 2) * S, oy - (W / 2) * S, L * S, W * S);
    // extensión de la intake (frente = derecha), límite de 12 in (R105)
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.setLineDash([4, 4]);
    g.strokeRect(ox + (L / 2) * S, oy - (W / 2) * S, 12 * S, W * S);
    g.setLineDash([]);
    g.fillStyle = s.intake.extensionIn > 12 ? '#e53935' : s.colors.accent;
    g.fillRect(ox + (L / 2) * S, oy - (s.intake.widthIn / 2) * S, s.intake.extensionIn * S, s.intake.widthIn * S * 0.12 + 2);
    g.fillRect(ox + (L / 2 + s.intake.extensionIn - 1) * S, oy - (s.intake.widthIn / 2) * S, 1 * S, s.intake.widthIn * S);
    // Vista lateral
    const sx = c.width * 0.62;
    const gy = c.height * 0.85;
    const HS = c.height / 40; // px por pulgada vertical
    g.strokeStyle = '#9aa6b8';
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
      g.font = `${Math.round(HS * 1.3)}px sans-serif`;
      g.fillText(label, c.width - 8 - g.measureText(label).width, lineY(inch) - 3);
    };
    const bodyW = Math.min(L * HS * 0.8, c.width - sx - 30);
    g.fillStyle = s.colors.primary;
    g.fillRect(sx, lineY(s.heightIn), bodyW, (s.heightIn - 7) * HS);
    g.fillStyle = '#1e88e5';
    g.fillRect(sx - 6, lineY(7), bodyW + 12, 4.5 * HS);
    g.fillStyle = '#111';
    for (const k of [0.15, 0.85]) {
      g.beginPath();
      g.arc(sx + bodyW * k, gy - 2 * HS, 2 * HS, 0, Math.PI * 2);
      g.fill();
    }
    // límites encima del robot para que se lean
    dash(30, '30 in (R107)', '#e57373');
    dash(F.TRENCH_CLEAR_HEIGHT / F.IN, 'TRENCH 22.25 in', '#ffd54f');
    g.fillStyle = '#fff';
    g.font = `bold ${Math.round(S * 3)}px sans-serif`;
    g.fillText(String(s.teamNumber), ox - S * 6, oy + S * 1);
  }
}
