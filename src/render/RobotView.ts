/**
 * Robot visual generado a partir de `RobotSpec`, con el aspecto de un robot de competencia:
 *  - BUMPERS de perfil redondeado que envuelven las esquinas, con el número en las 4 caras;
 *  - chasis de tubo 2×1 con belly pan y módulos swerve (motores arriba) o ruedas de tank;
 *  - placas laterales de aluminio con "pockets" triangulares (isogrid), pintadas del color
 *    del equipo, con tira de LEDs de alianza;
 *  - hopper entre las placas con el FUEL visible;
 *  - intake "over the bumper" de ancho completo con ruedas compliant (pivota al desplegarse);
 *  - shooter ancho de varias flywheels con hood curvo (fijo) o turret con su anillo;
 *  - climbers telescópicos, batería, electrónica y RSL.
 * Ejes locales: +X adelante (lado intake), +Y arriba, origen en el piso. Diseños inventados.
 */
import * as THREE from 'three';
import { BUMPER_ZONE_LOW, FUEL_RADIUS, inch } from '../config/field';
import type { RobotSpec } from '../config/robots';
import type { Alliance } from '../core/types';
import { ALLIANCE_COLOR } from './FieldView';
import { mergeStaticChildren } from './merge';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CAD_RIGS, CLEAR_MIN_OPACITY, hopperSlots, openingFor, shownFuel, type CadRig, type HopperSlot, type MechState } from './cadRigs';
import { HopperFuelSim } from './hopperFuel';

export interface RobotVisualState {
  intakeDeploy: number; // 0–1
  turretYaw: number; // rad relativo al robot
  hoodAngle: number; // rad sobre la horizontal
  climbHeight: number; // m de extensión del climber
  /** Climber desplegado 0–1 (CAD articulado). */
  climb?: number;
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
    alu: m({ color: 0xc9cdd3, metalness: 0.75, roughness: 0.3 }),
    aluDark: m({ color: 0x4e545c, metalness: 0.65, roughness: 0.42 }),
    black: m({ color: 0x141518, metalness: 0.25, roughness: 0.5 }),
    tread: m({ color: 0x0d0d0e, roughness: 0.95 }),
    motor: m({ color: 0x1a1b1e, metalness: 0.45, roughness: 0.38 }),
    motorCap: m({ color: 0xa3a8b0, metalness: 0.85, roughness: 0.28 }),
    polyClear: m({ color: 0xdbe6f0, transparent: true, opacity: 0.2, roughness: 0.06, metalness: 0, depthWrite: false, side: THREE.DoubleSide }),
    polySmoke: m({ color: 0x24272d, transparent: true, opacity: 0.78, roughness: 0.2, metalness: 0.1, side: THREE.DoubleSide }),
    compliant: m({ color: 0x31b05a, roughness: 0.8 }),
    flyOrange: m({ color: 0xff6b1a, roughness: 0.65 }),
    battery: m({ color: 0x17181b, roughness: 0.45 }),
    wireRed: m({ color: 0xc62828, roughness: 0.5 }),
    wireBlack: m({ color: 0x222222, roughness: 0.5 }),
    white: m({ color: 0xe6e7e9, roughness: 0.55 }),
    breaker: m({ color: 0xe0a800, roughness: 0.5 }),
    fuel: m({ color: 0xf4c20d, roughness: 0.9 }),
  };
})();

/** Distancia de un punto a un segmento (2D). */
function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insidePoly(px: number, py: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Placa de aluminio con pockets triangulares (isogrid) en el plano XY, de espesor `t`
 * centrado en Z. Solo se recortan los triángulos que quedan a `border` del contorno.
 */
export function pocketPlate(outline: Array<[number, number]>, t: number, opts: { side?: number; web?: number; border?: number } = {}): THREE.BufferGeometry {
  const side = opts.side ?? inch(4);
  const web = opts.web ?? inch(0.45);
  const border = opts.border ?? inch(1);
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const h = (side * Math.sqrt(3)) / 2;
  const inr = side / (2 * Math.sqrt(3)); // radio inscrito
  const k = Math.max(0.2, (inr - web / 2) / inr);
  const ok = (x: number, y: number) => {
    if (!insidePoly(x, y, outline)) return false;
    for (let i = 0; i < outline.length; i++) {
      const [ax, ay] = outline[i];
      const [bx, by] = outline[(i + 1) % outline.length];
      if (distSeg(x, y, ax, ay, bx, by) < border) return false;
    }
    return true;
  };
  for (let row = 0, y0 = minY; y0 + h <= maxY; row++, y0 += h) {
    const shift = row % 2 ? side / 2 : 0;
    for (let x0 = minX - side + shift; x0 < maxX; x0 += side) {
      const tris: Array<Array<[number, number]>> = [
        [[x0, y0], [x0 + side, y0], [x0 + side / 2, y0 + h]],
        [[x0 + side / 2, y0 + h], [x0 + side, y0], [x0 + (3 * side) / 2, y0 + h]],
      ];
      for (const tri of tris) {
        const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
        const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
        const pts = tri.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as [number, number]);
        if (!pts.every(([x, y]) => ok(x, y))) continue;
        shape.holes.push(new THREE.Path(pts.map(([x, y]) => new THREE.Vector2(x, y))));
      }
    }
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 3 });
  g.translate(0, 0, -t / 2);
  // Triángulos degenerados (lados colineales del contorno) dejan normales nulas; en el shader
  // se vuelven NaN y el bloom pinta toda la pantalla de negro. Se reemplazan por ±Z.
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++)
    if (Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) < 1e-6) n.setXYZ(i, 0, 0, 1);
  return g;
}

