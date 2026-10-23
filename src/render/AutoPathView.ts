/**
 * Ruta de AUTO planeada (rutas suaves del diseñador) dibujada sobre la alfombra durante AUTO:
 * una línea con el color de la alianza y un aro en el punto de referencia que persigue el robot.
 */
import * as THREE from 'three';
import type { Alliance } from '../core/types';

const Y = 0.025;

export class AutoPathView {
  readonly group = new THREE.Group();
  private line: THREE.Line;
  private ring: THREE.Mesh;

  constructor(path: Array<{ x: number; z: number }>, alliance: Alliance) {
    const color = alliance === 'blue' ? 0x4fc3ff : 0xff6b6b;
    const pts = path.map((p) => new THREE.Vector3(p.x, Y, p.z));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 0.18, gapSize: 0.1, transparent: true, opacity: 0.9, depthWrite: false }));
    this.line.computeLineDistances();
    this.line.renderOrder = 4;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.22, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ring.renderOrder = 4;
    this.ring.visible = false;
    this.group.add(this.line, this.ring);
  }

  /** Mueve el aro de referencia (null = lo oculta). */
  update(ref: { x: number; z: number } | null): void {
    this.ring.visible = !!ref;
    if (ref) this.ring.position.set(ref.x, Y + 0.005, ref.z);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
  }
}
