/**
 * Guía de tiro del jugador: la trayectoria que seguiría el siguiente FUEL (mismo modelo de
 * gravedad + arrastre + Magnus que FuelSystem) y un aro donde cae. Verde = entra al HUB
 * activo, amarillo = entra pero el HUB está inactivo, blanco = no entra / fuera de alcance.
 */
import * as THREE from 'three';
import * as F from '../config/field';
import type { Vec3 } from '../physics/ballistics';

const N = 90;
const DT = 1 / 60;
const G = 9.81;
const MASS = (F.FUEL_MASS_MIN + F.FUEL_MASS_MAX) / 2;
const AREA = Math.PI * F.FUEL_RADIUS * F.FUEL_RADIUS;
const KD = (0.5 * 1.2 * 0.47 * AREA) / MASS;
const KM = (0.25 * 1.2 * AREA * F.FUEL_RADIUS) / MASS;

export type AimVerdict = 'in' | 'inactive' | 'miss';

const COLORS: Record<AimVerdict, number> = { in: 0x3ddc84, inactive: 0xf5c518, miss: 0xe8e8e8 };

/** Textura de un punto redondo con borde suave (compartida). */
let dotTex: THREE.Texture | null = null;
function dotTexture(): THREE.Texture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

export class AimGuide {
  readonly group = new THREE.Group();
  /** Puntos a lo largo de la trayectoria (uno cada 2 pasos de simulación). */
  private dots: THREE.Points;
  private ring: THREE.Mesh;
  private pos = new Float32Array(N * 3);
  private dotPos = new Float32Array(N * 3);
  private dotMat: THREE.PointsMaterial;
  private ringMat: THREE.MeshBasicMaterial;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dotPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.dotMat = new THREE.PointsMaterial({ size: 0.07, map: dotTexture(), transparent: true, depthWrite: false, alphaTest: 0.05 });
    this.dots = new THREE.Points(geo, this.dotMat);
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 5;
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.15, 32).rotateX(-Math.PI / 2), this.ringMat);
    this.ring.renderOrder = 5;
    this.group.add(this.dots, this.ring);
    this.group.visible = false;
  }

  hide(): void {
    this.group.visible = false;
  }

  /**
   * Simula y dibuja el tiro.
   * @param hub HUB al que se apunta (para decidir si entra); null = pase.
   * @param strong true mientras el jugador dispara (más opaco).
   */
  show(from: Vec3, vel: Vec3, spin: Vec3, hub: { x: number; z: number; active: boolean } | null, strong: boolean): AimVerdict {
    let { x, y, z } = from;
    let vx = vel.x;
    let vy = vel.y;
    let vz = vel.z;
    const p = this.pos;
    let n = 0;
    let verdict: AimVerdict = 'miss';
    const r = F.HUB_OPENING_HEX / 2 - F.FUEL_RADIUS;
    for (; n < N; n++) {
      p[n * 3] = x;
      p[n * 3 + 1] = y;
      p[n * 3 + 2] = z;
      const v = Math.hypot(vx, vy, vz);
      const ax = -KD * v * vx + KM * (spin.y * vz - spin.z * vy);
      const ay = -G - KD * v * vy + KM * (spin.z * vx - spin.x * vz);
      const az = -KD * v * vz + KM * (spin.x * vy - spin.y * vx);
      const ny = y + vy * DT;
      // Cruza la abertura del HUB bajando: entra
      if (hub && vy < 0 && y >= F.HUB_RIM_HEIGHT && ny < F.HUB_RIM_HEIGHT && Math.hypot(x - hub.x, z - hub.z) < r) {
        verdict = hub.active ? 'in' : 'inactive';
        n++;
        break;
      }
      // Choca con el cuerpo del HUB (caja de 47 in hasta el borde)
      if (hub && ny < F.HUB_RIM_HEIGHT && Math.abs(x - hub.x) < F.HUB_SIZE / 2 && Math.abs(z - hub.z) < F.HUB_SIZE / 2) {
        n++;
        break;
      }
      if (ny < F.FUEL_RADIUS) {
        const f = (y - F.FUEL_RADIUS) / Math.max(1e-6, y - ny);
        x += vx * DT * f;
        y = F.FUEL_RADIUS;
        z += vz * DT * f;
        p[(n + 1) * 3] = x;
        p[(n + 1) * 3 + 1] = y;
        p[(n + 1) * 3 + 2] = z;
        n += 2;
        break;
      }
      x += vx * DT;
      y = ny;
      z += vz * DT;
      vx += ax * DT;
      vy += ay * DT;
      vz += az * DT;
    }
    n = Math.min(n, N);
    // Un punto cada 2 pasos (≈ 15–20 cm a velocidad de tiro), sin el primero (dentro del robot)
    let m = 0;
    for (let k = 2; k < n; k += 2, m++) this.dotPos.set(p.subarray(k * 3, k * 3 + 3), m * 3);
    const geo = this.dots.geometry;
    geo.setDrawRange(0, m);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    const color = hub ? COLORS[verdict] : 0x8fd3ff;
    this.dotMat.color.setHex(color);
    this.dotMat.opacity = strong ? 0.95 : 0.6;
    this.ringMat.color.setHex(color);
    this.ringMat.opacity = strong ? 0.9 : 0.6;
    const last = (n - 1) * 3;
    this.ring.position.set(p[last], verdict === 'miss' || !hub ? 0.01 : p[last + 1], p[last + 2]);
    this.group.visible = true;
    return verdict;
  }
}
