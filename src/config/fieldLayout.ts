/**
 * Descripción del campo como lista de primitivas. Es la ÚNICA fuente de verdad para
 * los colisionadores (physics/FieldColliders) y la geometría visual (render/FieldView).
 * Se construye el lado azul y se rota 180° para el rojo.
 */
import type { Alliance } from '../core/types';
import * as F from './field';

const { inch } = F;

export type MatKey =
  | 'rail' // extrusión de aluminio
  | 'poly' // policarbonato transparente
  | 'alu'
  | 'steel'
  | 'dark'
  | 'diamond' // diamond plate de la DRIVER STATION
  | 'hubBody'
  | 'hubTop'
  | 'net'
  | 'hdpeA' // HDPE color de alianza (BUMP)
  | 'panelA' // panel color de alianza
  | 'towerA' // pintura en polvo color de alianza (UPRIGHTS, RUNGS)
  | 'baseplate'
  | 'invisible';

export type PartShape =
  | { type: 'box'; hx: number; hy: number; hz: number }
  | { type: 'hull'; points: number[] }
  | { type: 'cyl'; r: number; hh: number; axis: 'x' | 'y' | 'z' };

export type Collide = 'all' | 'fuel' | 'none';

export interface FieldPart {
  name: string;
  shape: PartShape;
  /** Centro (para hull, origen de los puntos). */
  pos: [number, number, number];
  mat: MatKey;
  collide: Collide;
  alliance?: Alliance;
  /** Proyecta sombra (visual). */
  shadow?: boolean;
}

const parts: FieldPart[] = [];
const box = (
  name: string,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  mat: MatKey,
  collide: Collide = 'all',
  shadow = true,
): FieldPart => ({
  name,
  shape: { type: 'box', hx: Math.abs(x1 - x0) / 2, hy: Math.abs(y1 - y0) / 2, hz: Math.abs(z1 - z0) / 2 },
  pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  mat,
  collide,
  shadow,
});

/** y_WPILib (in) → Z de mundo (m). */
const zOf = (yIn: number): number => -inch(yIn - F.FIELD_WIDTH_IN / 2);

export const WALL_T = 0.06;
const WALL_X = -F.HALF_L; // cara interior de la pared azul

