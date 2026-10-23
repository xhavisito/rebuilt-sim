/**
 * Archivo de robot para compartir (.rebuilt-robot.json): la ficha completa y, si tiene CAD propio,
 * el GLB en base64. Al importarlo se completa con la plantilla (campos que falten de versiones
 * viejas) y recibe ids nuevos para no pisar robots existentes.
 */
import { newRobotTemplate, resolveLook, type RobotSpec } from './robots';

export const ROBOT_FILE_FORMAT = 'rebuilt-sim-robot';
export const ROBOT_FILE_VERSION = 1;
/** Tamaño máximo de un CAD propio (bytes). */
export const MAX_CAD_BYTES = 60 * 1024 * 1024;

interface RobotFile {
  format: typeof ROBOT_FILE_FORMAT;
  version: number;
  spec: RobotSpec;
  /** GLB en base64. */
  cad?: string;
}

function toBase64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): ArrayBuffer {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function encodeRobotFile(spec: RobotSpec, cad?: ArrayBuffer): string {
  const f: RobotFile = { format: ROBOT_FILE_FORMAT, version: ROBOT_FILE_VERSION, spec: { ...structuredClone(spec), real: undefined } };
  if (cad && spec.customCad) f.cad = toBase64(cad);
  else delete f.spec.customCad;
  return JSON.stringify(f);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Copia sobre `base` solo los campos que existen en ella y tienen el mismo tipo. */
function mergeTyped<T>(base: T, src: unknown): T {
  if (!isObj(src) || !isObj(base)) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(base as Record<string, unknown>)) {
    const sv = src[k];
    if (sv === undefined) continue;
    if (isObj(v)) out[k] = mergeTyped(v, sv);
    else if (Array.isArray(v)) out[k] = Array.isArray(sv) && sv.length === v.length && sv.every((x, i) => typeof x === typeof v[i]) ? sv : v;
    else if (typeof sv === typeof v && (typeof sv !== 'number' || Number.isFinite(sv))) out[k] = sv;
  }
  return out as T;
}

/**
 * Lee un archivo de robot. Devuelve la ficha (con id nuevo, sin CAD real del equipo) y el GLB si
 * lo trae; lanza Error con un mensaje legible si el archivo no es válido.
 */
export function decodeRobotFile(text: string, newId = `custom-${Date.now().toString(36)}`): { spec: RobotSpec; cad?: ArrayBuffer } {
  let f: unknown;
  try {
    f = JSON.parse(text);
  } catch {
    throw new Error('not-json');
  }
  if (!isObj(f) || f.format !== ROBOT_FILE_FORMAT || !isObj(f.spec)) throw new Error('not-robot');
  if (typeof f.version !== 'number' || f.version > ROBOT_FILE_VERSION) throw new Error('newer-version');
  const cad = typeof f.cad === 'string' ? fromBase64(f.cad) : undefined;
  if (cad && cad.byteLength > MAX_CAD_BYTES) throw new Error('too-big');
  const spec = sanitizeSpec(f.spec, newId, !!cad);
  return { spec, cad: spec.customCad ? cad : undefined };
}

/**
 * Ficha que llega de afuera (archivo, galería de la comunidad): se completa con la plantilla, se
 * validan los tipos y recibe `newId`. El CAD propio se conserva solo si `hasCad` (el GLB viene
 * aparte); su archivo queda como `${newId}-cad`, salvo que se pida otro `cadId`.
 */
export function sanitizeSpec(raw: unknown, newId: string, hasCad: boolean, cadId = `${newId}-cad`): RobotSpec {
  if (!isObj(raw)) throw new Error('not-robot');
  const src = raw;
  const spec = mergeTyped(newRobotTemplate(), src);
  spec.id = newId;
  if (!spec.name.trim()) spec.name = 'Robot';
  spec.name = spec.name.slice(0, 60);
  // Campos opcionales de la ficha (no están en la plantilla)
  const sh = isObj(src.shooter) ? src.shooter : {};
  for (const k of ['lanes', 'laneSpacingIn', 'yawDeg'] as const) if (typeof sh[k] === 'number' && Number.isFinite(sh[k])) spec.shooter[k] = sh[k] as number;
  if (Array.isArray(sh.posIn) && sh.posIn.length === 2 && sh.posIn.every((x) => typeof x === 'number')) spec.shooter.posIn = sh.posIn as [number, number];
  if (typeof src.overhangIn === 'number') spec.overhangIn = src.overhangIn;
  if (src.look !== undefined) spec.look = resolveLook(src.look);
  if (isObj(src.cad) && typeof src.cad.file === 'string' && /^[\w-]+\.glb$/.test(src.cad.file)) spec.cad = { file: src.cad.file };
  if (hasCad && isObj(src.customCad)) {
    const c = src.customCad;
    spec.customCad = mergeTyped(
      { id: cadId, name: 'model.glb', unit: 1, scalePct: 100, upAxis: 'y' as 'y' | 'z', yawDeg: 0, offsetIn: [0, 0, 0] as [number, number, number] },
      { ...c, id: undefined },
    );
    if (spec.customCad.upAxis !== 'y' && spec.customCad.upAxis !== 'z') spec.customCad.upAxis = 'y';
    if (typeof c.turretNode === 'string') spec.customCad.turretNode = c.turretNode;
    if (typeof c.intakeNode === 'string') spec.customCad.intakeNode = c.intakeNode;
    delete spec.cad; // el CAD propio reemplaza al del equipo
  }
  return spec;
}
