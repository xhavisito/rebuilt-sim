/**
 * Robot visual generado a partir de `RobotSpec`. Ejes locales: +X adelante (lado intake),
 * +Y arriba, origen en el piso al centro. Diseños inventados (no copian equipos reales).
 */
import * as THREE from 'three';
import { BUMPER_ZONE_LOW, FUEL_RADIUS, inch } from '../config/field';
import type { RobotSpec } from '../config/robots';
import type { Alliance } from '../core/types';
import { ALLIANCE_COLOR } from './FieldView';
import { mergeStaticChildren } from './merge';
import { textTexture } from './textures';

export interface RobotVisualState {
  intakeDeploy: number; // 0–1
  turretYaw: number; // rad relativo al robot
  hoodAngle: number; // rad sobre la horizontal
  climbHeight: number; // m de extensión del climber
  hopper: number; // FUEL dentro
  enabled: boolean;
  wheelYaw: number; // rad (swerve)
  wheelSpin: number; // rad acumulados
  intakeSpin: number;
  flywheelSpin: number;
}

const BUMPER_TOP = inch(7.0);
const MAX_SHOWN = 60;

export class RobotView {
  readonly group = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private wheelSpinners: THREE.Object3D[] = [];
  private intake = new THREE.Group();
  private intakeRoller!: THREE.Mesh;
  private turret = new THREE.Group();
  private hood = new THREE.Group();
  private flywheel!: THREE.Mesh;
  private climber = new THREE.Group();
  private climberInner!: THREE.Mesh;
  private hopperBalls: THREE.InstancedMesh;
  private hopperSlots: THREE.Vector3[] = [];
  private rsl: THREE.MeshStandardMaterial;
  private hl: number;
  private extension: number;
  /** Indicador (anillo) sobre el robot del jugador. */
  readonly marker: THREE.Mesh;

  constructor(
    readonly spec: RobotSpec,
    readonly alliance: Alliance,
  ) {
    const hl = (this.hl = inch(spec.lengthIn) / 2);
    const hw = inch(spec.widthIn) / 2;
    const bt = inch(spec.bumperIn);
    const H = inch(spec.heightIn);
    this.extension = inch(spec.intake.extensionIn);
    const primary = new THREE.MeshStandardMaterial({ color: spec.colors.primary, metalness: 0.55, roughness: 0.45 });
    const accent = new THREE.MeshStandardMaterial({ color: spec.colors.accent, metalness: 0.3, roughness: 0.5 });
    const alu = new THREE.MeshStandardMaterial({ color: 0xb8bcc3, metalness: 0.8, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 0.7 });
    const poly = new THREE.MeshStandardMaterial({
      color: 0xcfe3ff,
      transparent: true,
      opacity: 0.22,
      roughness: 0.08,
      depthWrite: false,
    });
    const g = this.group;
    const add = (m: THREE.Object3D, parent: THREE.Object3D = g) => {
      m.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      parent.add(m);
      return m;
    };
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      return m;
    };

