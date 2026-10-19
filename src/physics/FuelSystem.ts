/**
 * Pool de FUEL. Cada FUEL tiene un cuerpo Rapier creado una sola vez; cuando está
 * guardado (hopper de un robot, CHUTE, CORRAL, interior del HUB, mano del HUMAN PLAYER
 * o fuera del campo) el cuerpo se deshabilita y solo existe como contador lógico.
 *
 * Aerodinámica (solo FUEL en vuelo): arrastre cuadrático F = −½ρ·Cd·A·|v|·v (Cd = 0.47)
 * y Magnus suave F = ¼ρ·A·r·(ω × v). Rodadura en alfombra con desaceleración fija.
 */
import * as F from '../config/field';
import type { Alliance } from '../core/types';
import type { Rng } from '../core/rng';
import { GROUPS, RAPIER, type PhysicsWorld } from './PhysicsWorld';

export const enum FuelState {
  Field = 0,
  Robot = 1,
  Hub = 2,
  Chute = 3,
  Corral = 4,
  Hand = 5,
  Out = 6,
}

/** Flags por FUEL. */
export const FLAG_FROM_HUB = 1; // salió del HUB y no ha tocado nada más (G408)
export const FLAG_SHOT = 2; // lanzado por un robot y aún en vuelo
export const FLAG_HP_THROW = 4; // lanzado por un HUMAN PLAYER

const RHO = 1.2;
const CD = 0.47;
const AREA = Math.PI * F.FUEL_RADIUS * F.FUEL_RADIUS;
const K_DRAG = 0.5 * RHO * CD * AREA;
const K_MAGNUS = 0.25 * RHO * AREA * F.FUEL_RADIUS;
/** Desaceleración por rodadura de espuma sobre alfombra (m/s²). Supuesto 8. */
const ROLL_DECEL = 1.6;

export interface FuelCallbacks {
  /** Un FUEL cruzó el sensor del HUB de `hub`. */
  onHubEnter?(index: number, hub: Alliance): void;
  /** Un FUEL salió del HUB por una salida. */
  onHubExit?(index: number, hub: Alliance): void;
  onCorral?(index: number, alliance: Alliance): void;
  onOut?(index: number): void;
}

interface HubItem {
  index: number;
  hub: Alliance;
  releaseAt: number;
}

export class FuelSystem {
  readonly count: number;
  readonly bodies: RAPIER.RigidBody[] = [];
  readonly colliders: RAPIER.Collider[] = [];
  readonly state: Uint8Array;
  /** Dueño: índice de robot (estado Robot) o 0 = rojo / 1 = azul (CHUTE, CORRAL, HUB, Hand). */
  readonly owner: Int16Array;
  readonly flags: Uint8Array;
  /** Último robot que lo lanzó / tocó y cuándo. */
  readonly shotBy: Int16Array;
  readonly shotTime: Float32Array;
  readonly shotOrigin: Float32Array; // x,z del robot al lanzar
  readonly lastTouch: Int16Array;
  readonly lastTouchTime: Float32Array;
  /** Posiciones para render: actual y anterior (interpolación). */
  readonly pos: Float32Array;
  readonly prev: Float32Array;
  readonly color: Float32Array;
  /** Tiempo que lleva cada FUEL casi quieto en el piso (para dormirlo antes que Rapier). */
  private slowT: Float32Array;

  /** FUEL en vuelo (con arrastre). */
  private airborne = new Set<number>();
  private hubQueue: HubItem[] = [];
  /** Colas lógicas por alianza. */
  readonly chute: Record<Alliance, number[]> = { red: [], blue: [] };
  readonly corral: Record<Alliance, number[]> = { red: [], blue: [] };
  readonly hand: Record<Alliance, number[]> = { red: [], blue: [] };
  readonly robotStore = new Map<number, number[]>();
  cb: FuelCallbacks = {};
  time = 0;