function buildBlueSide(): FieldPart[] {
  const out: FieldPart[] = [];
  const wx0 = WALL_X - WALL_T;
  const wx1 = WALL_X;

  // ---------- ALLIANCE WALL: DRIVER STATIONS (base diamond plate + policarbonato)
  for (const ds of [1, 2, 3] as const) {
    const [y0, y1] = F.DS_RANGES_Y_IN[ds];
    const z0 = zOf(y1);
    const z1 = zOf(y0);
    out.push(box(`ds${ds}-base`, wx0, wx1, 0, F.DS_BASE_HEIGHT, z0, z1, 'diamond'));
    out.push(box(`ds${ds}-glass`, wx0 + 0.02, wx1 - 0.02, F.DS_BASE_HEIGHT, F.DS_TOTAL_HEIGHT, z0, z1, 'poly', 'all', false));
    out.push(box(`ds${ds}-rail`, wx0, wx1, F.DS_TOTAL_HEIGHT, F.DS_TOTAL_HEIGHT + 0.05, z0, z1, 'rail', 'none'));
  }

  // ---------- TOWER WALL
  {
    const [y0, y1] = F.TOWER_WALL_Y_IN;
    out.push(box('tower-wall', wx0, wx1, 0, F.TOWER_HEIGHT, zOf(y1), zOf(y0), 'panelA'));
  }

  // ---------- OUTPOST (pared con abertura del CORRAL abajo y de la CHUTE arriba)
  {
    const c = F.OUTPOST_CENTER_Y_IN;
    const half = 32.0 / 2; // abertura del CORRAL 32 in (la de la CHUTE es 31.8 in)
    const oy0 = c - half;
    const oy1 = c + half;
    const [ay0, ay1] = F.OUTPOST_WALL_Y_IN;
    const h = F.OUTPOST_WALL_HEIGHT;
    out.push(box('outpost-l', wx0, wx1, 0, h, zOf(oy0), zOf(ay0) + 0.0, 'panelA'));
    out.push(box('outpost-r', wx0, wx1, 0, h, zOf(ay1), zOf(oy1), 'panelA'));
    out.push(box('outpost-sill', wx0, wx1, 0, F.CORRAL_OPEN_BOTTOM, zOf(oy1), zOf(oy0), 'dark'));
    out.push(
      box('outpost-mid', wx0, wx1, F.CORRAL_OPEN_BOTTOM + F.CORRAL_OPEN_H, F.CHUTE_OPEN_BOTTOM, zOf(oy1), zOf(oy0), 'panelA'),
    );
    out.push(box('outpost-top', wx0, wx1, F.CHUTE_OPEN_BOTTOM + F.CHUTE_OPEN_H, h, zOf(oy1), zOf(oy0), 'panelA'));
    // Cuña para FUEL frente al umbral de 1.88 in: los robots empujan la espuma por encima
    // del umbral (supuesto 12 en PLAN.md; la geometría exacta está en el CAD oficial).
    {
      const pts: number[] = [];
      for (const z of [zOf(oy1), zOf(oy0)]) pts.push(wx1, 0, z, wx1, F.CORRAL_OPEN_BOTTOM, z, wx1 + 0.12, 0, z);
      out.push({ name: 'corral-ramp', shape: { type: 'hull', points: pts }, pos: [0, 0, 0], mat: 'dark', collide: 'fuel', shadow: false });
    }
    // Tubo vertical al centro de la abertura del CORRAL (1-1/4" Sch 40)
    out.push({
      name: 'corral-pipe',
      shape: { type: 'cyl', r: F.CORRAL_PIPE_OD / 2, hh: F.CORRAL_OPEN_H / 2 },
      pos: [WALL_X - WALL_T / 2, F.CORRAL_OPEN_BOTTOM + F.CORRAL_OPEN_H / 2, zOf(c)],
      mat: 'steel',
      collide: 'all',
    } as FieldPart);
    // Tope detrás de la abertura de la CHUTE (el FUEL disparado ahí rebota de vuelta)
    out.push(
      box(
        'chute-backstop',
        wx0 - 0.25,
        wx0 - 0.2,
        F.CHUTE_OPEN_BOTTOM,
        F.CHUTE_OPEN_BOTTOM + F.CHUTE_OPEN_H,
        zOf(oy1),
        zOf(oy0),
        'dark',
        'fuel',
      ),
    );
    // CORRAL detrás de la pared: paneles de 8.13 in de policarbonato
    const cz0 = zOf(c + F.CORRAL_W / F.IN / 2);
    const cz1 = zOf(c - F.CORRAL_W / F.IN / 2);
    const cx0 = wx0 - F.CORRAL_D;
    out.push(box('corral-back', cx0 - 0.02, cx0, 0, F.CORRAL_PANEL_H, cz0, cz1, 'poly', 'all', false));
    out.push(box('corral-side-a', cx0, wx0, 0, F.CORRAL_PANEL_H, cz0 - 0.02, cz0, 'poly', 'all', false));
    out.push(box('corral-side-b', cx0, wx0, 0, F.CORRAL_PANEL_H, cz1, cz1 + 0.02, 'poly', 'all', false));
    // Estructura de la OUTPOST (visual): caja exterior y túnel de la CHUTE
    out.push(box('outpost-housing', wx0 - 0.95, wx0 - 0.3, 0.3, 1.25, zOf(oy1) - 0.05, zOf(oy0) + 0.05, 'alu', 'none'));
  }

  // ---------- HUB
  {
    const hx = F.HUB_CENTER_X_BLUE;
    const hs = F.HUB_SIZE / 2;
    out.push(box('hub-body', hx - hs, hx + hs, 0, F.HUB_INNER_FLOOR, -hs, hs, 'hubBody'));
    // Parte superior: cuadrado con abertura hexagonal (vértices hacia ±X).
    const R = F.HUB_OPENING_HEX / 2;
    const fz = R * Math.cos(Math.PI / 6); // distancia a los lados planos
    const vx = R / 2; // x de los vértices superiores
    const y0 = F.HUB_INNER_FLOOR;
    const y1 = F.HUB_RIM_HEIGHT;
    const quads: Array<Array<[number, number]>> = [
      [
        [0, fz],
        [vx, fz],
        [hs, hs],
        [0, hs],
      ],
      [
        [vx, fz],
        [R, 0],
        [hs, 0],
        [hs, hs],
      ],
    ];
    for (const sx of [1, -1])
      for (const sz of [1, -1])
        for (const q of quads) {
          const pts: number[] = [];
          for (const [px, pz] of q) for (const y of [y0, y1]) pts.push(sx * px, y, sz * pz);
          out.push({
            name: 'hub-top',
            shape: { type: 'hull', points: pts },
            pos: [hx, 0, 0],
            mat: 'hubTop',
            collide: 'all',
            shadow: true,
          });
        }
    // Red trasera (hacia la NEUTRAL ZONE)
    out.push(box('hub-net', hx + hs - 0.02, hx + hs, y1, F.HUB_NET_TOP, -hs, hs, 'net', 'all', false));
    for (const sz of [-1, 1])
      out.push(box('hub-net-post', hx + hs - 0.04, hx + hs, y1, F.HUB_NET_TOP, sz * hs - 0.02, sz * hs + 0.02, 'alu', 'none'));
    out.push(box('hub-net-top', hx + hs - 0.04, hx + hs, F.HUB_NET_TOP - 0.03, F.HUB_NET_TOP, -hs, hs, 'alu', 'none'));
    // Salidas (visual): marcos en la base hacia la NEUTRAL ZONE
    out.push(box('hub-exits', hx + hs, hx + hs + 0.28, 0, 0.32, -0.62, 0.62, 'dark', 'none'));
  }

  // ---------- BUMPS (prisma con rampas de 15° y labio de 0.5 in)
  for (const sz of [-1, 1]) {
    const hx = F.HUB_CENTER_X_BLUE;
    const hd = F.BUMP_DEPTH / 2;
    const lip = Math.max(0.005, F.BUMP_HEIGHT - hd * Math.tan((F.BUMP_ANGLE_DEG * Math.PI) / 180));
    const hw = F.BUMP_WIDTH / 2;
    const pts: number[] = [];
    for (const z of [-hw, hw]) pts.push(-hd, 0, z, -hd, lip, z, 0, F.BUMP_HEIGHT, z, hd, lip, z, hd, 0, z);
    out.push({
      name: 'bump',
      shape: { type: 'hull', points: pts },
      pos: [hx, 0, sz * F.BUMP_CENTER_Z],
      mat: 'hdpeA',
      collide: 'all',
      shadow: false,
    });
  }

  // ---------- TRENCHES
  for (const sz of [-1, 1]) {
    const hx = F.HUB_CENTER_X_BLUE;
    const zIn = F.TRENCH_INNER_Z;
    const zOpen = F.HALF_W - F.TRENCH_CLEAR_WIDTH;
    const a = (z0: number, z1: number) => (sz > 0 ? [z0, z1] : [-z1, -z0]) as [number, number];
    const [pz0, pz1] = a(zIn, zOpen);
    out.push(box('trench-post', hx - F.TRENCH_DEPTH / 2, hx + F.TRENCH_DEPTH / 2, 0, F.TRENCH_HEIGHT, pz0, pz1, 'panelA'));
    const [az0, az1] = a(zOpen, F.HALF_W);
    const ad = F.TRENCH_ARM_DEPTH / 2;
    out.push(box('trench-arm', hx - ad, hx + ad, F.TRENCH_CLEAR_HEIGHT, F.TRENCH_ARM_TOP, az0, az1, 'alu'));
    out.push(box('trench-arm-panel', hx - ad - 0.004, hx + ad + 0.004, F.TRENCH_CLEAR_HEIGHT + 0.02, F.TRENCH_ARM_TOP - 0.02, az0, az1, 'panelA', 'none'));
    // Soporte en el barandal
    const [gz0, gz1] = a(F.HALF_W - 0.06, F.HALF_W);
    out.push(box('trench-guard-post', hx - 0.08, hx + 0.08, 0, F.TRENCH_ARM_TOP, gz0, gz1, 'alu'));
  }

  // ---------- DEPOT (barreras de acero de 3 × 1.125 in)
  {
    const zc = zOf(F.DEPOT_CENTER_Y_IN);
    const bw = F.DEPOT_BARRIER_W;
    const h = F.DEPOT_BARRIER_H;
    const x0 = WALL_X;
    const x1 = WALL_X + F.DEPOT_DEPTH;
    const hw = F.DEPOT_WIDTH / 2;
    out.push(box('depot-a', x0, x1, 0, h, zc - hw, zc - hw + bw, 'panelA', 'all', false));
    out.push(box('depot-b', x0, x1, 0, h, zc + hw - bw, zc + hw, 'panelA', 'all', false));
    out.push(box('depot-c', x1 - bw, x1, 0, h, zc - hw + bw, zc + hw - bw, 'panelA', 'all', false));
  }

  // ---------- TOWER
  {
    const zc = zOf(F.TOWER_CENTER_Y_IN);
    out.push(
      box('tower-base', WALL_X, WALL_X + F.TOWER_BASE_DEPTH, 0, F.TOWER_BASE_THICK, zc - F.TOWER_BASE_WIDTH / 2, zc + F.TOWER_BASE_WIDTH / 2, 'baseplate', 'all', false),
    );
    const ux = WALL_X + F.UPRIGHT_X_FROM_WALL;
    for (const s of [-1, 1]) {
      const uz = zc + s * (F.UPRIGHT_GAP / 2 + F.UPRIGHT_THICK / 2);
      out.push(
        box('upright', ux - F.UPRIGHT_DEEP / 2, ux + F.UPRIGHT_DEEP / 2, 0, F.UPRIGHT_HEIGHT, uz - F.UPRIGHT_THICK / 2, uz + F.UPRIGHT_THICK / 2, 'towerA'),
      );
      // Estructura de soporte entre UPRIGHT y TOWER WALL (≈28.4–43.38 in)
      out.push(
        box('tower-support', WALL_X, ux - F.UPRIGHT_DEEP / 2, F.TOWER_SUPPORT_LOW, F.TOWER_SUPPORT_HIGH, uz - F.UPRIGHT_THICK / 2, uz + F.UPRIGHT_THICK / 2, 'alu'),
      );
    }
    const rungLen = F.UPRIGHT_GAP + 2 * F.UPRIGHT_THICK + 2 * F.RUNG_OVERHANG;
    for (const [k, h] of Object.entries(F.RUNG_HEIGHTS)) {
      out.push({
        name: `rung-${k}`,
        shape: { type: 'cyl', r: F.RUNG_OD / 2, hh: rungLen / 2, axis: 'z' },
        pos: [ux, h, zc],
        mat: 'towerA',
        collide: 'all',
        shadow: true,
      });
    }
  }
  return out;
}

