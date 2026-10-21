/**
 * Modelo visual del HUB (§5.4, figs. 5-5, 5-7 y 5-8), sin logos:
 *  - cuerpo de 47 × 47 in: caras hacia las ALLIANCE WALLS en panel negro con gráfico genérico,
 *    caras laterales de marco de aluminio con banda clara (donde van los AprilTags);
 *  - tapa biselada gris con barras de luz DMX en los "top angles" (Tabla 5-3);
 *  - placa color de alianza y, encima, el embudo hexagonal translúcido que abre hasta 72 in;
 *  - red ahumada inclinada hacia la NEUTRAL ZONE con tubos de soporte y riel en U;
 *  - salidas en la base hacia la NEUTRAL ZONE.
 * Ejes locales: +X = hacia la NEUTRAL ZONE (el HUB rojo se gira 180°).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as F from '../config/field';
import type { Alliance } from '../core/types';
import { netTexture } from './textures';

type Bucket = 'black' | 'alu' | 'cap' | 'plate' | 'inner' | 'funnel' | 'smoke' | 'net' | 'steel' | 'graphic' | 'light' | 'slot';

const hs = F.HUB_SIZE / 2;
const Rb = F.HUB_FUNNEL_BOTTOM_R;
const Rt = F.HUB_OPENING_R;
const TUBE = F.inch(1.5);

/** Barra cilíndrica entre dos puntos. */
function bar(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

const boxAt = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);

/** Vértice k de un hexágono con vértices hacia ±X. */
const hexV = (r: number, k: number, y: number) => new THREE.Vector3(r * Math.cos((k * Math.PI) / 3), y, r * Math.sin((k * Math.PI) / 3));