/** Textura del número de equipo (blanco sobre transparente) para los BUMPERS. */
function numberTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.font = `400 136px "Anton", "Arial Black", Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 256, 86);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class RobotView {
  readonly group = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private wheelSpinners: THREE.Object3D[] = [];
  private intake = new THREE.Group();
  private intakeArm = new THREE.Group();
  private intakeRollers: THREE.Object3D[] = [];
  private turret = new THREE.Group();
  private hood = new THREE.Group();
  private flywheels: THREE.Object3D[] = [];
  private climberInners: THREE.Object3D[] = [];
  private hopperBalls!: THREE.InstancedMesh;
  private hopperSlots: THREE.Vector3[] = [];
  private rsl: THREE.MeshStandardMaterial;
  private led: THREE.MeshStandardMaterial;
  private stowAngle = 0;
  private deployAngle = 0;
  /** Intake: 'pivot' (slapdown/four-bar) gira; 'rack' (cremallera) se desliza. */
  private intakeMode: 'pivot' | 'rack' = 'pivot';
  private rackStow = new THREE.Vector2();
  private rackDeploy = new THREE.Vector2();
  /** Indicador (anillo) sobre el robot del jugador. */
  readonly marker: THREE.Mesh;
  /** CAD articulado: rig y nodos que reciben la pose de cada componente (marco WPILib). */
  private rig: CadRig | null = null;
  private cadHolders: Array<THREE.Object3D | null> = [];
  private mech: MechState = { intake: 0, hood: 0, turret: 0, climb: 0, spin: 0 };

  constructor(
    readonly spec: RobotSpec,
    readonly alliance: Alliance,
  ) {
    const hl = inch(spec.lengthIn) / 2;
    const hw = inch(spec.widthIn) / 2;
    const bt = inch(spec.bumperIn);
    const H = inch(spec.heightIn);
    const S = SHARED;
    const primary = new THREE.MeshStandardMaterial({ color: spec.colors.primary, metalness: 0.35, roughness: 0.42, side: THREE.DoubleSide });
    const accent = new THREE.MeshStandardMaterial({ color: spec.colors.accent, metalness: 0.3, roughness: 0.45 });
    const g = this.group;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) =>
      add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
    const cyl = (r: number, len: number, mat: THREE.Material, axis: 'x' | 'y' | 'z', x: number, y: number, z: number, parent: THREE.Object3D = g, seg = 16) => {
      const geo = new THREE.CylinderGeometry(r, r, len, seg);
      if (axis === 'x') geo.rotateZ(Math.PI / 2);
      if (axis === 'z') geo.rotateX(Math.PI / 2);
      return add(geo, mat, x, y, z, parent);
    };
    /** Motor brushless (cuerpo negro, anillo de color y tapa metálica) a lo largo de `axis`. */
    const motor = (axis: 'y' | 'z', x: number, y: number, z: number, dir: 1 | -1, parent: THREE.Object3D = g) => {
      const len = inch(2.6);
      const off = (d: number) => (axis === 'y' ? [x, y + dir * d, z] : [x, y, z + dir * d]) as [number, number, number];
      cyl(inch(1.2), len, S.motor, axis, ...off(len / 2), parent, 18);
      cyl(inch(1.23), inch(0.3), accent, axis, ...off(len * 0.72), parent, 18);
      cyl(inch(1.0), inch(0.35), S.motorCap, axis, ...off(len + inch(0.15)), parent, 18);
    };

    // ---- BUMPERS: perfil redondeado (espuma bajo la tela) que envuelve las esquinas
    const by0 = BUMPER_ZONE_LOW;
    const bh = BUMPER_TOP - by0;
    const rr = Math.min(bt, bh) * 0.42;
    const profile = new THREE.Shape();
    profile.moveTo(0, by0);
    profile.lineTo(bt - rr, by0);
    profile.quadraticCurveTo(bt, by0, bt, by0 + rr);
    profile.lineTo(bt, by0 + bh - rr);
    profile.quadraticCurveTo(bt, by0 + bh, bt - rr, by0 + bh);
    profile.lineTo(0, by0 + bh);
    profile.closePath();
    const fabric = new THREE.MeshStandardMaterial({ color: ALLIANCE_COLOR[alliance], roughness: 0.88 });
    // Tramo recto a lo largo de X (sale hacia +Z) de largo `len`
    const straight = (len: number) => {
      const s = new THREE.ExtrudeGeometry(profile, { depth: len, bevelEnabled: false, curveSegments: 6 });
      s.rotateY(-Math.PI / 2); // perfil (d, y) → (z = d), extrusión → −X
      s.translate(len / 2, 0, 0);
      return s;
    };
    for (const [len, rot, tx, tz] of [
      [2 * hl, 0, 0, hw],
      [2 * hl, Math.PI, 0, -hw],
      [2 * hw, Math.PI / 2, hl, 0],
      [2 * hw, -Math.PI / 2, -hl, 0],
    ] as Array<[number, number, number, number]>) {
      const s = straight(len);
      s.rotateY(rot);
      add(s, fabric, tx, 0, tz);
    }
    const prof2 = profile.getPoints(6).map((p) => new THREE.Vector2(p.x, p.y));
    for (const [cx, cz, phi] of [
      [hl, hw, 0],
      [hl, -hw, Math.PI / 2],
      [-hl, -hw, Math.PI],
      [-hl, hw, (3 * Math.PI) / 2],
    ] as Array<[number, number, number]>)
      add(new THREE.LatheGeometry(prof2, 6, phi, Math.PI / 2), fabric, cx, 0, cz);
    // Número de equipo en las 4 caras
    const numMat = new THREE.MeshStandardMaterial({ map: numberTexture(spec.teamNumber), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
    const numH = (bh - 2 * rr) * 1.45;
    for (const [w, rot, x, z] of [
      [Math.min(2 * hl * 0.8, numH * 3.2), 0, 0, hw + bt + 0.001],
      [Math.min(2 * hl * 0.8, numH * 3.2), Math.PI, 0, -hw - bt - 0.001],
      [Math.min(2 * hw * 0.8, numH * 3.2), Math.PI / 2, hl + bt + 0.001, 0],
      [Math.min(2 * hw * 0.8, numH * 3.2), -Math.PI / 2, -hl - bt - 0.001, 0],
    ] as Array<[number, number, number, number]>) {
      const p = new THREE.PlaneGeometry(w, w / 3.2);
      p.rotateY(rot);
      const m = add(p, numMat, x, by0 + bh / 2, z);
      m.castShadow = false;
    }

    // Robot con CAD real del equipo: solo BUMPERS procedurales (color de alianza) + el modelo
    const keep: THREE.Object3D[] = [];
    if (spec.cad) {
      this.rsl = new THREE.MeshStandardMaterial();
      this.led = new THREE.MeshStandardMaterial();
      this.hopperBalls = new THREE.InstancedMesh(new THREE.BufferGeometry(), S.fuel, 1);
      this.hopperBalls.count = 0;
      this.ready = this.loadCad(spec.cad.file);
    } else {
      // ---- Chasis: belly pan, tubo 2×1 en el perímetro y travesaños
      const yF = BUMPER_TOP; // altura de la parte superior del chasis
      box(2 * hl - inch(1), inch(0.19), 2 * hw - inch(1), S.aluDark, 0, inch(1.6), 0);
      const tubeY = yF - inch(1.0);
      for (const s of [-1, 1]) {
        box(2 * hl, inch(2), inch(1), S.alu, 0, tubeY, s * (hw - inch(0.5)));
        box(inch(1), inch(2), 2 * hw - inch(2), S.alu, s * (hl - inch(0.5)), tubeY, 0);
      }
      box(inch(1), inch(1), 2 * hw - inch(2), S.alu, inch(5), tubeY, 0);
      box(inch(1), inch(1), 2 * hw - inch(2), S.alu, -inch(5), tubeY, 0);

      // ---- Módulos swerve (o ruedas de tank)
      const wheelR = inch(2);
      const mx = hl - inch(3.4);
      const mz = hw - inch(3.4);
      const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, inch(1.5), 24);
      wheelGeo.rotateX(Math.PI / 2);
      const hubGeo = new THREE.CylinderGeometry(inch(1.25), inch(1.25), inch(1.56), 6);
      hubGeo.rotateX(Math.PI / 2);
      const swerve = spec.drivetrain === 'swerve';
      for (const [x, z] of [
        [mx, mz],
        [mx, -mz],
        [-mx, mz],
        [-mx, -mz],
      ]) {
        if (swerve) {
          // placa del módulo (color de acento) con dos motores arriba: tracción y dirección
          add(roundedSquare(inch(5.2), inch(0.9), inch(0.35)), accent, x, yF - inch(0.2), z);
          motor('y', x - inch(1.15), yF, z + Math.sign(z) * inch(1.0), 1);
          motor('y', x + inch(1.25), yF, z - Math.sign(z) * inch(1.05), 1);
        } else {
          // tank: placa lateral y caja de engranes en las esquinas traseras
          box(inch(4.5), inch(3), inch(0.25), S.aluDark, x, wheelR + inch(0.5), z - Math.sign(z) * inch(1.1));
          if (x < 0) motor('z', x, wheelR, z - Math.sign(z) * inch(2.2), z > 0 ? -1 : 1);
        }
        const mod = new THREE.Group();
        mod.position.set(x, 0, z);
        const steer = new THREE.Group();
        mod.add(steer);
        const wheel = new THREE.Mesh(wheelGeo, S.tread);
        wheel.position.y = wheelR;
        wheel.castShadow = true;
        steer.add(wheel);
        const hubMesh = new THREE.Mesh(hubGeo, S.motorCap);
        wheel.add(hubMesh);
        if (swerve) {
          // horquilla del módulo
          for (const s of [-1, 1]) box(inch(3.4), inch(3.6), inch(0.3), S.aluDark, 0, wheelR + inch(1.1), s * inch(1.0), steer);
        }
        this.wheels.push(steer);
        this.wheelSpinners.push(wheel);
        g.add(mod);
      }

      // ---- Intake "over the bumper" (común): rodillo de ruedas compliant y brazos.
      //      'pivot' = slapdown que gira desde (px, py); 'rack' = se desliza hacia afuera y abajo.
      const makeIntake = (mode: 'pivot' | 'rack', px: number, py: number, iw: number, plateMat: THREE.Material) => {
        const ext = inch(spec.intake.extensionIn);
        const rollerX = hl + ext - inch(1.5);
        const rollerY = inch(3.6);
        this.intakeMode = mode;
        let armLen: number;
        if (mode === 'pivot') {
          const reachX = rollerX - px;
          const dropY = py - rollerY;
          armLen = Math.hypot(reachX, dropY);
          this.deployAngle = -Math.atan2(dropY, reachX);
          this.stowAngle = Math.PI * 0.56; // pasada la vertical, dentro del perímetro
          this.intake.position.set(px, py, 0);
        } else {
          // Rieles con cremallera: el conjunto sale en línea recta por encima del BUMPER
          armLen = inch(9);
          this.rackStow.set(hl - inch(1.0), BUMPER_TOP + inch(1.4));
          this.rackDeploy.set(rollerX, rollerY);
          this.intake.position.set(this.rackStow.x, this.rackStow.y, 0);
        }
        this.intake.add(this.intakeArm);
        // en 'rack' el brazo va hacia atrás desde el rodillo (el rodillo queda en el origen)
        const ox = mode === 'rack' ? -armLen : 0;
        const armGeo = pocketPlate(
          [
            [-inch(1), -inch(1.2)],
            [armLen + inch(1.2), -inch(1.3)],
            [armLen + inch(1.2), inch(1.3)],
            [-inch(1), inch(1.4)],
          ],
          plateT,
          { side: inch(2.2), border: inch(0.5), web: inch(0.3) },
        );
        for (const s of [-1, 1]) add(armGeo.clone(), plateMat, ox, 0, (s * iw) / 2, this.intakeArm);
        box(inch(1), inch(1), iw, S.aluDark, ox + armLen * 0.5, inch(0.9), 0, this.intakeArm);
        // Rodillo principal: eje hexagonal con ruedas compliant cada ~2 in
        const roller = new THREE.Group();
        roller.position.set(ox + armLen, 0, 0);
        cyl(inch(0.4), iw, S.alu, 'z', 0, 0, 0, roller, 6);
        const nW = Math.max(3, Math.floor(iw / inch(2.2)));
        for (let k = 0; k < nW; k++) cyl(inch(1.25), inch(0.75), S.compliant, 'z', 0, 0, -iw / 2 + inch(1) + (k * (iw - inch(2))) / (nW - 1), roller, 12);
        mergeStaticChildren(roller);
        this.intakeArm.add(roller);
        // Rodillo secundario (arriba/atrás) y motor
        const roller2 = new THREE.Group();
        roller2.position.set(ox + armLen - inch(3.2), inch(1.4), 0);
        cyl(inch(0.85), iw - inch(0.6), S.black, 'z', 0, 0, 0, roller2, 14);
        this.intakeArm.add(roller2);
        this.intakeRollers.push(roller, roller2);
        motor('z', ox + armLen - inch(1.6), inch(0.6), iw / 2 + plateT, 1, this.intakeArm);
        g.add(this.intake);
      };

      // ---- FUEL visible en el hopper: rejilla dentro de la caja [x0,x1]×[z0,z1]×[y0,y1]
      const fillHopper = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => {
        const d = FUEL_RADIUS * 2;
        const nx = Math.max(1, Math.floor((x1 - x0) / d));
        const nz = Math.max(1, Math.floor((z1 - z0) / d));
        const ny = Math.max(1, Math.floor((y1 - y0 - d) / (d * 0.86)) + 1);
        const cx = (x0 + x1) / 2;
        const cz = (z0 + z1) / 2;
        for (let y = 0; y < ny; y++)
          for (let x = 0; x < nx; x++)
            for (let z = 0; z < nz; z++) {
              if (this.hopperSlots.length >= MAX_SHOWN) break;
              const odd = y % 2 ? d * 0.25 : 0;
              this.hopperSlots.push(new THREE.Vector3(cx + (x - (nx - 1) / 2) * d + odd, y0 + FUEL_RADIUS + 0.004 + y * d * 0.86, cz + (z - (nz - 1) / 2) * d + odd));
            }
        this.hopperBalls = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(FUEL_RADIUS * 0.97, 1), S.fuel, Math.max(1, this.hopperSlots.length));
        this.hopperBalls.count = 0;
        const m4 = new THREE.Matrix4();
        this.hopperSlots.forEach((p, i) => this.hopperBalls.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
        this.hopperBalls.frustumCulled = false;
        this.hopperBalls.castShadow = true;
        g.add(this.hopperBalls);
        keep.push(this.hopperBalls);
      };

      const plateT = inch(0.25);
      const rslPos = new THREE.Vector3();
      this.led = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: ALLIANCE_COLOR[alliance], emissiveIntensity: 2.2 });
      {
        // ---- Placas laterales con pockets (color del equipo)
        const turret = spec.shooter.type === 'turret';
        const pz = hw - inch(1.5); // plano de las placas
        const px0 = -hl + inch(1.2);
        const px1 = hl - inch(1.2);
        const hFront = Math.max(inch(7), (H - yF) * 0.5);
        const hBack = Math.max(hFront + inch(2), H - yF - (turret ? inch(8.5) : inch(1)));
        const pxm = px0 + (px1 - px0) * 0.42;
        const outline: Array<[number, number]> = [
          [px0, yF],
          [px1, yF],
          [px1, yF + hFront],
          [pxm, yF + hBack],
          [px0, yF + hBack],
        ];
        const plateGeo = pocketPlate(outline, plateT, { side: inch(4.2), border: inch(1.1) });
        for (const s of [-1, 1]) add(plateGeo.clone(), primary, 0, 0, s * pz);
        // tubos que unen las placas (arriba adelante, arriba atrás y abajo)
        box(inch(1), inch(1), 2 * pz, S.alu, px1 - inch(0.5), yF + hFront - inch(0.5), 0);
        box(inch(1), inch(1), 2 * pz, S.alu, px0 + inch(0.5), yF + hBack - inch(0.5), 0);
        box(inch(1), inch(1), 2 * pz, S.alu, pxm, yF + hBack - inch(0.5), 0);
        // Tira de LEDs de alianza en el borde superior de las placas
        const ledLen = Math.hypot(px1 - pxm, hBack - hFront);
        const ledAng = Math.atan2(hBack - hFront, px1 - pxm);
        for (const s of [-1, 1]) {
          const l = box(ledLen * 0.9, inch(0.3), inch(0.4), this.led, (px1 + pxm) / 2, yF + (hFront + hBack) / 2 + inch(0.3), s * (pz + inch(0.3)));
          l.rotation.z = -ledAng;
          l.castShadow = false;
        }

        // ---- Hopper: piso, frente de policarbonato y FUEL visible
        const hx0 = px0 + (turret ? inch(3) : inch(9));
        const hx1 = px1 - inch(1.5);
        const hopL = hx1 - hx0;
        const hopCx = (hx0 + hx1) / 2;
        const hopW = 2 * pz - inch(1.2);
        const hopY0 = yF + inch(0.8);
        const hopH = Math.max(0.12, hFront * 0.95 - inch(0.8));
        box(hopL, inch(0.2), hopW, S.aluDark, hopCx, hopY0 - inch(0.1), 0);
        const front = new THREE.Mesh(new THREE.PlaneGeometry(hopW, hopH * 0.7).rotateY(Math.PI / 2), S.polyClear);
        front.position.set(hx1 + inch(0.3), hopY0 + hopH * 0.35, 0);
        front.renderOrder = 3;
        g.add(front);
        keep.push(front);
        fillHopper(hx0, hx1, -hopW / 2, hopW / 2, hopY0, hopY0 + hopH + FUEL_RADIUS * 1.2);

        // ---- Electrónica y batería (sobre el belly pan, atrás)
        const ey = inch(2.2);
        box(inch(6.6), inch(6.2), inch(3), S.battery, -hl + inch(4.2), ey + inch(3.1), -hw + inch(6.5));
        box(inch(0.8), inch(0.6), inch(1.2), S.wireRed, -hl + inch(4.2), ey + inch(6.4), -hw + inch(6.0));
        box(inch(7.5), inch(1.6), inch(4), S.black, -hl + inch(6), ey + inch(0.8), hw - inch(6));
        for (let k = 0; k < 6; k++) box(inch(0.6), inch(0.5), inch(0.8), S.breaker, -hl + inch(3.2) + k * inch(1.1), ey + inch(1.8), hw - inch(6));
        box(inch(5.5), inch(1.1), inch(3.6), S.white, inch(1), ey + inch(0.55), -hw + inch(6));
        box(inch(3), inch(1), inch(2), S.white, inch(1), ey + inch(0.5), hw - inch(5));
        cyl(inch(0.2), 2 * hw - inch(10), S.wireRed, 'z', -hl + inch(9), ey + inch(0.3), 0);
        cyl(inch(0.2), 2 * hw - inch(10), S.wireBlack, 'z', -hl + inch(9.6), ey + inch(0.3), 0);

        makeIntake('pivot', px1 - inch(1.5), yF + hFront - inch(1.5), Math.min(inch(spec.intake.widthIn), 2 * pz + inch(1)), primary);
        rslPos.set(pxm, yF + hBack + inch(0.8), -pz + inch(2.5));

        // ---- Shooter
        const shooterW = 2 * pz - inch(0.6);
        if (turret) {
          // Turret: anillo de giro sobre las placas y un shooter compacto encima
          const tx = px0 + (px1 - px0) * 0.3;
          const ty = yF + hBack + inch(0.5);
          this.turret.position.set(tx, ty, 0);
          add(new THREE.TorusGeometry(inch(5.6), inch(0.6), 10, 36).rotateX(Math.PI / 2), S.black, tx, ty, 0);
          box(inch(13), inch(0.4), 2 * pz, S.aluDark, tx, ty - inch(0.6), 0);
          cyl(inch(5.4), inch(0.8), accent, 'y', 0, inch(0.3), 0, this.turret, 32);
          const tGap = inch(7.5);
          const tPlate = pocketPlate(
            [
              [-inch(5), 0],
              [inch(5), 0],
              [inch(4), inch(7.5)],
              [-inch(4.5), inch(7.5)],
            ],
            plateT,
            { side: inch(2.6), border: inch(0.6), web: inch(0.35) },
          );
          for (const s of [-1, 1]) add(tPlate.clone(), primary, 0, inch(0.7), (s * tGap) / 2, this.turret);
          this.buildFlywheels(this.turret, inch(1.2), inch(5.2), tGap - inch(0.5), 2, accent, motor, cyl, add);
        } else {
          // Fijo: shooter ancho al fondo, de placa a placa
          const sx = px0 + inch(4.5);
          const sy = yF + hBack - inch(4.5);
          this.turret.position.set(sx, sy, 0);
          this.buildFlywheels(this.turret, 0, 0, shooterW, shooterW > inch(20) ? 4 : 3, accent, motor, cyl, add);
          // motor por fuera de la placa
          motor('z', 0, 0, pz + plateT, 1, this.turret);
        }
        g.add(this.turret);

        // ---- Climbers telescópicos (por fuera de las placas, al centro)
        if (spec.climb.maxLevel > 0) {
          const cl = Math.max(0.14, hBack * 0.85);
          const cx = pxm - inch(1);
          for (const s of [-1, 1]) {
            const cz = s * (pz + inch(1));
            box(inch(1.5), cl, inch(1.5), S.alu, cx, yF + cl / 2, cz);
            const inner = new THREE.Group();
            inner.position.set(cx, yF, cz);
            box(inch(1.1), cl, inch(1.1), accent, 0, cl / 2, 0, inner);
            // gancho
            box(inch(2.8), inch(0.6), inch(1.1), S.black, inch(1), cl + inch(0.3), 0, inner);
            box(inch(0.6), inch(1.8), inch(1.1), S.black, inch(2.1), cl - inch(0.3), 0, inner);
            g.add(inner);
            this.climberInners.push(inner);
          }
        }

      }

      // ---- RSL (luz naranja de estado)
      this.rsl = new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xff7a00, emissiveIntensity: 0 });
      const rslMesh = new THREE.Mesh(new THREE.BoxGeometry(inch(2.2), inch(1.6), inch(1.6)), this.rsl);
      rslMesh.position.copy(rslPos);
      g.add(rslMesh);
      keep.push(rslMesh);
    }

    // ---- Marcador del jugador (anillo en el piso)
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(Math.hypot(hl + bt, hw + bt) + 0.05, Math.hypot(hl + bt, hw + bt) + 0.1, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.01;
    this.marker.visible = false;
    g.add(this.marker);

    // Fusiona lo estático por material (pocas draw calls)
    mergeStaticChildren(g, new Set([this.marker, ...keep]));
    mergeStaticChildren(this.turret, new Set([...this.flywheels, this.hood]));
    mergeStaticChildren(this.intakeArm, new Set(this.intakeRollers));
  }

  /** Flywheels sobre un eje a lo largo de Z, hood curvo que pivota y rodillo indexer. */
  private buildFlywheels(
    parent: THREE.Group,
    x: number,
    y: number,
    width: number,
    n: number,
    accent: THREE.Material,
    motor: (axis: 'y' | 'z', x: number, y: number, z: number, dir: 1 | -1, parent?: THREE.Object3D) => void,
    cyl: (r: number, len: number, mat: THREE.Material, axis: 'x' | 'y' | 'z', x: number, y: number, z: number, parent?: THREE.Object3D, seg?: number) => THREE.Mesh,
    add: (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D) => THREE.Mesh,
  ): void {
    const S = SHARED;
    const r = inch(2);
    const fly = new THREE.Group();
    fly.position.set(x, y, 0);
    cyl(inch(0.25), width, S.alu, 'z', 0, 0, 0, fly, 8);
    for (let k = 0; k < n; k++) {
      const z = -width / 2 + width * ((k + 0.5) / n);
      cyl(r, inch(1.6), k % 2 ? S.black : S.flyOrange, 'z', 0, 0, z, fly, 22);
    }
    mergeStaticChildren(fly);
    parent.add(fly);
    this.flywheels.push(fly);
    // Hood: lámina curva ahumada que cubre la flywheel desde atrás, por arriba, hasta el frente
    // (el FUEL sale hacia adelante y arriba); pivota con el ángulo de tiro.
    this.hood.position.set(x, y, 0);
    const hoodGeo = new THREE.CylinderGeometry(r + inch(1.4), r + inch(1.4), width, 24, 1, true, (5 * Math.PI) / 6, (2 * Math.PI) / 3);
    hoodGeo.rotateX(Math.PI / 2); // θ = 5π/6 → adelante-arriba, π → arriba, 3π/2 → atrás
    add(hoodGeo, S.polySmoke, 0, 0, 0, this.hood);
    for (const s of [-1, 1]) {
      const side = new THREE.CircleGeometry(r + inch(1.6), 16, Math.PI / 3, (2 * Math.PI) / 3);
      add(side, accent, 0, 0, (s * width) / 2, this.hood);
    }
    parent.add(this.hood);
    // indexer que alimenta desde el hopper
    cyl(inch(0.9), width - inch(0.6), accent, 'z', x + inch(3.4), y - inch(2.6), 0, parent, 12);
    motor('z', x + inch(3.4), y - inch(2.6), -width / 2 - inch(0.3), -1, parent);
  }

  /**
   * Carga el modelo 3D real del equipo (GLB de scripts/robots/build-models.mjs) y lo arma como
   * en AdvantageScope: `main` fijo y cada componente `cN` colgado de un nodo que recibe su pose
   * (src/render/cadRigs.ts), todo dentro de un marco WPILib (Z arriba) girado a Y arriba.
   * Cada archivo se descarga y prepara una vez; cada robot usa un clon.
   */
  private loadCad(file: string): Promise<void> {
    return loadRobotModel(file)
      .then((scene) => {
        const m = scene.clone(true);
        const rig = CAD_RIGS[file] ?? null;
        const root = new THREE.Group();
        root.name = 'cad';
        root.rotation.y = ((rig?.yawDeg ?? 0) * Math.PI) / 180;
        const wpi = new THREE.Group();
        wpi.rotation.x = -Math.PI / 2; // WPILib (Z arriba, Y izquierda) → simulador (Y arriba, Z derecha)
        root.add(wpi);
        const nodes = new Map<string, THREE.Object3D>();
        m.traverse((o) => {
          if (/^(main|c\d+)$/.test(o.name)) nodes.set(o.name, o);
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          // Policarbonato del CAD (hoppers, belly pans): en AdvantageScope viene casi invisible
          // (alfa 0.1–0.3); sobre el campo claro desaparece. Se sube a un acrílico ahumado que se lee.
          if (mat.transparent && mat.opacity < CLEAR_MIN_OPACITY) {
            mat.opacity = CLEAR_MIN_OPACITY;
            mat.roughness = 0.3;
          }
          mesh.castShadow = !mat.transparent;
          mesh.receiveShadow = true;
        });
        const main = nodes.get('main');
        if (main) wpi.add(main);
        else wpi.add(m); // GLB viejo sin partes
        if (rig) {
          this.rig = rig;
          for (let i = 0; nodes.has(`c${i}`); i++) {
            const holder = new THREE.Group();
            const comp = nodes.get(`c${i}`)!;
            if (rig.opaque?.includes(i))
              comp.traverse((o) => {
                const mesh = o as THREE.Mesh;
                if (!mesh.isMesh) return;
                const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
                mat.transparent = false;
                mat.opacity = 1;
                mat.depthWrite = true;
                mesh.material = mat;
                mesh.castShadow = true;
              });
            holder.add(comp);
            wpi.add(holder);
            this.cadHolders[i] = holder;
          }
          for (const e of rig.extras ?? []) {
            const holder = this.cadHolders[e.comp];
            if (!holder) continue;
            const a = new THREE.Vector3(...e.a);
            const b = new THREE.Vector3(...e.b);
            const len = a.distanceTo(b);
            const geo = new THREE.CylinderGeometry(e.r, e.r, len, 16);
            const cyl = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: e.color, roughness: 0.75 }));
            cyl.position.copy(a).add(b).multiplyScalar(0.5);
            cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
            cyl.castShadow = true;
            holder.add(cyl);
          }
          if (rig.hopper) this.buildCadHopper(wpi, rig);
          if (rig.walls) this.buildCadWalls(wpi, rig.walls);
        }
        // Algunos assets traen las ruedas 4.4 cm bajo el piso (971, 401, 180, 2826, 10021): con los
        // BUMPERS en su zona fija (R405) el robot se veía hundido y los BUMPERS más arriba que en
        // los demás. El modelo (con los mecanismos guardados) se apoya en el piso.
        this.applyMech();
        root.updateMatrixWorld(true);
        const box = new THREE.Box3();
        for (const [name, o] of nodes) if (/^(main|c\d+)$/.test(name)) box.expandByObject(o);
        if (!box.isEmpty() && Math.abs(box.min.y) > 0.005) root.position.y = -box.min.y;
        this.group.add(root);
        this.cadLoaded = true;
        this.applyMech();
      })
      .catch((e) => console.warn('robot model', file, e));
  }

  /** Lugares del FUEL en el hopper del CAD y una malla instanciada por caja. */
  private cadSlots: HopperSlot[] = [];
  private cadBoxMeshes: THREE.InstancedMesh[] = [];
  /** Posición de cada lugar en el marco de su malla (la del robot o la del componente). */
  /** Cajas montadas en un componente: del marco WPILib (guardado) al del componente. */
  private cadBoxInv: Array<THREE.Matrix4 | null> = [];
  private hopperSim: HopperFuelSim | null = null;
  private cadWpi: THREE.Object3D | null = null;
  private cadFill = -1;
  private cadFillE = NaN;
  /** Velocidad y aceleración del robot (mundo, suavizadas) para la inercia del FUEL. */
  private lastPos = new THREE.Vector3(NaN, 0, 0);
  private lastVel = new THREE.Vector3();
  private accel = new THREE.Vector3();
  /** Despliegue que el FUEL guardado obliga a mantener (suavizado) y para cuántos FUEL. */
  private heldOpen = 0;
  private heldTarget = 0;
  private heldFor = -1;
  private lastTime = NaN;

  /**
   * FUEL visible dentro del hopper del CAD: cajas en el marco WPILib (mecanismos guardados);
   * las montadas en un componente se convierten a su marco para moverse con él.
   */
  private buildCadHopper(wpi: THREE.Object3D, rig: CadRig): void {
    const boxes = rig.hopper!;
    this.cadSlots = hopperSlots(boxes, Math.max(8, Math.min(80, this.spec.hopperCapacity)));
    const ref = rig.poses({ intake: 0, hood: 0, turret: 0, climb: 0, spin: 0 });
    const geo = new THREE.IcosahedronGeometry(FUEL_RADIUS * 0.97, 1);
    const inv = boxes.map((b) => {
      const p = b.comp !== undefined ? ref[b.comp] : null;
      if (!p) return null;
      return new THREE.Matrix4().compose(new THREE.Vector3(...p.t), new THREE.Quaternion(...p.q), new THREE.Vector3(1, 1, 1)).invert();
    });
    this.cadBoxInv = inv;
    this.cadWpi = wpi;
    this.hopperSim = new HopperFuelSim(boxes, this.cadSlots);
    this.cadBoxMeshes = boxes.map((b, i) => {
      const n = this.cadSlots.filter((sl) => sl.box === i).length;
      const mesh = new THREE.InstancedMesh(geo, SHARED.fuel, Math.max(1, n));
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      const holder = b.comp !== undefined ? this.cadHolders[b.comp] : null;
      (holder ?? wpi).add(mesh);
      return mesh;
    });
    this.cadFill = -1;
  }

  /** Paredes de policarbonato del hopper que el CAD no trae (`CadRig.walls`). */
  private wallFronts: Array<{ mesh: THREE.Object3D; x0: number; x1: number }> = [];
  private buildCadWalls(wpi: THREE.Object3D, walls: NonNullable<CadRig['walls']>): void {
    // Policarbonato con un poco de tinte y brillo, en marco de aluminio (postes en las esquinas y
    // riel arriba y abajo), como los hoppers de verdad
    const poly = new THREE.MeshStandardMaterial({ color: 0xd9e6f2, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false });
    const alu = SHARED.alu;
    const T = inch(1); // tubo de 1 in
    const box = (parent: THREE.Object3D, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z);
      if (mat === poly) m.renderOrder = 2;
      else m.castShadow = true;
      parent.add(m);
      return m;
    };
    for (const b of walls) {
      const [x0, y0, z0] = b.min;
      const [x1, y1, z1] = b.max;
      const h = z1 - z0;
      const zc = (z0 + z1) / 2;
      const xMax = b.maxDeployed ? b.maxDeployed[0] : x1;
      const L = xMax - x0;
      const W = y1 - y0;
      // laterales (del largo desplegado: el frente corre por dentro) y pared de atrás
      for (const y of [y0, y1]) {
        box(wpi, poly, L, 0.004, h, x0 + L / 2, y, zc);
        box(wpi, alu, L, T, T, x0 + L / 2, y, z1 - T / 2);
        box(wpi, alu, L, T, T, x0 + L / 2, y, z0 + T / 2);
        box(wpi, alu, T, T, h, x0 + T / 2, y, zc);
      }
      box(wpi, poly, 0.004, W, h, x0, (y0 + y1) / 2, zc);
      box(wpi, alu, T, W, T, x0 + T / 2, (y0 + y1) / 2, z1 - T / 2);
      // frente: pared con su marco (se mueve como bloque)
      const front = new THREE.Group();
      front.position.x = x1;
      box(front, poly, 0.004, W, h, 0, (y0 + y1) / 2, zc);
      box(front, alu, T, W, T, -T / 2, (y0 + y1) / 2, z1 - T / 2);
      for (const y of [y0, y1]) box(front, alu, T, T, h, -T / 2, y, zc);
      wpi.add(front);
      if (b.maxDeployed) this.wallFronts.push({ mesh: front, x0: x1, x1: b.maxDeployed[0] });
    }
  }

  /**
   * FUEL del hopper del CAD: `n` FUEL con física visual (`HopperFuelSim`): los nuevos caen desde
   * la entrada, al tirar sale el de abajo, y la aceleración del robot los recorre.
   */
  private fillCadHopper(n: number, e: number, dt: number): void {
    const sim = this.hopperSim;
    if (!sim || !this.cadBoxMeshes.length) return;
    n = shownFuel(n, this.cadSlots.length, this.spec.hopperCapacity);
    let moved = false;
    if (n !== this.cadFill || Math.abs(e - this.cadFillE) > 0.01) {
      // la primera vez (o tras reiniciar el campo) aparecen ya acomodados
      moved = sim.sync(n, e, this.cadFill < 0 || Math.abs(n - this.cadFill) > 12) || Math.abs(e - this.cadFillE) > 0.01;
      this.cadFill = n;
      this.cadFillE = e;
    }
    // inercia: aceleración del robot en el marco del CAD (WPILib)
    let ax = 0;
    let ay = 0;
    if (this.cadWpi && this.accel.lengthSq() > 0.01) {
      const q = this.cadWpi.getWorldQuaternion(new THREE.Quaternion()).invert();
      const a = this.accel.clone().applyQuaternion(q);
      ax = a.x;
      ay = a.y;
    }
    for (const w of this.wallFronts) w.mesh.position.x = w.x0 + (w.x1 - w.x0) * e;
    if (sim.step(dt, ax, ay)) moved = true;
    if (!moved) return;
    const counts = this.cadBoxMeshes.map(() => 0);
    const m4 = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const b of sim.balls) {
      const mesh = this.cadBoxMeshes[b.box];
      if (counts[b.box] >= mesh.instanceMatrix.count) continue;
      v.set(b.p[0], b.p[1], b.p[2]);
      const inv = this.cadBoxInv[b.box];
      if (inv) v.applyMatrix4(inv);
      mesh.setMatrixAt(counts[b.box]++, m4.makeTranslation(v.x, v.y, v.z));
    }
    this.cadBoxMeshes.forEach((mesh, b) => {
      mesh.count = counts[b];
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  /** Aplica las poses del rig al estado actual de los mecanismos. */
  private applyMech(): void {
    if (!this.rig) return;
    const poses = this.rig.poses(this.mech);
    for (let i = 0; i < this.cadHolders.length; i++) {
      const h = this.cadHolders[i];
      if (!h) continue;
      const p = poses[i];
      h.visible = !!p;
      if (!p) continue;
      h.position.set(p.t[0], p.t[1], p.t[2]);
      h.quaternion.set(p.q[0], p.q[1], p.q[2], p.q[3]);
    }
  }

  /** El modelo real ya se cargó (los robots con CAD no tienen otra geometría). */
  cadLoaded = false;
  /** Se resuelve cuando el robot terminó de armarse (al instante si no usa CAD). */
  ready: Promise<void> = Promise.resolve();

  /** Altura de salida del shooter en coordenadas locales (para alinear el disparo). */
  shooterLocal(): THREE.Vector3 {
    return new THREE.Vector3(this.turret.position.x, inch(this.spec.shooter.exitHeightIn), 0);
  }

  update(s: RobotVisualState, time: number): void {
    // Intake: pivota de guardada (pasada la vertical) a desplegada (adelante y abajo)
    const e = s.intakeDeploy * s.intakeDeploy * (3 - 2 * s.intakeDeploy);
    const dt = Number.isFinite(this.lastTime) ? THREE.MathUtils.clamp(time - this.lastTime, 0, 0.1) : 0;
    this.lastTime = time;
    if (this.rig) {
      const sh = this.spec.shooter;
      const m = this.mech;
      // Con FUEL adentro, la intake no se guarda del todo (el FUEL ocupa ese lugar del hopper)
      if (this.rig.hopper && this.cadSlots.length) {
        if (s.hopper !== this.heldFor) {
          this.heldFor = s.hopper;
          this.heldTarget = openingFor(this.rig.hopper, this.cadSlots, shownFuel(s.hopper, this.cadSlots.length, this.spec.hopperCapacity));
        }
        const d = this.heldTarget - this.heldOpen;
        this.heldOpen += dt > 0 ? Math.sign(d) * Math.min(Math.abs(d), dt * 2.5) : d;
      }
      m.intake = Math.max(e, this.heldOpen);
      m.hood = THREE.MathUtils.clamp((s.hoodAngle * 180 / Math.PI - sh.minAngle) / Math.max(1, sh.maxAngle - sh.minAngle), 0, 1);
      // La turret del rig va en el marco del CAD, girado `yawDeg` respecto al frente del simulador
      // (971: 180°, 5000: −90°): sin restarlo, la turret apuntaba al revés de hacia donde tiraba
      m.turret = s.turretYaw - ((this.rig.yawDeg ?? 0) * Math.PI) / 180;
      m.climb = s.climb ?? 0;
      m.spin = s.flywheelSpin * 0.08;
      this.applyMech();
    }
    if (this.intakeMode === 'pivot') this.intakeArm.rotation.z = this.stowAngle + (this.deployAngle - this.stowAngle) * e;
    else this.intake.position.set(this.rackStow.x + (this.rackDeploy.x - this.rackStow.x) * e, this.rackStow.y + (this.rackDeploy.y - this.rackStow.y) * e, 0);
    for (const r of this.intakeRollers) r.rotation.z = -s.intakeSpin;
    this.turret.rotation.y = s.turretYaw;
    this.hood.rotation.z = Math.max(-0.3, Math.min(0.5, (s.hoodAngle - Math.PI / 3) * 0.8));
    for (const f of this.flywheels) f.rotation.z = -s.flywheelSpin;
    for (const c of this.climberInners) c.position.y = BUMPER_TOP + s.climbHeight;
    for (const w of this.wheels) w.rotation.y = this.spec.drivetrain === 'swerve' ? s.wheelYaw : 0;
    for (const w of this.wheelSpinners) w.rotation.z = -s.wheelSpin;
    if (this.rig?.hopper) {
      // aceleración del robot (posición interpolada del grupo), suavizada
      const pos = this.group.getWorldPosition(new THREE.Vector3());
      if (dt > 1e-4 && Number.isFinite(this.lastPos.x)) {
        const vel = pos.clone().sub(this.lastPos).divideScalar(dt);
        if (vel.lengthSq() > 100) vel.set(0, 0, 0); // teletransporte (reinicio)
        const acc = vel.clone().sub(this.lastVel).divideScalar(dt);
        acc.y = 0;
        this.accel.lerp(acc, Math.min(1, dt * 12));
        this.lastVel.copy(vel);
      }
      this.lastPos.copy(pos);
      this.fillCadHopper(s.hopper, this.mech.intake, dt);
    }
    else {
      const n = shownFuel(s.hopper, this.hopperSlots.length, this.spec.hopperCapacity);
      if (this.hopperBalls.count !== n) this.hopperBalls.count = n;
    }
    this.led.emissiveIntensity = s.enabled ? 2.4 : 0.7;
    // RSL: parpadea cuando está habilitado, fija cuando no
    this.rsl.emissiveIntensity = s.enabled ? (Math.floor(time * 2.5) % 2 ? 3 : 0.3) : 2;
  }
}

/** Placa cuadrada de esquinas redondeadas (lado `a`, espesor `t`, radio `r`), horizontal. */
function roundedSquare(a: number, t: number, r: number): THREE.BufferGeometry {
  const h = a / 2;
  const s = new THREE.Shape();
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r);
  s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r);
  s.quadraticCurveTo(-h, -h, -h + r, -h);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  return g;
}


const modelCache = new Map<string, Promise<THREE.Group>>();
let gltfLoader: GLTFLoader | null = null;

/** Descarga (una vez) el GLB de un robot desde public/robots/. */
export function loadRobotModel(file: string): Promise<THREE.Group> {
  let p = modelCache.get(file);
  if (!p) {
    if (!gltfLoader) {
      gltfLoader = new GLTFLoader();
      gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    }
    const url = new URL(`robots/${file}`, document.baseURI).href;
    p = gltfLoader.loadAsync(url).then((g) => creaseNormals(g.scene).then(() => g.scene));
    modelCache.set(file, p);
  }
  return p;
}

/**
 * Los GLB de robots vienen soldados y sin normales (pesan un tercio): se calculan aquí con
 * ángulo de pliegue de 40° (superficies curvas suaves, aristas vivas), en tramos cortos para
 * no congelar la pantalla.
 */
async function creaseNormals(scene: THREE.Object3D): Promise<void> {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.geometry.getAttribute('normal')) meshes.push(m);
  });
  let slice = performance.now();
  for (const m of meshes) {
    // Cede el hilo cada ~15 ms de trabajo (no por malla: cada pausa espera un frame entero)
    if (performance.now() - slice > 15) {
      await new Promise((r) => setTimeout(r, 0));
      slice = performance.now();
    }
    const g = creaseGeometry(m.geometry, (40 * Math.PI) / 180);
    m.geometry.dispose();
    m.geometry = g;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat.transparent) mat.depthWrite = false;
  }
}

/**
 * Normales con ángulo de pliegue sobre una malla indexada y soldada: cada esquina promedia
 * (por área) las caras vecinas cuya normal difiere menos que `angle` de la suya; las esquinas
 * de un vértice con la misma normal se comparten. Con arreglos planos (lineal en caras), a
 * diferencia de BufferGeometryUtils.toCreasedNormals, que es lento con 100k+ triángulos.
 */
export function creaseGeometry(geo: THREE.BufferGeometry, angle: number): THREE.BufferGeometry {
  const pa = geo.getAttribute('position');
  const nv = pa.count;
  const P = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    P[i * 3] = pa.getX(i);
    P[i * 3 + 1] = pa.getY(i);
    P[i * 3 + 2] = pa.getZ(i);
  }
  const src = geo.getIndex();
  const I = src ? Uint32Array.from(src.array as ArrayLike<number>) : Uint32Array.from({ length: nv }, (_, i) => i);
  const nf = Math.floor(I.length / 3);
  // Normales de cara: sin normalizar (peso = área) y unitarias
  const FN = new Float32Array(nf * 3);
  const FU = new Float32Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    const a = I[f * 3] * 3;
    const b = I[f * 3 + 1] * 3;
    const c = I[f * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    FN[f * 3] = nx;
    FN[f * 3 + 1] = ny;
    FN[f * 3 + 2] = nz;
    FU[f * 3] = nx / l;
    FU[f * 3 + 1] = ny / l;
    FU[f * 3 + 2] = nz / l;
  }
  // Caras por vértice (CSR)
  const start = new Uint32Array(nv + 1);
  for (let k = 0; k < nf * 3; k++) start[I[k] + 1]++;
  for (let i = 0; i < nv; i++) start[i + 1] += start[i];
  const fill = start.slice(0, nv);
  const adj = new Uint32Array(nf * 3);
  for (let k = 0; k < nf * 3; k++) adj[fill[I[k]]++] = (k / 3) | 0;
  const cos = Math.cos(angle);
  const outP: number[] = [];
  const outN: number[] = [];
  const outI = new Uint32Array(nf * 3);
  // Esquinas ya emitidas por vértice: lista enlazada de (normal, índice nuevo)
  const head = new Int32Array(nv).fill(-1);
  const next: number[] = [];
  for (let f = 0; f < nf; f++) {
    const ux = FU[f * 3], uy = FU[f * 3 + 1], uz = FU[f * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const v = I[f * 3 + k];
      let nx = 0, ny = 0, nz = 0;
      for (let j = start[v]; j < start[v + 1]; j++) {
        const g = adj[j];
        if (ux * FU[g * 3] + uy * FU[g * 3 + 1] + uz * FU[g * 3 + 2] >= cos) {
          nx += FN[g * 3];
          ny += FN[g * 3 + 1];
          nz += FN[g * 3 + 2];
        }
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      let found = -1;
      for (let e = head[v]; e >= 0; e = next[e]) {
        if (outN[e * 3] * nx + outN[e * 3 + 1] * ny + outN[e * 3 + 2] * nz > 0.9995) {
          found = e;
          break;
        }
      }
      if (found < 0) {
        found = outP.length / 3;
        outP.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        outN.push(nx, ny, nz);
        next.push(head[v]);
        head[v] = found;
      }
      outI[f * 3 + k] = found;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(outP, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(outN, 3));
  out.setIndex(new THREE.BufferAttribute(outP.length / 3 > 65535 ? outI : Uint16Array.from(outI), 1));
  out.computeBoundingSphere();
  return out;
}