function mirror(p: FieldPart): FieldPart {
  const q: FieldPart = { ...p, alliance: 'red', pos: [-p.pos[0], p.pos[1], -p.pos[2]] };
  if (p.shape.type === 'hull') {
    const pts = p.shape.points.slice();
    for (let i = 0; i < pts.length; i += 3) {
      pts[i] = -pts[i];
      pts[i + 2] = -pts[i + 2];
    }
    q.shape = { type: 'hull', points: pts };
  }
  return q;
}

function buildShared(): FieldPart[] {
  const out: FieldPart[] = [];
  const L = F.FIELD_LENGTH + 2 * WALL_T;
  // Barandales: policarbonato de 20 in entre extrusiones de aluminio
  for (const s of [-1, 1]) {
    const z0 = s * F.HALF_W;
    const z1 = s * (F.HALF_W + 0.03);
    out.push(box('guardrail', -L / 2, L / 2, 0, F.GUARDRAIL_HEIGHT, Math.min(z0, z1), Math.max(z0, z1), 'poly', 'all', false));
    out.push(box('guardrail-top', -L / 2, L / 2, F.GUARDRAIL_HEIGHT - 0.04, F.GUARDRAIL_HEIGHT, Math.min(z0, z1) - 0.01, Math.max(z0, z1) + 0.01, 'rail', 'none'));
    out.push(box('guardrail-bot', -L / 2, L / 2, 0, 0.05, Math.min(z0, z1) - 0.01, Math.max(z0, z1) + 0.01, 'rail', 'none'));
  }
  return out;
}

let cached: FieldPart[] | null = null;
export function fieldParts(): FieldPart[] {
  if (cached) return cached;
  const blue = buildBlueSide().map((p) => ({ ...p, alliance: 'blue' as Alliance }));
  parts.length = 0;
  parts.push(...buildShared(), ...blue, ...blue.map(mirror));
  cached = parts.slice();
  return cached;
}