/** Gráfico genérico de los paneles (sin logos): rectángulo azul petróleo con borde punteado y corte en V. */
let graphicTex: THREE.Texture | null = null;
function graphicTexture(): THREE.Texture {
  if (graphicTex) return graphicTex;
  const w = 512;
  const h = 300;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#15171a';
  g.fillRect(0, 0, w, h);
  const shape = () => {
    g.beginPath();
    g.moveTo(20, 20);
    g.lineTo(w - 20, 20);
    g.lineTo(w - 20, h - 20);
    g.lineTo(w / 2, h - 80);
    g.lineTo(20, h - 20);
    g.closePath();
  };
  shape();
  g.fillStyle = '#3f7f8c';
  g.fill();
  g.setLineDash([14, 10]);
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(20,30,34,0.85)';
  g.save();
  g.translate(w / 2, h / 2);
  g.scale(0.94, 0.9);
  g.translate(-w / 2, -h / 2);
  shape();
  g.stroke();
  g.restore();
  g.setLineDash([]);
  g.fillStyle = '#e9eef0';
  g.font = `400 ${Math.round(h * 0.34)}px Anton, Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('HUB', w / 2, h * 0.42);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  graphicTex = t;
  return t;
}

export class HubModel {
  readonly group = new THREE.Group();
  /** Material de las barras DMX (lo anima FieldView.setHubLight). */
  readonly lightMaterial: THREE.MeshStandardMaterial;
  private buckets = new Map<Bucket, THREE.BufferGeometry[]>();

  constructor(
    readonly alliance: Alliance,
    allianceColor: number,
  ) {
    this.lightMaterial = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(allianceColor), emissiveIntensity: 0, roughness: 0.4 });
    this.buildBody();
    this.buildCap();
    this.buildFunnel();
    this.buildNet();
    this.buildExits();
    this.flush(allianceColor);
    const c = F.hubCenter(alliance);
    this.group.position.set(c.x, 0, c.z);
    this.group.rotation.y = alliance === 'blue' ? 0 : Math.PI;
    this.group.name = `hub-${alliance}`;
  }

  private add(b: Bucket, g: THREE.BufferGeometry): void {
    let list = this.buckets.get(b);
    if (!list) this.buckets.set(b, (list = []));
    list.push(g.index ? g.toNonIndexed() : g);
  }

  // ------------------------------------------------------------------ cuerpo
  private buildBody(): void {
    const top = F.HUB_BODY_TOP;
    const base = F.inch(3);
    const inset = 0.006; // las caras quedan justo detrás de los AprilTags
    // Núcleo interior oscuro (se ve entre los rieles de las caras laterales)
    this.add('inner', boxAt(2 * hs - 0.16, top - base, 2 * hs - 0.16, 0, base + (top - base) / 2, 0));
    // Base de acero alrededor (con el corte en V hacia las caras principales)
    this.add('steel', boxAt(2 * hs + 0.004, base, 2 * hs + 0.004, 0, base / 2, 0));
    // Caras hacia las paredes (±X): panel negro de lado a lado
    for (const sx of [-1, 1]) {
      this.add('black', boxAt(0.012, top - base, 2 * hs, sx * (hs - inset - 0.006), base + (top - base) / 2, 0));
      // Gráfico genérico (debajo de los AprilTags)
      const gfx = new THREE.PlaneGeometry(2 * hs - 0.16, 0.5);
      gfx.rotateY(sx > 0 ? Math.PI / 2 : -Math.PI / 2);
      gfx.translate(sx * (hs - inset + 0.001), 0.6, 0);
      this.add('graphic', gfx);
    }
    // Caras laterales (±Z): marco abierto de aluminio con banda clara arriba
    for (const sz of [-1, 1]) {
      const z = sz * (hs - TUBE / 2);
      for (const y of [base + TUBE / 2, 0.42, 0.78]) this.add('alu', boxAt(2 * hs, TUBE, TUBE, 0, y, z));
      this.add('alu', boxAt(2 * hs, TUBE * 0.6, TUBE, 0, 0.6, z)); // riel intermedio delgado
      // banda superior (soporte de los AprilTags)
      this.add('cap', boxAt(2 * hs - 0.01, top - 0.93, 0.012, 0, (0.93 + top) / 2, sz * (hs - inset - 0.006)));
      // diagonales del marco
      this.add('alu', bar(new THREE.Vector3(-hs + 0.05, 0.45, z), new THREE.Vector3(-0.05, 0.76, z), TUBE * 0.35));
      this.add('alu', bar(new THREE.Vector3(hs - 0.05, 0.45, z), new THREE.Vector3(0.05, 0.76, z), TUBE * 0.35));
    }
    // Postes de esquina
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.add('alu', boxAt(TUBE, top, TUBE, sx * (hs - TUBE / 2), top / 2, sz * (hs - TUBE / 2)));
    // Barras de luz DMX: borde superior del cuerpo
    const lt = 0.022;
    for (const s of [-1, 1]) {
      this.add('light', boxAt(2 * hs + lt, lt, lt, 0, top, s * hs));
      this.add('light', boxAt(lt, lt, 2 * hs + lt, s * hs, top, 0));
    }
  }

  // ------------------------------------------------------------------ tapa y placa
  private buildCap(): void {
    const y0 = F.HUB_BODY_TOP;
    const y1 = F.HUB_PLATE_HEIGHT;
    const ht = hs - F.HUB_CAP_INSET;
    // Tronco de pirámide cuadrada (4 caras biseladas)
    const cap = new THREE.CylinderGeometry(ht * Math.SQRT2, hs * Math.SQRT2, y1 - y0, 4, 1, true);
    cap.rotateY(Math.PI / 4);
    cap.translate(0, (y0 + y1) / 2, 0);
    const capFlat = cap.toNonIndexed();
    capFlat.computeVertexNormals();
    this.add('cap', capFlat);
    // Barras de luz en las cuatro aristas del bisel ("top angles")
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) this.add('light', bar(new THREE.Vector3(sx * hs, y0, sz * hs), new THREE.Vector3(sx * ht, y1, sz * ht), 0.014, 6));
    // Placa de color de alianza con el hueco del embudo
    const shape = new THREE.Shape();
    shape.moveTo(-ht, -ht);
    shape.lineTo(ht, -ht);
    shape.lineTo(ht, ht);
    shape.lineTo(-ht, ht);
    shape.closePath();
    const hole = new THREE.Path();
    for (let k = 0; k <= 6; k++) {
      const v = hexV(Rb, k, 0);
      if (k === 0) hole.moveTo(v.x, v.z);
      else hole.lineTo(v.x, v.z);
    }
    shape.holes.push(hole);
    const plate = new THREE.ShapeGeometry(shape);
    plate.rotateX(Math.PI / 2); // (x, y) del Shape → (x, z) del mundo
    plate.translate(0, y1 + 0.002, 0);
    this.add('plate', plate);
    // Garganta oscura bajo el embudo (por donde cae el FUEL al sensor)
    const throat = new THREE.CylinderGeometry(Rb, Rb * 0.92, y1 - F.HUB_INNER_FLOOR, 6, 1, true, Math.PI / 2);
    throat.translate(0, (y1 + F.HUB_INNER_FLOOR) / 2, 0);
    this.add('inner', throat);
    const floor = new THREE.CircleGeometry(Rb, 6);
    floor.rotateX(-Math.PI / 2);
    floor.translate(0, F.HUB_INNER_FLOOR + 0.01, 0);
    this.add('inner', floor);
  }

  // ------------------------------------------------------------------ embudo translúcido
  private buildFunnel(): void {
    const y0 = F.HUB_PLATE_HEIGHT;
    const y1 = F.HUB_RIM_HEIGHT;
    const f = new THREE.CylinderGeometry(Rt, Rb, y1 - y0, 6, 1, true, Math.PI / 2);
    f.translate(0, (y0 + y1) / 2, 0);
    const flat = f.toNonIndexed();
    flat.computeVertexNormals();
    this.add('funnel', flat);
    // Perfiles de aluminio: borde superior, aristas inclinadas y borde inferior
    for (let k = 0; k < 6; k++) {
      this.add('alu', bar(hexV(Rt, k, y1), hexV(Rt, k + 1, y1), 0.014));
      this.add('alu', bar(hexV(Rb, k, y0), hexV(Rt, k, y1), 0.009));
      this.add('alu', bar(hexV(Rb, k, y0 + 0.01), hexV(Rb, k + 1, y0 + 0.01), 0.01));
    }
  }

  // ------------------------------------------------------------------ red trasera
  private buildNet(): void {
    const yb = F.HUB_RIM_HEIGHT - 0.12;
    const yt = F.HUB_NET_TOP;
    const ub = F.HUB_NET_BOTTOM_U;
    const ut = F.HUB_NET_TOP_U;
    const zw = hs + 0.03;
    const quad = () => {
      const g = new THREE.BufferGeometry();
      const p = [ub, yb, -zw, ut, yt, -zw, ut, yt, zw, ub, yb, -zw, ut, yt, zw, ub, yb, zw];
      const uv = [0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0];
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      return g;
    };
    this.add('smoke', quad());
    this.add('net', quad());
    const A = new THREE.Vector3(ub, yb, -zw);
    const B = new THREE.Vector3(ub, yb, zw);
    const C = new THREE.Vector3(ut, yt, zw);
    const D = new THREE.Vector3(ut, yt, -zw);
    for (const [p, q] of [[A, B], [B, C], [C, D], [D, A]]) this.add('alu', bar(p, q, 0.016));
    // Puntales desde lo alto de las caras laterales hasta la punta de la red
    for (const sz of [-1, 1]) {
      this.add('alu', bar(new THREE.Vector3(0.02, F.HUB_BODY_TOP, sz * (hs - 0.02)), new THREE.Vector3(ut, yt, sz * zw), 0.017));
      // pie del puntal
      this.add('alu', boxAt(0.08, 0.1, 0.05, 0.02, F.HUB_BODY_TOP - 0.03, sz * (hs - 0.02)));
    }
    // Riel en U alrededor del embudo, del lado de la red
    const y = F.HUB_PLATE_HEIGHT + 0.14;
    const r = hs + 0.07;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.2, F.HUB_BODY_TOP, r - 0.02),
      new THREE.Vector3(-0.2, y, r),
      new THREE.Vector3(0.45, y, r),
      new THREE.Vector3(r, y, 0.45),
      new THREE.Vector3(r, y, -0.45),
      new THREE.Vector3(0.45, y, -r),
      new THREE.Vector3(-0.2, y, -r),
      new THREE.Vector3(-0.2, F.HUB_BODY_TOP, -r + 0.02),
    ], false, 'catmullrom', 0.2);
    this.add('alu', new THREE.TubeGeometry(curve, 48, 0.016, 8, false));
  }

  // ------------------------------------------------------------------ salidas (fig. 5-8)
  private buildExits(): void {
    // 4 ranuras en la base de la cara hacia la NEUTRAL ZONE, dentro de la huella de 47 in
    // (no sobresale ninguna caja): ranuras oscuras con divisores de acero al ras de la cara
    const h = 0.26;
    for (const z of F.HUB_EXIT_OFFSETS) this.add('slot', boxAt(0.01, 0.2, 0.26, hs + 0.002, 0.13, z));
    for (const z of [-0.6, -0.3, 0, 0.3, 0.6]) this.add('steel', boxAt(0.02, h, 0.03, hs - 0.004, h / 2, z));
    this.add('steel', boxAt(0.02, 0.03, 1.23, hs - 0.004, h, 0));
  }

  // ------------------------------------------------------------------ materiales y mallas
  private flush(allianceColor: number): void {
    const mats: Record<Bucket, THREE.Material> = {
      black: new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.55, metalness: 0.1 }),
      alu: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.6, roughness: 0.42 }),
      cap: new THREE.MeshStandardMaterial({ color: 0xd8dbe0, metalness: 0.15, roughness: 0.5, side: THREE.DoubleSide }),
      plate: new THREE.MeshStandardMaterial({ color: allianceColor, roughness: 0.5, side: THREE.DoubleSide }),
      inner: new THREE.MeshStandardMaterial({ color: 0x24272d, roughness: 0.85, side: THREE.DoubleSide }),
      // Policarbonato esmerilado: se ve el FUEL adentro pero el embudo se distingue bien
      funnel: new THREE.MeshStandardMaterial({
        color: 0xe8ecf0,
        roughness: 0.45,
        metalness: 0,
        transparent: true,
        opacity: 0.62,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      smoke: new THREE.MeshStandardMaterial({ color: 0x1d2026, roughness: 0.3, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      net: new THREE.MeshStandardMaterial({ map: netTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.9 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.6, roughness: 0.45 }),
      graphic: new THREE.MeshStandardMaterial({ map: graphicTexture(), roughness: 0.6 }),
      light: this.lightMaterial,
      slot: new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 1 }),
    };
    for (const [b, geos] of this.buckets) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mats[b]);
      const transparent = b === 'funnel' || b === 'smoke' || b === 'net';
      mesh.castShadow = !transparent && b !== 'light' && b !== 'graphic';
      mesh.receiveShadow = !transparent;
      mesh.renderOrder = transparent ? 3 : 0;
      mesh.name = `hub-${b}`;
      this.group.add(mesh);
    }
    this.buckets.clear();
  }
}
