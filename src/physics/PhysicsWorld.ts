/**
 * Mundo Rapier3D (WASM). Paso fijo; grupos de colisión; utilidades.
 */
import RAPIER from '@dimforge/rapier3d-compat';

export type R = typeof RAPIER;
export { RAPIER };

let ready: Promise<void> | null = null;
/** Inicializa el WASM de Rapier una sola vez. */
export function initRapier(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}

/** Bits de pertenencia de colisión. */
export const G = {
  FIELD: 1 << 0,
  ROBOT: 1 << 1,
  FUEL: 1 << 2,
  /** Piezas del campo que solo frenan FUEL (red del HUB, techo del CORRAL…). */
  FUEL_ONLY: 1 << 3,
} as const;

/** Empaqueta membresía/filtro en el formato de 32 bits de Rapier. */
export const groups = (member: number, filter: number): number => ((member & 0xffff) << 16) | (filter & 0xffff);

export const GROUPS = {
  field: groups(G.FIELD, G.ROBOT | G.FUEL),
  fuelOnly: groups(G.FUEL_ONLY, G.FUEL),
  robot: groups(G.ROBOT, G.FIELD | G.ROBOT | G.FUEL),
  /** Faldón bajo los BUMPERS: solo toca FUEL (no las rampas del BUMP). */
  skirt: groups(G.ROBOT, G.FUEL),
  /** Ruedas: solo tocan el campo. El FUEL lo empujan los BUMPERS (no hay forma de "rodar" encima). */
  wheel: groups(G.ROBOT, G.FIELD),
  fuel: groups(G.FUEL, G.FIELD | G.ROBOT | G.FUEL | G.FUEL_ONLY),
};

/** Etiqueta que guardamos en `collider` para saber qué tocamos. */
export type ColliderTag =
  | { kind: 'floor' }
  | { kind: 'field'; part: string; alliance?: 'red' | 'blue' }
  | { kind: 'robot'; robot: number; part: 'bumper' | 'frame' | 'wheel' }
  | { kind: 'fuel'; index: number };

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly events: RAPIER.EventQueue;
  /** Paso fijo (s). */
  dt: number;
  private tags = new Map<number, ColliderTag>();

  constructor(hz = 120) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.dt = 1 / hz;
    this.world.timestep = this.dt;
    this.world.numSolverIterations = 4;
    // Margen de contactos predictivos 5 mm (default 2 cm): el FUEL en reposo separado unos
    // milímetros no forma una sola "isla" que despierte cientos de cuerpos a la vez.
    // Los FUEL rápidos usan CCD, así que no atraviesan paredes.
    this.world.integrationParameters.normalizedPredictionDistance = 0.005;
    this.events = new RAPIER.EventQueue(true);
  }

  /** Iteraciones del solver (2 en calidad baja/media: suficiente para pelotas de espuma). */
  setIterations(n: number): void {
    this.world.numSolverIterations = n;
  }

  setRate(hz: number): void {
    this.dt = 1 / hz;
    this.world.timestep = this.dt;
  }

  tag(c: RAPIER.Collider, t: ColliderTag): void {
    this.tags.set(c.handle, t);
  }

  tagOf(handle: number): ColliderTag | undefined {
    return this.tags.get(handle);
  }

  step(): void {
    this.world.step(this.events);
  }

  /** Crea un colisionador estático del campo. */
  fixed(desc: RAPIER.ColliderDesc, tag: ColliderTag, fuelOnly = false): RAPIER.Collider {
    desc.setCollisionGroups(fuelOnly ? GROUPS.fuelOnly : GROUPS.field);
    const c = this.world.createCollider(desc);
    this.tag(c, tag);
    return c;
  }

  free(): void {
    this.events.free();
    this.world.free();
  }
}
