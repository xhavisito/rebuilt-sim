/**
 * Geometría visual del campo. Las piezas de `fieldParts()` se agrupan por material y se
 * fusionan (pocas draw calls). Se agregan detalles solo visuales: alfombra, cintas,
 * AprilTags, el HUB (HubModel), letreros de equipo, LED stacks, repisas.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import * as F from '../config/field';
import { fieldParts, type FieldPart, type MatKey } from '../config/fieldLayout';
import type { Alliance, HubLight } from '../core/types';
import { aprilTagAtlas } from './apriltag';
import { HubModel } from './HubModel';
import { carpetTexture, diamondPlate, netTexture, orangePeelBump, textTexture } from './textures';

/** Intensidad emisiva de las barras DMX (alta para que el bloom por luminancia las tome). */
const E = 6;

export const ALLIANCE_COLOR: Record<Alliance, number> = { red: 0xd32f2f, blue: 0x1e66d0 };

/** Proyección de UVs por caja según la normal dominante (escala en metros por repetición). */
function boxUV(g: THREE.BufferGeometry, scale = 1): void {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else if (ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv[i * 2] = u / scale;
    uv[i * 2 + 1] = v / scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function partGeometry(p: FieldPart): THREE.BufferGeometry {
  const s = p.shape;
  let g: THREE.BufferGeometry;
  if (s.type === 'box') g = new THREE.BoxGeometry(s.hx * 2, s.hy * 2, s.hz * 2);
  else if (s.type === 'hull') {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < s.points.length; i += 3) pts.push(new THREE.Vector3(s.points[i], s.points[i + 1], s.points[i + 2]));
    g = new ConvexGeometry(pts);
  } else {
    g = new THREE.CylinderGeometry(s.r, s.r, s.hh * 2, 14);
    if (s.axis === 'z') g.rotateX(Math.PI / 2);
    else if (s.axis === 'x') g.rotateZ(Math.PI / 2);
  }
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('uv');
  g.translate(p.pos[0], p.pos[1], p.pos[2]);
  return g;
}

export interface HubLightHandle {
  material: THREE.MeshStandardMaterial;
  state: HubLight;
}

export class FieldView {
  readonly group = new THREE.Group();
  readonly hubLights: Record<Alliance, HubLightHandle>;
  private signs: Record<Alliance, THREE.Mesh[]> = { red: [], blue: [] };
  private leds: Record<Alliance, THREE.MeshStandardMaterial[]> = { red: [], blue: [] };
  private timerMesh: THREE.Mesh[] = [];
  private lastTimer = '';

  constructor() {
    this.group.name = 'field';
    this.buildFloor();
    this.buildParts();
    this.buildTape();
    this.buildAprilTags();
    this.hubLights = { red: this.buildHub('red'), blue: this.buildHub('blue') };
    for (const a of ['red', 'blue'] as Alliance[]) this.buildDriverStationDetails(a);
  }

  // ------------------------------------------------------------------ materiales
  private materials = new Map<string, THREE.Material>();
  private mat(key: MatKey, alliance?: Alliance): THREE.Material {
    const k = `${key}:${alliance ?? ''}`;
    const hit = this.materials.get(k);
    if (hit) return hit;
    const ac = alliance ? ALLIANCE_COLOR[alliance] : 0x888888;
    let m: THREE.Material;
    switch (key) {
      case 'rail':
        m = new THREE.MeshStandardMaterial({ color: 0xb9bdc4, metalness: 0.6, roughness: 0.5 });
        break;
      case 'poly':
        m = new THREE.MeshStandardMaterial({
          color: 0xdde8f0,
          metalness: 0,
          roughness: 0.04,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
          envMapIntensity: 1.0,
        });
        break;
      case 'alu':
        m = new THREE.MeshStandardMaterial({ color: 0xc5c9cf, metalness: 0.5, roughness: 0.55 });
        break;
      case 'steel':
        m = new THREE.MeshStandardMaterial({ color: 0x70757d, metalness: 0.6, roughness: 0.5 });
        break;
      case 'dark':
        m = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.8 });
        break;
      case 'diamond': {
        const d = diamondPlate();
        m = new THREE.MeshStandardMaterial({ map: d.map, bumpMap: d.bump, bumpScale: 1.5, metalness: 0.7, roughness: 0.4 });
        break;
      }
      case 'hubBody':
        m = new THREE.MeshStandardMaterial({ color: 0x3b4049, metalness: 0.3, roughness: 0.55 });
        break;
      case 'hubTop':
        // parte alta del HUB: policarbonato claro (se ven el embudo y el FUEL adentro)
        m = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0, roughness: 0.15, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
        break;
      case 'net':
        m = new THREE.MeshStandardMaterial({
          map: netTexture(),
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          roughness: 0.9,
        });
        break;
      case 'hdpeA':
        m = new THREE.MeshStandardMaterial({ color: ac, roughness: 0.55, bumpMap: orangePeelBump(), bumpScale: 0.6 });
        break;
      case 'panelA':
        // paneles de policarbonato teñidos con el color de alianza (dentro de un marco de aluminio)
        m = new THREE.MeshStandardMaterial({ color: ac, metalness: 0, roughness: 0.25, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
        break;
      case 'towerA':
        m = new THREE.MeshStandardMaterial({ color: ac, metalness: 0.25, roughness: 0.42 });
        break;
      case 'baseplate':
        m = new THREE.MeshStandardMaterial({ color: 0x3e4249, metalness: 0.6, roughness: 0.55 });
        break;
      default:
        m = new THREE.MeshBasicMaterial({ visible: false });
    }
    this.materials.set(k, m);
    return m;
  }

  // ------------------------------------------------------------------ piso
  private buildFloor(): void {
    const c = carpetTexture();
    const carpet = new THREE.Mesh(
      new THREE.PlaneGeometry(F.FIELD_LENGTH + 0.12, F.FIELD_WIDTH + 0.06),
      new THREE.MeshStandardMaterial({ map: c.map, bumpMap: c.bump, bumpScale: 0.4, roughness: 0.96, metalness: 0 }),
    );
    carpet.rotation.x = -Math.PI / 2;
    carpet.receiveShadow = true;
    carpet.name = 'carpet';
    this.group.add(carpet);
    // Piso del recinto (fuera del campo) y ALLIANCE AREAS
    const outside = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 40),
      new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.55, metalness: 0.1 }), // concreto pulido
    );
    outside.rotation.x = -Math.PI / 2;
    outside.position.y = -0.004;
    outside.receiveShadow = true;
    this.group.add(outside);
    for (const a of ['red', 'blue'] as Alliance[]) {
      const area = new THREE.Mesh(
        new THREE.PlaneGeometry(F.ALLIANCE_AREA_DEPTH, F.FIELD_WIDTH + 1.0),
        new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.95 }),
      );
      area.rotation.x = -Math.PI / 2;
      area.position.set(F.allianceSign(a) * (F.HALF_L + 0.06 + F.ALLIANCE_AREA_DEPTH / 2), -0.002, 0);
      area.receiveShadow = true;
      this.group.add(area);
    }
  }

  // ------------------------------------------------------------------ estructuras
  private buildParts(): void {
    const groups = new Map<string, { geos: THREE.BufferGeometry[]; mat: MatKey; alliance?: Alliance; shadow: boolean }>();
    for (const p of fieldParts()) {
      if (p.mat === 'invisible') continue;
      const allianceKey = p.mat === 'hdpeA' || p.mat === 'panelA' || p.mat === 'towerA' ? p.alliance : undefined;
      const key = `${p.mat}:${allianceKey ?? ''}:${p.shadow !== false}`;
      let gr = groups.get(key);
      if (!gr) groups.set(key, (gr = { geos: [], mat: p.mat, alliance: allianceKey, shadow: p.shadow !== false }));
      gr.geos.push(partGeometry(p));
    }
    for (const gr of groups.values()) {
      const merged = mergeGeometries(gr.geos, false);
      if (!merged) continue;
      boxUV(merged, gr.mat === 'hdpeA' ? 0.6 : 0.5);
      const mesh = new THREE.Mesh(merged, this.mat(gr.mat, gr.alliance));
      const transparent = gr.mat === 'poly' || gr.mat === 'net' || gr.mat === 'panelA' || gr.mat === 'hubTop';
      mesh.castShadow = gr.shadow && !transparent;
      mesh.receiveShadow = !transparent;
      mesh.renderOrder = transparent ? 2 : 0;
      mesh.name = `field-${gr.mat}`;
      this.group.add(mesh);
    }
    // Marco de aluminio: tubos en las aristas de los paneles (look de estructura real)
    const frame: THREE.BufferGeometry[] = [];
    const tube = F.inch(1.2);
    const edgeTubes = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number) => {
      for (const sy of [-1, 1]) for (const sz of [-1, 1]) frame.push(new THREE.BoxGeometry(2 * hx + tube, tube, tube).translate(cx, cy + sy * hy, cz + sz * hz));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame.push(new THREE.BoxGeometry(tube, 2 * hy, tube).translate(cx + sx * hx, cy, cz + sz * hz));
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) frame.push(new THREE.BoxGeometry(tube, tube, 2 * hz + tube).translate(cx + sx * hx, cy + sy * hy, cz));
    };
    for (const p of fieldParts()) {
      if (p.shape.type !== 'box' || p.mat !== 'panelA') continue;
      const { hx, hy, hz } = p.shape;
      if (Math.min(hx, hy, hz) * 2 < F.inch(3) && Math.max(hx, hz) * 2 < F.inch(3)) continue;
      if (hy * 2 < F.inch(3)) continue;
      edgeTubes(p.pos[0], p.pos[1], p.pos[2], Math.max(hx, tube / 2), hy, Math.max(hz, tube / 2));
    }
    const frameMesh = new THREE.Mesh(mergeGeometries(frame.map((g) => g.toNonIndexed()))!, this.mat('alu'));
    frameMesh.castShadow = true;
    frameMesh.receiveShadow = true;
    frameMesh.name = 'field-frame';
    this.group.add(frameMesh);
  }

  // ------------------------------------------------------------------ cintas
  private buildTape(): void {
    const tape = (x0: number, x1: number, z0: number, z1: number, color: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0)),
        new THREE.MeshStandardMaterial({ color, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, 0.0015, (z0 + z1) / 2);
      m.receiveShadow = true;
      this.group.add(m);
    };
    // CENTER LINE (blanca)
    tape(-F.TAPE_WIDTH / 2, F.TAPE_WIDTH / 2, -F.HALF_W, F.HALF_W, 0xf0f0f0);
    for (const a of ['red', 'blue'] as Alliance[]) {
      const s = F.allianceSign(a);
      const lx = s * Math.abs(F.STARTING_LINE_X_BLUE);
      // ROBOT STARTING LINE: la cinta queda dentro de la ALLIANCE ZONE
      tape(lx, lx + s * F.TAPE_WIDTH, -F.HALF_W, F.HALF_W, ALLIANCE_COLOR[a]);
      // HUMAN STARTING LINE (en la ALLIANCE AREA, 24 in de la pared)
      const hx = s * (F.HALF_L + 0.06 + F.HUMAN_STARTING_LINE_DIST);
      tape(hx, hx + s * F.TAPE_WIDTH, -F.HALF_W - 0.4, F.HALF_W + 0.4, 0xf0f0f0);
      // Línea de la OUTPOST AREA (color de alianza, perpendicular a la pared)
      // (el OUTPOST azul está del lado +Z; el rojo, rotado, del lado −Z)
      const edge = (a === 'blue' ? 1 : -1) * (F.HALF_W - F.OUTPOST_AREA_WIDTH);
      tape(s * (F.HALF_L + 0.06), s * (F.HALF_L + 0.06 + F.ALLIANCE_AREA_DEPTH), edge - 0.025, edge + 0.025, ALLIANCE_COLOR[a]);
    }
  }

  // ------------------------------------------------------------------ AprilTags
  private buildAprilTags(): void {
    // Los 32 tags en una sola malla con un atlas (1 draw call)
    const atlas = aprilTagAtlas();
    const geos: THREE.BufferGeometry[] = [];
    for (const [id, x, y, z, yaw] of F.APRILTAGS_IN) {
      const p = F.wpiToWorld(x, y);
      const r = (yaw * Math.PI) / 180;
      const dir = new THREE.Vector3(Math.cos(r), 0, -Math.sin(r));
      const g = new THREE.PlaneGeometry(F.APRILTAG_PANEL, F.APRILTAG_PANEL);
      const [u0, v0, u1, v1] = atlas.uv(id);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
      g.rotateY(Math.atan2(dir.x, dir.z));
      g.translate(p.x + dir.x * 0.004, F.inch(z), p.z + dir.z * 0.004);
      geos.push(g);
    }
    const m = new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.6 }));
    m.name = 'apriltags';
    this.group.add(m);
  }

  // ------------------------------------------------------------------ HUB
  private buildHub(a: Alliance): HubLightHandle {
    const hub = new HubModel(a, ALLIANCE_COLOR[a]);
    this.group.add(hub.group);
    return { material: hub.lightMaterial, state: 'off' };
  }

  /**
   * Actualiza el color/intensidad de las luces del HUB (Tabla 5-3).
   * @param t tiempo en segundos (para pulsos y persecución)
   */
  setHubLight(a: Alliance, state: HubLight, t: number): void {
    const h = this.hubLights[a];
    h.state = state;
    const m = h.material;
    const ac = ALLIANCE_COLOR[a];
    switch (state) {
      case 'off':
        m.emissive.setHex(ac);
        m.emissiveIntensity = 0.0;
        break;
      case 'active':
        m.emissive.setHex(ac);
        m.emissiveIntensity = E;
        break;
      case 'pulse':
        m.emissive.setHex(ac);
        m.emissiveIntensity = E * (0.12 + 0.88 * (0.5 + 0.5 * Math.sin(t * Math.PI * 4)));
        break;
      case 'chase': {
        // Persecución blanca: alterna color de alianza y blanco
        const phase = (t * 3) % 1;
        m.emissive.setHex(phase < 0.35 ? 0xffffff : ac);
        m.emissiveIntensity = phase < 0.35 ? 2.2 : E;
        break;
      }
      case 'white':
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 2.2;
        break;
      case 'purple':
        m.emissive.setHex(0x9c27b0);
        m.emissiveIntensity = E * 0.7;
        break;
      case 'green':
        m.emissive.setHex(0x2ecc40);
        m.emissiveIntensity = E * 0.5;
        break;
    }
  }

  // ------------------------------------------------------------------ DRIVER STATIONS
  private buildDriverStationDetails(a: Alliance): void {
    const s = F.allianceSign(a);
    const shelves: THREE.BufferGeometry[] = [];
    const signBoxes: THREE.BufferGeometry[] = [];
    const statusLeds: THREE.BufferGeometry[] = [];
    const amberLeds: THREE.BufferGeometry[] = [];
    const yRot = a === 'blue' ? Math.PI / 2 : -Math.PI / 2;
    for (const ds of [1, 2, 3] as const) {
      const c = F.driverStationCenter(a, ds);
      const [y0, y1] = F.DS_RANGES_Y_IN[ds];
      const w = F.inch(y1 - y0);
      // Repisa (lado de la ALLIANCE AREA)
      shelves.push(
        new THREE.BoxGeometry(F.DS_SHELF_DEPTH, 0.025, Math.min(w, F.inch(69))).translate(c.x + s * (0.06 + F.DS_SHELF_DEPTH / 2), F.DS_BASE_HEIGHT, c.z),
      );
      // Letrero de equipo (cara al campo con número en color de alianza)
      signBoxes.push(new THREE.BoxGeometry(0.04, 0.22, 0.62).translate(c.x + s * 0.02, F.DS_TOTAL_HEIGHT + 0.18, c.z));
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.2),
        new THREE.MeshBasicMaterial({ map: textTexture('----', { fg: '#' + ALLIANCE_COLOR[a].toString(16).padStart(6, '0') }) }),
      );
      face.position.set(c.x - s * 0.001, F.DS_TOTAL_HEIGHT + 0.18, c.z);
      face.rotation.y = yRot;
      this.group.add(face);
      this.signs[a].push(face);
      // LED stack: 2 LEDs de alianza + 1 ámbar
      for (let k = 0; k < 3; k++) {
        const g = new THREE.CylinderGeometry(0.03, 0.03, 0.05, 10).translate(c.x + s * 0.02, F.DS_TOTAL_HEIGHT + 0.32 + k * 0.055, c.z);
        (k < 2 ? statusLeds : amberLeds).push(g);
      }
      // Timer (solo DS2)
      if (ds === 2) {
        const tm = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), new THREE.MeshBasicMaterial({ map: textTexture('0:00') }));
        tm.position.set(c.x - s * 0.002, F.DS_TOTAL_HEIGHT + 0.48, c.z);
        tm.rotation.y = yRot;
        this.group.add(tm);
        this.timerMesh.push(tm);
      }
    }
    const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, shadow = false) => {
      const m = new THREE.Mesh(mergeGeometries(geos)!, mat);
      m.castShadow = shadow;
      this.group.add(m);
    };
    add(shelves, this.mat('alu'), true);
    add(signBoxes, this.mat('dark'));
    const led = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: ALLIANCE_COLOR[a], emissiveIntensity: 1.5 });
    add(statusLeds, led);
    add(amberLeds, new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffa000, emissiveIntensity: 0 }));
    this.leds[a].push(led);
  }

  /** Pone los números de equipo en los letreros (DS1..3). */
  setTeamNumbers(a: Alliance, numbers: number[]): void {
    const fg = '#' + ALLIANCE_COLOR[a].toString(16).padStart(6, '0');
    this.signs[a].forEach((m, i) => {
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.map = textTexture(numbers[i] ? String(numbers[i]) : '', { fg });
      mat.needsUpdate = true;
    });
  }

  /** Actualiza el timer físico de la DRIVER STATION 2 (texto blanco hacia el campo). */
  setTimer(text: string): void {
    if (text === this.lastTimer) return;
    this.lastTimer = text;
    for (const m of this.timerMesh) {
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.map = textTexture(text, { w: 192, h: 72 });
      mat.needsUpdate = true;
    }
  }

  /** LED de estado: encendido sólido durante el match. */
  setLeds(enabled: boolean): void {
    for (const a of ['red', 'blue'] as Alliance[]) for (const m of this.leds[a]) m.emissiveIntensity = enabled ? 1.8 : 0.15;
  }
}
