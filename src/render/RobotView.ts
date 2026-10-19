/**
 * Robot visual generado a partir de `RobotSpec`, con aspecto de robot real de FRC:
 * chasis de tubo de aluminio, módulos swerve con motores, BUMPERS con número de equipo,
 * hopper de policarbonato con marco, intake sobre los BUMPERS con rodillos (pivota al
 * desplegarse), shooter con placas laterales, flywheels y hood curvo, electrónica,
 * batería y RSL. Ejes locales: +X adelante (lado intake), +Y arriba, origen en el piso.
 * Diseños inventados (no copian equipos reales).
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
const MAX_SHOWN = 48;

/** Materiales compartidos entre robots (menos programas/estados de GPU). */
const SHARED = (() => {
  const m = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  return {
    alu: m({ color: 0xc3c7cd, metalness: 0.75, roughness: 0.32 }),
    aluDark: m({ color: 0x5d636c, metalness: 0.7, roughness: 0.4 }),
    black: m({ color: 0x121316, metalness: 0.2, roughness: 0.55 }),
    tread: m({ color: 0x0c0c0d, roughness: 0.95 }),
    motor: m({ color: 0x1b1c1f, metalness: 0.5, roughness: 0.35 }),
    motorCap: m({ color: 0x8b9099, metalness: 0.8, roughness: 0.3 }),
    poly: m({ color: 0xd6e4f2, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0, depthWrite: false }),
    pcb: m({ color: 0x1f6b3a, roughness: 0.6 }),
    battery: m({ color: 0x18181b, roughness: 0.5 }),
    wireRed: m({ color: 0xc62828, roughness: 0.5 }),
    wireBlack: m({ color: 0x222222, roughness: 0.5 }),
    orange: m({ color: 0xff7a00, roughness: 0.5 }),
    white: m({ color: 0xe8e8e8, roughness: 0.6 }),
    fuel: m({ color: 0xf4c20d, roughness: 0.9 }),
  };
})();

export class RobotView {
  readonly group = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private wheelSpinners: THREE.Object3D[] = [];
  private intake = new THREE.Group();
  private intakeRollers: THREE.Mesh[] = [];
  private turret = new THREE.Group();
  private hood = new THREE.Group();
  private flywheels: THREE.Mesh[] = [];
  private climber = new THREE.Group();
  private climberInner: THREE.Group | null = null;
  private hopperBalls: THREE.InstancedMesh;
  private hopperSlots: THREE.Vector3[] = [];
  private rsl: THREE.MeshStandardMaterial;
  private led: THREE.MeshStandardMaterial;
  private stowAngle: number;
  private deployAngle: number;
  /** Indicador (anillo) sobre el robot del jugador. */
  readonly marker: THREE.Mesh;

  constructor(
    readonly spec: RobotSpec,
    readonly alliance: Alliance,
  ) {
    const hl = inch(spec.lengthIn) / 2;
    const hw = inch(spec.widthIn) / 2;
    const bt = inch(spec.bumperIn);
    const H = inch(spec.heightIn);
    const S = SHARED;
    const primary = new THREE.MeshStandardMaterial({ color: spec.colors.primary, metalness: 0.6, roughness: 0.38 });
    const accent = new THREE.MeshStandardMaterial({ color: spec.colors.accent, metalness: 0.35, roughness: 0.45 });
    const g = this.group;
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const cyl = (r: number, len: number, mat: THREE.Material, axis: 'x' | 'y' | 'z', x: number, y: number, z: number, parent: THREE.Object3D = g, seg = 16) => {
      const geo = new THREE.CylinderGeometry(r, r, len, seg);
      if (axis === 'x') geo.rotateZ(Math.PI / 2);
      if (axis === 'z') geo.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // ---- BUMPERS: tela del color de alianza con el número en las 4 caras exteriores
    const bh = BUMPER_TOP - BUMPER_ZONE_LOW;
    const by = BUMPER_ZONE_LOW + bh / 2;
    const numTex = textTexture(String(spec.teamNumber), {
      w: 512,
      h: 128,
      bg: '#' + ALLIANCE_COLOR[alliance].toString(16).padStart(6, '0'),
      fg: '#ffffff',
      font: `bold 104px "Anton", "Arial Black", Arial, sans-serif`,
    });
    const fabric = new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.92 });
    const bumperBox = (w: number, d: number, x: number, z: number, outwardFace: number) => {
      const geo = new THREE.BoxGeometry(w, bh, d);
      const uv = geo.getAttribute('uv');
      // solo la cara exterior lleva número; las demás toman un píxel del fondo
      for (let f = 0; f < 6; f++) if (f !== outwardFace) for (let k = 0; k < 4; k++) uv.setXY(f * 4 + k, 0.01, 0.5);
      const m = new THREE.Mesh(geo, fabric);
      m.position.set(x, by, z);
      m.castShadow = true;
      g.add(m);
    };
    for (const s of [-1, 1]) bumperBox(2 * (hl + bt), bt, 0, s * (hw + bt / 2), s > 0 ? 4 : 5);
    for (const s of [-1, 1]) bumperBox(bt, 2 * hw, s * (hl + bt / 2), 0, s > 0 ? 0 : 1);
    // canal de soporte (madera/aluminio) arriba de los BUMPERS
    for (const s of [-1, 1]) {
      box(2 * (hl + bt), inch(0.6), inch(0.9), S.black, 0, BUMPER_TOP + inch(0.3), s * (hw + bt * 0.35));
      box(inch(0.9), inch(0.6), 2 * hw, S.black, s * (hl + bt * 0.35), BUMPER_TOP + inch(0.3), 0);
    }

