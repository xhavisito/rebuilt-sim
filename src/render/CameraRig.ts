/**
 * Cámaras: piloto (DRIVER STATION), seguimiento, superior, transmisión TV y libre.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as F from '../config/field';
import type { Alliance, StationNumber } from '../core/types';

export type CameraMode = 'driver' | 'chase' | 'top' | 'broadcast' | 'free';
export const CAMERA_MODES: CameraMode[] = ['driver', 'chase', 'top', 'broadcast', 'free'];

export interface CameraTarget {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
}

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 200);
  mode: CameraMode = 'driver';
  alliance: Alliance = 'blue';
  station: StationNumber = 2;
  shakeEnabled = true;
  private shake = 0;
  private look = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private orbit: OrbitControls | null = null;
  private first = true;

  constructor(private dom: HTMLElement | null) {
    this.camera.position.set(-10, 4, 0);
  }

  setMode(m: CameraMode): void {
    this.mode = m;
    this.first = true;
    if (m === 'free' && this.dom) {
      if (!this.orbit) {
        this.orbit = new OrbitControls(this.camera, this.dom);
        this.orbit.enableDamping = true;
        this.orbit.maxPolarAngle = Math.PI * 0.495;
        this.orbit.target.set(0, 0, 0);
      }
      this.orbit.enabled = true;
    } else if (this.orbit) this.orbit.enabled = false;
  }

  /** Dirección "hacia adelante" del piloto (hacia el lado contrario) en X. */
  get downfield(): number {
    return this.alliance === 'blue' ? 1 : -1;
  }

  addShake(amount: number): void {
    if (this.shakeEnabled) this.shake = Math.min(0.25, this.shake + amount);
  }

  /** Base horizontal de la cámara (para manejo relativo a la cámara): adelante y derecha en XZ. */
  basis(): { fx: number; fz: number; rx: number; rz: number } {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    if (this.mode === 'top') {
      // en vista superior "arriba de la pantalla" = up de la cámara
      d.copy(this.camera.up);
    }
    d.y = 0;
    if (d.lengthSq() < 1e-6) d.set(this.downfield, 0, 0);
    d.normalize();
    // derecha = adelante × arriba
    return { fx: d.x, fz: d.z, rx: -d.z, rz: d.x };
  }

  update(dt: number, t: CameraTarget | null): void {
    const k = this.first ? 1 : 1 - Math.exp(-dt * 6);
    this.first = false;
    const s = this.downfield;
    const tgt = t ?? { x: 0, y: 0, z: 0, vx: 0, vz: 0 };
    const desiredPos = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();
    let fov = 55;
    this.camera.up.set(0, 1, 0);
    switch (this.mode) {
      case 'driver': {
        // Detrás del policarbonato de la DRIVER STATION, a la altura de los ojos.
        const ds = F.driverStationCenter(this.alliance, this.station);
        desiredPos.set(ds.x - s * 0.55, 1.68, ds.z);
        // Mira hacia el robot, con un sesgo hacia el centro del campo.
        desiredLook.set(tgt.x * 0.75, 0.2, tgt.z * 0.85);
        if (Math.abs(desiredLook.x - desiredPos.x) < 2) desiredLook.x = desiredPos.x + s * 2;
        fov = 52;
        break;
      }
      case 'chase': {
        const lead = 0.25;
        desiredPos.set(tgt.x - s * 3.1, 2.6, tgt.z * 0.92);
        desiredLook.set(tgt.x + s * 1.2 + tgt.vx * lead, 0.3, tgt.z + tgt.vz * lead);
        fov = 60;
        break;
      }
      case 'top': {
        // Campo horizontal en pantalla: la alianza propia a la izquierda.
        fov = 45;
        const tf = Math.tan(((fov / 2) * Math.PI) / 180);
        const h = Math.max(9.6 / (tf * Math.max(0.5, this.camera.aspect)), 5.3 / tf);
        desiredPos.set(0, h, 0.0001);
        desiredLook.set(0, 0, 0);
        this.camera.up.set(0, 0, -s);
        break;
      }
      case 'broadcast': {
        const cx = THREE.MathUtils.clamp(tgt.x * 0.55, -5, 5);
        desiredPos.set(cx, 7.5, F.HALF_W + 9.5);
        desiredLook.set(cx * 1.05, 0, -0.4);
        fov = 46;
        break;
      }
      case 'free': {
        this.orbit?.update();
        return;
      }
    }
    if (this.mode === 'top') {
      this.pos.copy(desiredPos);
      this.look.copy(desiredLook);
    } else {
      this.pos.lerp(desiredPos, k);
      this.look.lerp(desiredLook, k);
    }
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      const a = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      this.camera.position.z += (Math.random() - 0.5) * a;
      this.shake *= Math.exp(-dt * 10);
    }
    this.camera.lookAt(this.look);
  }
}