  private tmpRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  constructor(
    private pw: PhysicsWorld,
    total: number,
    private rng: Rng,
  ) {
    this.count = total;
    this.state = new Uint8Array(total);
    this.owner = new Int16Array(total).fill(-1);
    this.flags = new Uint8Array(total);
    this.shotBy = new Int16Array(total).fill(-1);
    this.shotTime = new Float32Array(total);
    this.shotOrigin = new Float32Array(total * 2);
    this.lastTouch = new Int16Array(total).fill(-1);
    this.lastTouchTime = new Float32Array(total);
    this.pos = new Float32Array(total * 3);
    this.prev = new Float32Array(total * 3);
    this.color = new Float32Array(total);
    this.slowT = new Float32Array(total);
    const w = pw.world;
    for (let i = 0; i < total; i++) {
      const body = w.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(0, -5 - i * 0.01, 0)
          .setLinearDamping(0.05)
          .setAngularDamping(0.5)
          .setEnabled(false),
      );
      body.userData = i;
      const mass = rng.range(F.FUEL_MASS_MIN, F.FUEL_MASS_MAX);
      const col = w.createCollider(
        RAPIER.ColliderDesc.ball(F.FUEL_RADIUS)
          .setMass(mass)
          .setFriction(0.7)
          .setRestitution(0.35)
          .setCollisionGroups(GROUPS.fuel),
        body,
      );
      pw.tag(col, { kind: 'fuel', index: i });
      this.bodies.push(body);
      this.colliders.push(col);
      this.state[i] = FuelState.Out;
      this.color[i] = rng.next();
    }
  }

  // ------------------------------------------------------------------ Staging (§6.3.4)

  /**
   * Coloca el FUEL al inicio del match.
   * @param preloads FUEL precargado por robot (índice de robot → cantidad, ≤ 8)
   */
  stage(preloads: number[]): void {
    this.hubQueue.length = 0;
    this.airborne.clear();
    for (const a of ['red', 'blue'] as Alliance[]) {
      this.chute[a].length = 0;
      this.corral[a].length = 0;
      this.hand[a].length = 0;
    }
    this.robotStore.clear();
    for (let i = 0; i < this.count; i++) {
      this.flags[i] = 0;
      this.shotBy[i] = -1;
      this.lastTouch[i] = -1;
    }
    let next = 0;
    const take = (): number => next++;
    // Precargas (G303-I: máx. 8 por robot)
    preloads.forEach((n, robot) => {
      const list: number[] = [];
      for (let k = 0; k < Math.min(n, F.FUEL_MAX_PRELOAD); k++) {
        const i = take();
        this.store(i, FuelState.Robot, robot);
        list.push(i);
      }
      this.robotStore.set(robot, list);
    });
    // CHUTES (24 c/u)
    for (const a of ['red', 'blue'] as Alliance[])
      for (let k = 0; k < F.FUEL_PER_CHUTE; k++) {
        const i = take();
        this.store(i, FuelState.Chute, a === 'red' ? 0 : 1);
        this.chute[a].push(i);
      }
    // DEPOTS (24 c/u, no necesariamente uniforme)
    for (const a of ['red', 'blue'] as Alliance[]) {
      const c = F.depotCenter(a);
      const cols = 6;
      const rows = 4;
      const sp = F.inch(6.0);
      for (let r = 0; r < rows; r++)
        for (let k = 0; k < cols; k++) {
          const i = take();
          // filas a lo largo de X (hacia el campo), columnas a lo largo de Z
          const lx = (r - (rows - 1) / 2) * sp + this.rng.range(-0.004, 0.004);
          const lz = (k - (cols - 1) / 2) * sp + this.rng.range(-0.004, 0.004);
          const sgn = a === 'blue' ? 1 : -1;
          // Ajuste: el área interior del DEPOT está entre la pared y la barrera frontal
          const x = c.x + sgn * (lx - F.DEPOT_BARRIER_W / 2);
          this.place(i, x, F.FUEL_RADIUS, c.z + sgn * lz, true);
        }
    }
    // NEUTRAL ZONE: caja de 206 × 72 in con divisor de 2 in en z = 0 (§6.3.4.1)
    const remaining = this.count - next;
    // Rejilla con FUEL separados unos milímetros (no se tocan): así una "isla" de contacto
    // no despierta los ~400 cuerpos a la vez cuando un robot entra al montón (rendimiento).
    // Supuesto: 16 por mitad × 12–13 filas (≈ 74–81 in de fondo en vez de 72 in).
    const spZ = F.inch(6.35);
    const spX = F.inch(6.2);
    const perHalf = 16; // a lo largo de Z en cada mitad
    const rows = Math.max(12, Math.min(13, Math.ceil(remaining / (2 * perHalf)))); // a lo largo de X
    const sp = spX;
    const cells: Array<[number, number]> = [];
    for (let r = 0; r < rows; r++)
      for (const side of [-1, 1])
        for (let k = 0; k < perHalf; k++) {
          const x = (r - (rows - 1) / 2) * spX;
          const z = side * (F.NEUTRAL_BOX_GAP / 2 + spZ / 2 + k * spZ);
          cells.push([x, z]);
        }
    this.rng.shuffle(cells);
    const firstLayer = Math.min(remaining, cells.length);
    for (let k = 0; k < firstLayer; k++) {
      const [x, z] = cells[k];
      this.place(take(), x + this.rng.range(-0.002, 0.002), F.FUEL_RADIUS, z + this.rng.range(-0.002, 0.002), true);
    }
    // Más de 408 (modo 600): segunda capa en los huecos. TODO: verificar arreglo oficial de 600.
    for (let k = 0; next < this.count; k++) {
      const [x, z] = cells[k % cells.length];
      this.place(take(), x + sp / 2, F.FUEL_RADIUS * 2.6, z + sp / 2, false);
    }
  }

  // ------------------------------------------------------------------ Transiciones

  /** Deshabilita el cuerpo y lo guarda lógicamente. */
  store(i: number, st: FuelState, owner: number): void {
    const b = this.bodies[i];
    b.setEnabled(false);
    b.enableCcd(false);
    this.state[i] = st;
    this.owner[i] = owner;
    this.airborne.delete(i);
    this.flags[i] &= ~(FLAG_SHOT | FLAG_HP_THROW);
    // Fuera de vista (FuelView oculta los que no están en el campo)
  }

  /** Pone un FUEL en el campo en reposo. */
  place(i: number, x: number, y: number, z: number, sleep: boolean): void {
    const b = this.bodies[i];
    b.setEnabled(true);
    b.setTranslation({ x, y, z }, false);
    b.setLinvel({ x: 0, y: 0, z: 0 }, false);
    b.setAngvel({ x: 0, y: 0, z: 0 }, false);
    if (sleep) b.sleep();
    else b.wakeUp();
    this.state[i] = FuelState.Field;
    this.owner[i] = -1;
    this.setPos(i, x, y, z, true);
  }

  /** Lanza un FUEL al campo con velocidad y spin (disparo, pase, HUB, CHUTE, HUMAN PLAYER). */
  launch(
    i: number,
    p: { x: number; y: number; z: number },
    v: { x: number; y: number; z: number },
    spin: { x: number; y: number; z: number } | null,
    flags: number,
  ): void {
    const b = this.bodies[i];
    b.setEnabled(true);
    b.setTranslation(p, false);
    b.setLinvel(v, false);
    b.setAngvel(spin ?? { x: 0, y: 0, z: 0 }, false);
    b.setLinearDamping(0);
    b.enableCcd(true);
    b.wakeUp();
    this.state[i] = FuelState.Field;
    this.owner[i] = -1;
    this.flags[i] = (this.flags[i] & ~(FLAG_SHOT | FLAG_HP_THROW | FLAG_FROM_HUB)) | flags;
    this.airborne.add(i);
    this.setPos(i, p.x, p.y, p.z, true);
  }

  private setPos(i: number, x: number, y: number, z: number, snap: boolean): void {
    const o = i * 3;
    if (snap) {
      this.prev[o] = x;
      this.prev[o + 1] = y;
      this.prev[o + 2] = z;
    } else {
      this.prev[o] = this.pos[o];
      this.prev[o + 1] = this.pos[o + 1];
      this.prev[o + 2] = this.pos[o + 2];
    }
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
  }

  /** Mete un FUEL del campo al hopper de un robot. */
  toRobot(i: number, robot: number): void {
    this.store(i, FuelState.Robot, robot);
    let list = this.robotStore.get(robot);
    if (!list) this.robotStore.set(robot, (list = []));
    list.push(i);
  }

  /** Saca un FUEL del hopper (para disparar). */
  popRobot(robot: number): number | undefined {
    return this.robotStore.get(robot)?.pop();
  }

  robotCount(robot: number): number {
    return this.robotStore.get(robot)?.length ?? 0;
  }

  // ------------------------------------------------------------------ Paso de física

  /** Antes de `world.step`: fuerzas aerodinámicas en FUEL en vuelo. */
  prePhysics(dt: number): void {
    for (const i of this.airborne) {
      const b = this.bodies[i];
      const v = b.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp < 0.01) continue;
      const m = b.mass();
      const w = b.angvel();
      // Arrastre cuadrático + Magnus, como impulso (F·dt)
      const kd = K_DRAG * sp * dt;
      const ix = -kd * v.x + K_MAGNUS * (w.y * v.z - w.z * v.y) * dt;
      const iy = -kd * v.y + K_MAGNUS * (w.z * v.x - w.x * v.z) * dt;
      const iz = -kd * v.z + K_MAGNUS * (w.x * v.y - w.y * v.x) * dt;
      // Evita invertir la velocidad con pasos grandes
      if (Math.hypot(ix, iy, iz) < m * sp) b.applyImpulse({ x: ix, y: iy, z: iz }, true);
    }
  }

  /** Después de `world.step`: sincroniza posiciones y detecta HUB, CORRAL y fuera de campo. */
  postPhysics(dt: number): void {
    this.time += dt;
    const R = F.HUB_OPENING_HEX / 2 - F.FUEL_RADIUS * 0.3;
    const fz = R * Math.cos(Math.PI / 6);
    const sqrt3 = Math.sqrt(3);
    const hubX = Math.abs(F.HUB_CENTER_X_BLUE);
    const corralZ = Math.abs(F.outpostInfo('blue').z);
    const wallX = F.HALF_L + 0.06;
    const groundY = F.FUEL_RADIUS + 0.012;

    this.pw.world.forEachActiveRigidBody((b) => {
      const i = b.userData;
      if (typeof i !== 'number') return;
      if (this.state[i] !== FuelState.Field) return;
      const t = b.translation();
      this.setPos(i, t.x, t.y, t.z, false);
      const ax = Math.abs(t.x);
      // ---- HUB: dentro del hexágono y bajo el sensor
      if (t.y < F.HUB_SENSOR_HEIGHT && t.y > F.HUB_INNER_FLOOR - 0.05) {
        const dx = ax - hubX;
        const dz = Math.abs(t.z);
        if (Math.abs(dx) < R && dz <= fz && sqrt3 * Math.abs(dx) + dz <= sqrt3 * R) {
          const hub: Alliance = t.x > 0 ? 'red' : 'blue';
          this.store(i, FuelState.Hub, hub === 'red' ? 0 : 1);
          this.hubQueue.push({
            index: i,
            hub,
            releaseAt: this.time + this.rng.range(F.HUB_PROCESS_MIN, F.HUB_PROCESS_MAX),
          });
          this.cb.onHubEnter?.(i, hub);
          return;
        }
      }
      // ---- CORRAL (detrás de la ALLIANCE WALL, a nivel de piso)
      if (ax > wallX && t.y < 0.35) {
        const alliance: Alliance = t.x > 0 ? 'red' : 'blue';
        const zz = alliance === 'blue' ? t.z : -t.z;
        if (Math.abs(zz - corralZ) < F.CORRAL_W / 2 + 0.05 && ax < wallX + F.CORRAL_D + 0.1) {
          this.store(i, FuelState.Corral, alliance === 'red' ? 0 : 1);
          this.corral[alliance].push(i);
          this.cb.onCorral?.(i, alliance);
          return;
        }
      }
      // ---- Fuera del campo (G405). Un tiro del HUMAN PLAYER empieza detrás de la pared:
      //      solo cuenta como fuera si cae allá (no mientras va en el aire).
      const hpInFlight = (this.flags[i] & FLAG_HP_THROW) !== 0 && t.y > 0.6;
      if (!hpInFlight && (Math.abs(t.z) > F.HALF_W + 0.08 || ax > wallX + 0.05 || t.y < -0.5)) {
        this.store(i, FuelState.Out, -1);
        this.cb.onOut?.(i);
        return;
      }
      const v = b.linvel();
      const hsp = Math.hypot(v.x, v.z);
      // ---- En vuelo → aterrizado
      if (this.airborne.has(i)) {
        if (t.y < groundY + 0.01 && Math.abs(v.y) < 0.6 && hsp < 3) {
          this.airborne.delete(i);
          b.enableCcd(false);
          b.setLinearDamping(0.05);
          this.flags[i] &= ~(FLAG_SHOT | FLAG_HP_THROW);
        }
        return;
      }
      // ---- Dormir pronto los FUEL casi quietos (Rapier tarda ~2 s): ahorra mucho CPU
      if (t.y < groundY && hsp < 0.05 && Math.abs(v.y) < 0.05) {
        this.slowT[i] += dt;
        if (this.slowT[i] > 0.4) {
          b.setLinvel({ x: 0, y: 0, z: 0 }, false);
          b.setAngvel({ x: 0, y: 0, z: 0 }, false);
          b.sleep();
          this.slowT[i] = 0;
          return;
        }
      } else this.slowT[i] = 0;
      // ---- Rodadura sobre alfombra
      if (t.y < groundY && hsp > 0.02) {
        const dv = Math.min(hsp, ROLL_DECEL * dt);
        const m = b.mass();
        b.applyImpulse({ x: (-v.x / hsp) * dv * m, y: 0, z: (-v.z / hsp) * dv * m }, true);
      } else if (hsp > 4 && !this.airborne.has(i)) {
        // Golpeado con fuerza por un robot: activa arrastre/CCD
        this.airborne.add(i);
        b.enableCcd(true);
      }
    });

    // ---- Salidas del HUB hacia la NEUTRAL ZONE (aleatorias, §5.4)
    if (this.hubQueue.length) {
      for (let k = this.hubQueue.length - 1; k >= 0; k--) {
        const it = this.hubQueue[k];
        if (it.releaseAt > this.time) continue;
        this.hubQueue.splice(k, 1);
        this.ejectFromHub(it.index, it.hub);
      }
    }
  }

  private ejectFromHub(i: number, hub: Alliance): void {
    const sgn = hub === 'blue' ? 1 : -1; // dirección hacia la NEUTRAL ZONE
    const c = F.hubCenter(hub);
    const exit = this.rng.pick(F.HUB_EXIT_OFFSETS);
    const x = c.x + sgn * (F.HUB_SIZE / 2 + 0.3);
    const z = c.z + sgn * exit + this.rng.range(-0.05, 0.05);
    const speed = this.rng.range(1.5, 3.0);
    const lat = this.rng.range(-0.5, 0.5);
    this.launch(i, { x, y: F.HUB_EXIT_HEIGHT, z }, { x: sgn * speed, y: 0.3, z: lat }, null, FLAG_FROM_HUB);
    this.airborne.delete(i); // ruedan, no vuelan
    this.bodies[i].enableCcd(false);
    this.bodies[i].setLinearDamping(0.05);
    this.cb.onHubExit?.(i, hub);
  }

  /** FUEL dentro del HUB (en proceso). */
  hubPending(hub: Alliance): number {
    let n = 0;
    for (const it of this.hubQueue) if (it.hub === hub) n++;
    return n;
  }

  /** ¿Hay FUEL del campo en (x,z) radio r a nivel de piso? Usado por intakes. */
  forEachNear(x: number, z: number, r: number, f: (i: number, px: number, py: number, pz: number) => void): void {
    const r2 = r * r;
    const p = this.pos;
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] !== FuelState.Field) continue;
      const o = i * 3;
      const dx = p[o] - x;
      const dz = p[o + 2] - z;
      if (dx * dx + dz * dz < r2) f(i, p[o], p[o + 1], p[o + 2]);
    }
  }

  /** Cuenta FUEL en el campo (para estadísticas/HUD). */
  countState(st: FuelState): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.state[i] === st) n++;
    return n;
  }

  /** ¿El FUEL toca el piso? (raycast corto). */
  touchingGround(i: number): boolean {
    const o = i * 3;
    this.tmpRay.origin = { x: this.pos[o], y: this.pos[o + 1], z: this.pos[o + 2] };
    const hit = this.pw.world.castRay(this.tmpRay, F.FUEL_RADIUS + 0.01, true, undefined, undefined, this.colliders[i]);
    return !!hit;
  }
}