    // ---- Chasis: belly pan y tubo 2×1 en el perímetro + travesaños
    box(2 * hl - inch(1), inch(0.25), 2 * hw - inch(1), S.aluDark, 0, inch(2.2), 0);
    const tubeY = BUMPER_TOP - inch(1.1);
    for (const s of [-1, 1]) {
      box(2 * hl, inch(2), inch(1), S.alu, 0, tubeY, s * (hw - inch(0.5)));
      box(inch(1), inch(2), 2 * hw - inch(2), S.alu, s * (hl - inch(0.5)), tubeY, 0);
    }
    box(inch(1), inch(1), 2 * hw - inch(2), S.alu, inch(4), tubeY + inch(0.5), 0);
    box(inch(1), inch(1), 2 * hw - inch(2), S.alu, -inch(6), tubeY + inch(0.5), 0);

    // ---- Módulos swerve (o ruedas de tank) en las esquinas
    const wheelR = inch(2);
    const mx = hl - inch(3.6);
    const mz = hw - inch(3.6);
    const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, inch(1.5), 22);
    wheelGeo.rotateX(Math.PI / 2);
    for (const [x, z] of [
      [mx, mz],
      [mx, -mz],
      [-mx, mz],
      [-mx, -mz],
    ]) {
      const swerve = spec.drivetrain === 'swerve';
      // placa superior del módulo + dos motores verticales (estáticos respecto al chasis)
      box(inch(5), inch(0.4), inch(5), swerve ? accent : S.aluDark, x, BUMPER_TOP + inch(0.6), z);
      cyl(inch(1.2), inch(3), S.motor, 'y', x - inch(1.2), BUMPER_TOP + inch(2.3), z + inch(1.1));
      cyl(inch(1.21), inch(0.5), S.motorCap, 'y', x - inch(1.2), BUMPER_TOP + inch(3.9), z + inch(1.1));
      if (swerve) {
        cyl(inch(1.2), inch(2.4), S.motor, 'y', x + inch(1.2), BUMPER_TOP + inch(2.0), z - inch(1.1));
        cyl(inch(1.21), inch(0.5), S.motorCap, 'y', x + inch(1.2), BUMPER_TOP + inch(3.3), z - inch(1.1));
      }
      const mod = new THREE.Group();
      mod.position.set(x, 0, z);
      const steer = new THREE.Group();
      mod.add(steer);
      const wheel = new THREE.Mesh(wheelGeo, S.tread);
      wheel.position.y = wheelR;
      wheel.castShadow = true;
      steer.add(wheel);
      cyl(inch(1.1), inch(1.6), S.alu, 'z', 0, wheelR, 0, wheel, 12);
      if (swerve) {
        box(inch(0.4), inch(3.2), inch(3.6), S.aluDark, 0, wheelR + inch(1.2), inch(1.05), steer);
        box(inch(0.4), inch(3.2), inch(3.6), S.aluDark, 0, wheelR + inch(1.2), -inch(1.05), steer).rotation.y = 0;
      }
      this.wheels.push(steer);
      this.wheelSpinners.push(wheel);
      g.add(mod);
    }

    // ---- Electrónica: controlador, PDH, radio, batería y cables
    const ey = BUMPER_TOP + inch(0.5);
    box(inch(5.5), inch(1), inch(3.6), S.white, inch(1.5), ey, -hw + inch(5.5));
    box(inch(4.6), inch(0.2), inch(3), S.pcb, inch(1.5), ey + inch(0.6), -hw + inch(5.5));
    box(inch(4), inch(1.2), inch(3), S.black, -inch(4.5), ey, hw - inch(5.5));
    box(inch(1.5), inch(0.6), inch(0.9), S.orange, -inch(4.5), ey + inch(0.9), hw - inch(5.8));
    box(inch(3), inch(1), inch(2), S.white, inch(5), ey, hw - inch(4.5));
    const batt = box(inch(6.6), inch(6.2), inch(3), S.battery, -hl + inch(5), BUMPER_TOP + inch(3.1), 0);
    batt.rotation.y = 0;
    cyl(inch(0.18), inch(9), S.wireRed, 'x', -hl + inch(9), BUMPER_TOP + inch(5.8), inch(0.6));
    cyl(inch(0.18), inch(9), S.wireBlack, 'x', -hl + inch(9), BUMPER_TOP + inch(5.8), -inch(0.6));
    cyl(inch(0.12), 2 * hw - inch(8), S.wireRed, 'z', inch(1.5), ey + inch(0.9), 0);
    cyl(inch(0.12), 2 * hw - inch(8), S.wireBlack, 'z', inch(2.2), ey + inch(0.9), 0);

    // ---- Hopper: marco de tubo + paneles de policarbonato; FUEL visible adentro
    const hopX0 = -hl + inch(9);
    const hopX1 = hl - inch(4);
    const hopL = hopX1 - hopX0;
    const hopCx = (hopX0 + hopX1) / 2;
    const hopW = 2 * hw - inch(5);
    const hopY0 = BUMPER_TOP + inch(1.5);
    const hopH = Math.max(0.14, H - hopY0 - inch(6));
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) box(inch(1), hopH, inch(1), primary, hopCx + (sx * hopL) / 2, hopY0 + hopH / 2, (sz * hopW) / 2);
    for (const sz of [-1, 1]) {
      box(hopL + inch(1), inch(1), inch(1), primary, hopCx, hopY0 + hopH, (sz * hopW) / 2);
      box(hopL + inch(1), inch(0.6), inch(0.6), primary, hopCx, hopY0 + hopH * 0.5, (sz * hopW) / 2);
    }
    for (const sx of [-1, 1]) box(inch(1), inch(1), hopW + inch(1), primary, hopCx + (sx * hopL) / 2, hopY0 + hopH, 0);
    box(hopL, inch(0.25), hopW, S.aluDark, hopCx, hopY0, 0);
    const walls = new THREE.Mesh(new THREE.BoxGeometry(hopL, hopH, hopW), S.poly);
    walls.position.set(hopCx, hopY0 + hopH / 2, 0);
    walls.renderOrder = 3;
    g.add(walls);
    // Tira de LEDs (brilla con el bloom) en el color de alianza
    this.led = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: ALLIANCE_COLOR[alliance], emissiveIntensity: 2.2 });
    for (const sz of [-1, 1]) box(hopL * 0.8, inch(0.35), inch(0.35), this.led, hopCx, hopY0 + hopH + inch(0.7), (sz * hopW) / 2);
    // Slots de FUEL dentro del hopper
    const d = FUEL_RADIUS * 2;
    const nx = Math.max(1, Math.floor((hopL - inch(1)) / d));
    const nz = Math.max(1, Math.floor((hopW - inch(1)) / d));
    const ny = Math.max(1, Math.floor(hopH / (d * 0.86)));
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++)
        for (let z = 0; z < nz; z++) {
          if (this.hopperSlots.length >= MAX_SHOWN) break;
          this.hopperSlots.push(
            new THREE.Vector3(
              hopCx + (x - (nx - 1) / 2) * d + (y % 2 ? d * 0.25 : 0),
              hopY0 + FUEL_RADIUS + 0.004 + y * d * 0.86,
              (z - (nz - 1) / 2) * d + (y % 2 ? d * 0.25 : 0),
            ),
          );
        }
    this.hopperBalls = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(FUEL_RADIUS * 0.97, 1), S.fuel, Math.max(1, this.hopperSlots.length));
    this.hopperBalls.count = 0;
    const m4 = new THREE.Matrix4();
    this.hopperSlots.forEach((p, i) => this.hopperBalls.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
    this.hopperBalls.frustumCulled = false;
    this.hopperBalls.castShadow = true;
    g.add(this.hopperBalls);

    // ---- Intake sobre los BUMPERS: pivota desde arriba del frente del chasis
    const ext = inch(spec.intake.extensionIn);
    const iw = Math.min(inch(spec.intake.widthIn), 2 * hw);
    const pivotY = BUMPER_TOP + inch(5);
    const reachX = ext + inch(1);
    const dropY = pivotY - inch(2.2);
    const armLen = Math.hypot(reachX, dropY);
    this.deployAngle = -Math.atan2(dropY, reachX); // hacia adelante y abajo
    this.stowAngle = Math.PI * 0.42; // casi vertical, dentro del perímetro
    this.intake.position.set(hl - inch(1.5), pivotY, 0);
    const arm = new THREE.Group();
    this.intake.add(arm);
    for (const s of [-1, 1]) {
      const plate = box(armLen + inch(1), inch(3), inch(0.25), primary, armLen / 2, 0, (s * iw) / 2, arm);
      plate.castShadow = true;
    }
    box(inch(1), inch(1), iw, S.alu, armLen * 0.55, inch(1.6), 0, arm);
    // rodillos: uno compliant del color de acento al frente y uno negro atrás
    const r1 = cyl(inch(1.3), iw - inch(0.6), accent, 'z', armLen, 0, 0, arm, 14);
    const r2 = cyl(inch(1.0), iw - inch(0.6), S.black, 'z', armLen - inch(3), inch(0.8), 0, arm, 12);
    this.intakeRollers.push(r1, r2);
    cyl(inch(1.1), inch(2.5), S.motor, 'z', 0, 0, iw / 2 + inch(1.4), arm);
    g.add(this.intake);

    // ---- Shooter (turret o fijo): placas laterales, flywheels, hood curvo y motores
    const turret = spec.shooter.type === 'turret';
    const shY = Math.min(H - inch(9.5), hopY0 + hopH * 0.55);
    this.turret.position.set(turret ? hopCx - inch(1) : -hl + inch(5.5), shY, 0);
    if (turret) {
      cyl(inch(6), inch(1.2), S.black, 'y', 0, 0, 0, this.turret, 28);
      cyl(inch(5.2), inch(1.3), accent, 'y', 0, inch(0.1), 0, this.turret, 28);
    }
    const plateH = inch(8);
    const plateL = inch(9);
    const gap = inch(7);
    for (const s of [-1, 1]) box(plateL, plateH, inch(0.25), primary, inch(0.5), plateH / 2 + inch(0.8), (s * gap) / 2, this.turret);
    // flywheels (3 ruedas en un eje) + motor por fuera
    const fy = plateH * 0.62 + inch(0.8);
    const fx = inch(2.2);
    for (let k = -1; k <= 1; k++) {
      const w = cyl(inch(2), inch(1.4), k === 0 ? S.black : S.aluDark, 'z', fx, fy, (k * gap) / 3.3, this.turret, 18);
      this.flywheels.push(w);
    }
    cyl(inch(1.2), inch(2.6), S.motor, 'z', fx, fy, gap / 2 + inch(1.5), this.turret);
    cyl(inch(1.21), inch(0.5), S.motorCap, 'z', fx, fy, gap / 2 + inch(2.9), this.turret);
    // hood curvo sobre las flywheels (pivota con el ángulo de tiro)
    this.hood.position.set(fx, fy, 0);
    const hoodGeo = new THREE.CylinderGeometry(inch(3.4), inch(3.4), gap - inch(0.4), 20, 1, true, -Math.PI * 0.1, Math.PI * 0.62);
    hoodGeo.rotateX(Math.PI / 2);
    const hoodMesh = new THREE.Mesh(hoodGeo, new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, side: THREE.DoubleSide }));
    hoodMesh.castShadow = true;
    this.hood.add(hoodMesh);
    this.turret.add(this.hood);
    // indexer: rodillo que alimenta desde el hopper
    cyl(inch(0.9), gap - inch(0.6), accent, 'z', -inch(2.5), inch(2.2), 0, this.turret, 12);
    g.add(this.turret);

    // ---- Climber: tubo telescópico con gancho
    if (spec.climb.maxLevel > 0) {
      const cl = Math.max(0.12, H - BUMPER_TOP - inch(2));
      this.climber.position.set(-hl + inch(2.5), BUMPER_TOP, hw - inch(3));
      box(inch(1.5), cl, inch(1.5), S.alu, 0, cl / 2, 0, this.climber);
      this.climberInner = new THREE.Group();
      box(inch(1.1), cl, inch(1.1), accent, 0, cl / 2, 0, this.climberInner);
      box(inch(2.6), inch(0.7), inch(1.1), S.black, inch(0.9), cl + inch(0.2), 0, this.climberInner);
      box(inch(0.7), inch(1.6), inch(1.1), S.black, inch(1.9), cl - inch(0.3), 0, this.climberInner);
      this.climber.add(this.climberInner);
      // segundo tubo del otro lado
      const c2 = this.climber.clone(true);
      c2.position.z = -this.climber.position.z;
      g.add(this.climber);
      this.climber2 = c2;
      g.add(c2);
    }

    // ---- RSL (luz naranja de estado)
    this.rsl = new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xff7a00, emissiveIntensity: 0 });
    const rslMesh = new THREE.Mesh(new THREE.BoxGeometry(inch(2.2), inch(1.6), inch(1.6)), this.rsl);
    rslMesh.position.set(-hl + inch(1.2), H - inch(1), -hw + inch(2));
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

    // Fusiona lo estático por material (pocas draw calls); sombras solo del cuerpo principal
    mergeStaticChildren(g, new Set([this.marker, this.hopperBalls, rslMesh, walls]));
    mergeStaticChildren(this.turret, new Set(this.flywheels));
    mergeStaticChildren(arm, new Set(this.intakeRollers));
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.parent !== g && !this.flywheels.includes(o as THREE.Mesh)) o.castShadow = o.parent === arm || o.parent === this.turret;
    });
    this.intakeArm = arm;
  }

  private intakeArm: THREE.Group;
  private climber2: THREE.Object3D | null = null;

  /** Altura de salida del shooter en coordenadas locales (para alinear el disparo). */
  shooterLocal(): THREE.Vector3 {
    return new THREE.Vector3(this.turret.position.x, inch(this.spec.shooter.exitHeightIn), 0);
  }

  update(s: RobotVisualState, time: number): void {
    // Intake: pivota de guardada (vertical) a desplegada (adelante y abajo)
    const e = s.intakeDeploy * s.intakeDeploy * (3 - 2 * s.intakeDeploy);
    this.intakeArm.rotation.z = this.stowAngle + (this.deployAngle - this.stowAngle) * e;
    for (const r of this.intakeRollers) r.rotation.z = -s.intakeSpin;
    this.turret.rotation.y = s.turretYaw;
    this.hood.rotation.z = Math.max(-0.3, Math.min(0.5, (s.hoodAngle - Math.PI / 3) * 0.8));
    for (const f of this.flywheels) f.rotation.z = -s.flywheelSpin;
    if (this.climberInner) {
      this.climberInner.position.y = s.climbHeight;
      const c2 = this.climber2?.children[1];
      if (c2) c2.position.y = s.climbHeight;
    }
    for (const w of this.wheels) w.rotation.y = this.spec.drivetrain === 'swerve' ? s.wheelYaw : 0;
    for (const w of this.wheelSpinners) w.rotation.z = -s.wheelSpin;
    const n = Math.min(s.hopper, this.hopperSlots.length);
    if (this.hopperBalls.count !== n) this.hopperBalls.count = n;
    this.led.emissiveIntensity = s.enabled ? 2.4 : 0.7;
    // RSL: parpadea cuando está habilitado, fija cuando no
    this.rsl.emissiveIntensity = s.enabled ? (Math.floor(time * 2.5) % 2 ? 3 : 0.3) : 2;
  }
}
