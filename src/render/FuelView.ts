/**
 * Todos los FUEL en un solo InstancedMesh. Las matrices se escriben directo en el buffer
 * (traslación + escala uniforme; la pelota es una esfera mate y su giro no se aprecia).
 * Los FUEL guardados en CORRAL/CHUTE se dibujan en posiciones "de exhibición" para que se
 * vean acumulados detrás de la pared.
 */
import * as THREE from 'three';
import * as F from '../config/field';
import type { Alliance } from '../core/types';
import { FuelState, type FuelSystem } from '../physics/FuelSystem';

export class FuelView {
  readonly mesh: THREE.InstancedMesh;
  private arr: Float32Array;

  constructor(
    private fuel: FuelSystem,
    detail: number,
  ) {
    const geo = new THREE.IcosahedronGeometry(F.FUEL_RADIUS, detail);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, fuel.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'fuel';
    this.arr = this.mesh.instanceMatrix.array as Float32Array;
    const base = new THREE.Color(0xf4c20d);
    const c = new THREE.Color();
    for (let i = 0; i < fuel.count; i++) {
      // Ligera variación de tono/brillo (espuma usada vs nueva)
      const v = fuel.color[i];
      c.copy(base).offsetHSL((v - 0.5) * 0.025, (v - 0.5) * 0.12, (v - 0.5) * 0.08);
      this.mesh.setColorAt(i, c);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  setShadows(cast: boolean): void {
    this.mesh.castShadow = cast;
    this.mesh.receiveShadow = true;
  }

  /** @param alpha fracción de interpolación entre el paso anterior y el actual. */
  update(alpha: number): void {
    const f = this.fuel;
    const a = this.arr;
    const p = f.pos;
    const q = f.prev;
    const shown: Record<string, Map<number, number>> = {};
    const slot = (a2: Alliance, kind: 'corral' | 'chute', i: number): number => {
      const k = kind + a2;
      let m = shown[k];
      if (!m) {
        m = shown[k] = new Map();
        f[kind][a2].forEach((idx, n) => m!.set(idx, n));
      }
      return m.get(i) ?? 0;
    };
    for (let i = 0; i < f.count; i++) {
      const o = i * 16;
      const st = f.state[i];
      let x = 0;
      let y = 0;
      let z = 0;
      let s = 1;
      if (st === FuelState.Field) {
        const k = i * 3;
        x = q[k] + (p[k] - q[k]) * alpha;
        y = q[k + 1] + (p[k + 1] - q[k + 1]) * alpha;
        z = q[k + 2] + (p[k + 2] - q[k + 2]) * alpha;
      } else if (st === FuelState.Corral || st === FuelState.Chute) {
        const al: Alliance = f.owner[i] === 0 ? 'red' : 'blue';
        const n = slot(al, st === FuelState.Corral ? 'corral' : 'chute', i);
        const pos = st === FuelState.Corral ? corralDisplay(al, n) : chuteDisplay(al, n);
        x = pos.x;
        y = pos.y;
        z = pos.z;
      } else {
        s = 0;
        y = -10;
      }
      a[o] = s;
      a[o + 1] = 0;
      a[o + 2] = 0;
      a[o + 3] = 0;
      a[o + 4] = 0;
      a[o + 5] = s;
      a[o + 6] = 0;
      a[o + 7] = 0;
      a[o + 8] = 0;
      a[o + 9] = 0;
      a[o + 10] = s;
      a[o + 11] = 0;
      a[o + 12] = x;
      a[o + 13] = y;
      a[o + 14] = z;
      a[o + 15] = 1;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Posición de exhibición del n-ésimo FUEL en el CORRAL (6 × 6, apilado). */
export function corralDisplay(a: Alliance, n: number): { x: number; y: number; z: number } {
  const o = F.outpostInfo(a);
  const s = F.allianceSign(a);
  const d = F.FUEL_DIAMETER * 1.02;
  const layer = Math.floor(n / 36);
  const k = n % 36;
  const r = Math.floor(k / 6);
  const c = k % 6;
  const sz = a === 'blue' ? 1 : -1;
  return {
    x: o.x + s * (0.06 + 0.08 + r * d + (layer ? d / 2 : 0)),
    y: F.FUEL_RADIUS + layer * d * 0.8,
    z: o.z + sz * ((c - 2.5) * d + (layer ? d / 2 : 0)),
  };
}

/** Posición de exhibición del n-ésimo FUEL en la CHUTE (túnel inclinado 15° tras la pared). */
export function chuteDisplay(a: Alliance, n: number): { x: number; y: number; z: number } {
  const o = F.outpostInfo(a);
  const s = F.allianceSign(a);
  const d = F.FUEL_DIAMETER * 1.02;
  const perRow = 5;
  const r = Math.floor(n / perRow);
  const c = n % perRow;
  const along = 0.1 + r * d;
  const sz = a === 'blue' ? 1 : -1;
  return {
    x: o.x + s * (0.06 + along * Math.cos((15 * Math.PI) / 180)),
    y: F.CHUTE_OPEN_BOTTOM + F.FUEL_RADIUS + along * Math.sin((15 * Math.PI) / 180),
    z: o.z + sz * (c - 2) * d,
  };
}
