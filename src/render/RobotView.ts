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
   * Carga el modelo 3D real del equipo (GLB optimizado por scripts/robots/build-models.mjs).
   * Cada archivo se descarga una vez y se clona para cada robot que lo use.
   */
  private loadCad(file: string): Promise<void> {
    return loadRobotModel(file)
      .then((scene) => {
        const m = scene.clone(true);
        m.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          mesh.castShadow = !mat.transparent;
          mesh.receiveShadow = true;
        });
        m.name = 'cad';
        this.group.add(m);
        this.cadLoaded = true;
      })
      .catch((e) => console.warn('robot model', file, e));
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
    if (this.intakeMode === 'pivot') this.intakeArm.rotation.z = this.stowAngle + (this.deployAngle - this.stowAngle) * e;
    else this.intake.position.set(this.rackStow.x + (this.rackDeploy.x - this.rackStow.x) * e, this.rackStow.y + (this.rackDeploy.y - this.rackStow.y) * e, 0);
    for (const r of this.intakeRollers) r.rotation.z = -s.intakeSpin;
    this.turret.rotation.y = s.turretYaw;
    this.hood.rotation.z = Math.max(-0.3, Math.min(0.5, (s.hoodAngle - Math.PI / 3) * 0.8));
    for (const f of this.flywheels) f.rotation.z = -s.flywheelSpin;
    for (const c of this.climberInners) c.position.y = BUMPER_TOP + s.climbHeight;
    for (const w of this.wheels) w.rotation.y = this.spec.drivetrain === 'swerve' ? s.wheelYaw : 0;
    for (const w of this.wheelSpinners) w.rotation.z = -s.wheelSpin;
    const n = Math.min(s.hopper, this.hopperSlots.length);
    if (this.hopperBalls.count !== n) this.hopperBalls.count = n;
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
    p = gltfLoader.loadAsync(url).then((g) => g.scene);
    modelCache.set(file, p);
  }
  return p;
}