    // ---- BUMPERS (tela del color de alianza + número de equipo, R4xx)
    const bh = BUMPER_TOP - BUMPER_ZONE_LOW;
    const by = BUMPER_ZONE_LOW + bh / 2;
    const bumperMat = new THREE.MeshStandardMaterial({ color: ALLIANCE_COLOR[this.alliance], roughness: 0.85 });
    const numTex = textTexture(String(spec.teamNumber), {
      w: 256,
      h: 64,
      bg: '#' + ALLIANCE_COLOR[this.alliance].toString(16).padStart(6, '0'),
      fg: '#ffffff',
    });
    const sideMat = new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.85 });
    // laterales con número (caras ±Z)
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2 * (hl + bt), bh, bt), [
        bumperMat,
        bumperMat,
        bumperMat,
        bumperMat,
        s > 0 ? sideMat : bumperMat,
        s < 0 ? sideMat : bumperMat,
      ]);
      m.position.set(0, by, s * (hw + bt / 2));
      add(m);
    }
    // frente y atrás
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bt, bh, 2 * hw), [
        s > 0 ? sideMat : bumperMat,
        s < 0 ? sideMat : bumperMat,
        bumperMat,
        bumperMat,
        bumperMat,
        bumperMat,
      ]);
      m.position.set(s * (hl + bt / 2), by, 0);
      add(m);
    }

    // ---- Chasis: belly pan + marco de tubo
    add(box(2 * hl - 0.02, 0.01, 2 * hw - 0.02, dark, 0, inch(2.6), 0));
    for (const s of [-1, 1]) {
      add(box(2 * hl, inch(1), inch(1), alu, 0, BUMPER_TOP - inch(0.5), s * (hw - inch(0.5))));
      add(box(inch(1), inch(1), 2 * hw, alu, s * (hl - inch(0.5)), BUMPER_TOP - inch(0.5), 0));
    }

    // ---- Módulos swerve / ruedas
    const wheelR = inch(2);
    const wx = hl - inch(3);
    const wz = hw - inch(3);
    const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, inch(1.5), 18);
    wheelGeo.rotateX(Math.PI / 2);
    const tread = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    for (const [x, z] of [
      [wx, wz],
      [wx, -wz],
      [-wx, wz],
      [-wx, -wz],
    ]) {
      const mod = new THREE.Group();
      mod.position.set(x, 0, z);
      const housing = box(inch(4.2), inch(3), inch(4.2), spec.drivetrain === 'swerve' ? accent : dark, 0, inch(5.5), 0);
      add(housing, mod);
      const steer = new THREE.Group();
      mod.add(steer);
      const wheel = new THREE.Mesh(wheelGeo, tread);
      wheel.position.y = wheelR;
      add(wheel, steer);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(inch(1), inch(1), inch(1.6), 10).rotateX(Math.PI / 2), alu);
      hub.position.y = wheelR;
      steer.add(hub);
      this.wheels.push(steer);
      this.wheelSpinners.push(wheel);
      g.add(mod);
    }

    // ---- Hopper (caja con policarbonato; FUEL visible adentro)
    const hopH = Math.max(0.12, H - BUMPER_TOP - inch(4));
    const hopW = 2 * hw - inch(3);
    const hopL = 2 * hl - inch(7);
    const hopY = BUMPER_TOP + inch(0.5);
    // postes
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) add(box(inch(1), hopH, inch(1), primary, (sx * hopL) / 2 - inch(1.5), hopY + hopH / 2, (sz * hopW) / 2));
    add(box(hopL, inch(0.25), hopW, primary, -inch(1.5), hopY, 0));
    const walls = new THREE.Mesh(new THREE.BoxGeometry(hopL, hopH, hopW), poly);
    walls.position.set(-inch(1.5), hopY + hopH / 2, 0);
    walls.renderOrder = 3;
    g.add(walls);
    // Franjas de acento
    add(box(hopL + 0.01, inch(1), hopW + 0.01, accent, -inch(1.5), hopY + hopH, 0));
    // Slots de FUEL dentro del hopper (rejilla)
    const d = FUEL_RADIUS * 2;
    const nx = Math.max(1, Math.floor((hopL - 0.02) / d));
    const nz = Math.max(1, Math.floor((hopW - 0.02) / d));
    const ny = Math.max(1, Math.floor(hopH / (d * 0.85)));
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++)
        for (let z = 0; z < nz; z++) {
          if (this.hopperSlots.length >= MAX_SHOWN) break;
          this.hopperSlots.push(
            new THREE.Vector3(
              -inch(1.5) + (x - (nx - 1) / 2) * d + (y % 2 ? d * 0.25 : 0),
              hopY + FUEL_RADIUS + 0.005 + y * d * 0.85,
              (z - (nz - 1) / 2) * d + (y % 2 ? d * 0.25 : 0),
            ),
          );
        }
    this.hopperBalls = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(FUEL_RADIUS * 0.98, 1),
      new THREE.MeshStandardMaterial({ color: 0xf4c20d, roughness: 0.9 }),
      this.hopperSlots.length,
    );
    this.hopperBalls.count = 0;
    const m4 = new THREE.Matrix4();
    this.hopperSlots.forEach((p, i) => this.hopperBalls.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
    this.hopperBalls.frustumCulled = false;
    g.add(this.hopperBalls);

    // ---- Intake (rodillo de piso que se despliega hacia +X)
    const iw = Math.min(inch(spec.intake.widthIn), 2 * hw);
    this.intake.position.set(hl, 0, 0);
    for (const s of [-1, 1]) add(box(inch(1), inch(1), inch(1), alu, 0, inch(4), (s * iw) / 2), this.intake);
    this.intakeRoller = new THREE.Mesh(new THREE.CylinderGeometry(inch(1.25), inch(1.25), iw, 12).rotateX(Math.PI / 2), accent);
    this.intakeRoller.position.set(0, inch(3), 0);
    add(this.intakeRoller, this.intake);
    const arm = box(inch(1), inch(1), iw, alu, 0, inch(5.5), 0);
    add(arm, this.intake);
    g.add(this.intake);

    // ---- Shooter (fijo o turret)
    const shooterY = inch(spec.shooter.exitHeightIn) - inch(4);
    this.turret.position.set(spec.shooter.type === 'turret' ? 0 : -hl + inch(5), Math.min(shooterY, H - inch(6)), 0);
    if (spec.shooter.type === 'turret') {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(inch(6), inch(6), inch(1.5), 24), dark);
      add(ring, this.turret);
    }
    const body = box(inch(9), inch(5), inch(9), primary, 0, inch(3), 0);
    add(body, this.turret);
    this.hood.position.set(inch(3), inch(5.5), 0);
    const hoodPlate = box(inch(8), inch(0.5), inch(8), accent, inch(3), 0, 0);
    add(hoodPlate, this.hood);
    this.turret.add(this.hood);
    this.flywheel = new THREE.Mesh(new THREE.CylinderGeometry(inch(2), inch(2), inch(7), 16).rotateX(Math.PI / 2), alu);
    this.flywheel.position.set(0, inch(5), 0);
    add(this.flywheel, this.turret);
    g.add(this.turret);

    // ---- Climber (tubo telescópico)
    if (spec.climb.maxLevel > 0) {
      this.climber.position.set(-hl + inch(3), BUMPER_TOP, 0);
      const outer = box(inch(1.5), H - BUMPER_TOP - inch(1), inch(1.5), alu, 0, (H - BUMPER_TOP - inch(1)) / 2, 0);
      add(outer, this.climber);
      this.climberInner = box(inch(1.1), H - BUMPER_TOP - inch(1), inch(1.1), accent, 0, (H - BUMPER_TOP - inch(1)) / 2, 0);
      add(this.climberInner, this.climber);
      const hook = box(inch(3), inch(1), inch(3), dark, inch(1), 0, 0);
      hook.name = 'hook';
      this.climberInner.add(hook);
      hook.position.y = (H - BUMPER_TOP - inch(1)) / 2;
      g.add(this.climber);
    }

    // ---- RSL (luz naranja de estado)
    this.rsl = new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xff7a00, emissiveIntensity: 0 });
    const rslMesh = new THREE.Mesh(new THREE.BoxGeometry(inch(2), inch(1.5), inch(1.5)), this.rsl);
    rslMesh.position.set(-hl + inch(1), H - inch(1.5), hw - inch(2));
    g.add(rslMesh);

    // ---- Marcador del jugador (anillo en el piso)
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(Math.hypot(hl + bt, hw + bt) + 0.05, Math.hypot(hl + bt, hw + bt) + 0.1, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.01;
    this.marker.visible = false;
    g.add(this.marker);
    mergeStaticChildren(g, new Set([this.marker, this.hopperBalls, rslMesh]));
    // Solo el cuerpo fusionado proyecta sombra (las piezas móviles chicas no: ahorra draw calls)
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.parent !== g) o.castShadow = false;
    });
  }

  /** Altura de salida del shooter en coordenadas locales (para alinear el disparo). */
  shooterLocal(): THREE.Vector3 {
    return new THREE.Vector3(this.turret.position.x, inch(this.spec.shooter.exitHeightIn), 0);
  }

  update(s: RobotVisualState, time: number): void {
    // Intake: se desliza hacia adelante hasta la extensión de diseño
    this.intake.position.x = this.hl + this.extension * s.intakeDeploy - inch(1) * (1 - s.intakeDeploy);
    this.intakeRoller.rotation.z = s.intakeSpin;
    this.turret.rotation.y = s.turretYaw;
    this.hood.rotation.z = Math.max(0, s.hoodAngle - Math.PI / 4) * 0.6;
    this.flywheel.rotation.z = s.flywheelSpin;
    if (this.climberInner) this.climberInner.position.y = (inch(this.spec.heightIn) - BUMPER_TOP - inch(1)) / 2 + s.climbHeight;
    for (const w of this.wheels) w.rotation.y = this.spec.drivetrain === 'swerve' ? s.wheelYaw : 0;
    for (const w of this.wheelSpinners) w.rotation.z = -s.wheelSpin;
    const n = Math.min(s.hopper, this.hopperSlots.length);
    if (this.hopperBalls.count !== n) this.hopperBalls.count = n;
    // RSL: parpadea cuando está habilitado
    this.rsl.emissiveIntensity = s.enabled ? (Math.floor(time * 2.5) % 2 ? 3 : 0.3) : 2;
  }
}
