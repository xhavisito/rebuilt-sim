/** Crea los colisionadores estáticos del campo a partir de `fieldParts()`. */
import { fieldParts, type FieldPart } from '../config/fieldLayout';
import { RAPIER, type PhysicsWorld } from './PhysicsWorld';

const FRICTION: Partial<Record<FieldPart['mat'], number>> = {
  hdpeA: 0.7, // HDPE "orange peel" texturizado
  poly: 0.3,
  net: 0.2,
  baseplate: 0.6,
};

export function buildFieldColliders(pw: PhysicsWorld): void {
  // Alfombra: caja enorme con la cara superior en y = 0.
  pw.fixed(
    RAPIER.ColliderDesc.cuboid(40, 0.5, 40).setTranslation(0, -0.5, 0).setFriction(0.8).setRestitution(0.3),
    { kind: 'floor' },
  );
  for (const p of fieldParts()) {
    if (p.collide === 'none') continue;
    let desc: RAPIER.ColliderDesc | null = null;
    const s = p.shape;
    if (s.type === 'box') desc = RAPIER.ColliderDesc.cuboid(s.hx, s.hy, s.hz);
    else if (s.type === 'hull') desc = RAPIER.ColliderDesc.convexHull(new Float32Array(s.points));
    else {
      desc = RAPIER.ColliderDesc.cylinder(s.hh, s.r);
      if (s.axis !== 'y') {
        // El cilindro de Rapier es vertical (eje Y); lo giramos 90°.
        const h = Math.SQRT1_2;
        desc.setRotation(s.axis === 'z' ? { x: h, y: 0, z: 0, w: h } : { x: 0, y: 0, z: h, w: h });
      }
    }
    if (!desc) continue;
    desc.setTranslation(p.pos[0], p.pos[1], p.pos[2]);
    desc.setFriction(FRICTION[p.mat] ?? 0.5).setRestitution(p.mat === 'net' ? 0.05 : 0.25);
    pw.fixed(desc, { kind: 'field', part: p.name, alliance: p.alliance }, p.collide === 'fuel');
  }
}
