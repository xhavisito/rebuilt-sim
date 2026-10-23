/**
 * Cliente mínimo (fetch, sin SDK) de la galería de la comunidad en Supabase: PostgREST para la
 * tabla `robots` y Storage para los GLB. Los permisos los pone docs/comunidad.sql: leer y publicar
 * son libres; borrar exige el token que se guardó al publicar; cualquiera puede reportar y con
 * varios reportes el robot deja de listarse.
 */
import { COMMUNITY, communityEnabled } from '../config/community';
import { sanitizeSpec } from '../config/robotFile';
import { loadJSON, saveJSON } from '../config/settings';
import type { RobotSpec } from '../config/robots';

export interface HubRobot {
  id: string;
  createdAt: string;
  name: string;
  team: number;
  author: string;
  /** Ficha ya validada (id `hub-<id>`); su CAD propio apunta al GLB público. */
  spec: RobotSpec;
  cadBytes: number;
  downloads: number;
}

const COLS = 'id,created_at,name,team,author,spec,cad_path,cad_bytes,downloads';
const TOKENS_KEY = 'rebuilt-sim.hub-tokens.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
  apikey: COMMUNITY.key,
  Authorization: `Bearer ${COMMUNITY.key}`,
  ...extra,
});

const publicPrefix = () => `${COMMUNITY.url}/storage/v1/object/public/robots/`;

/** Solo se descargan CAD del bucket público de la galería (nunca una URL cualquiera de la red). */
export function hubCadUrlAllowed(url: string | undefined): url is string {
  if (!url || !communityEnabled() || !url.startsWith(publicPrefix())) return false;
  return /^[0-9a-f-]{36}\.(glb|gltf)$/.test(url.slice(publicPrefix().length));
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${COMMUNITY.url}/rest/v1/${path}`, { ...init, headers: headers({ 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) }) });
  if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => '')}`.trim());
  const text = await r.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Fila de la tabla → robot listo para usar (o null si la ficha no es válida). */
export function hubRow(row: Record<string, unknown>): HubRobot | null {
  try {
    const id = String(row.id);
    if (!UUID.test(id)) return null;
    const path = typeof row.cad_path === 'string' ? row.cad_path : '';
    const hasCad = /^[0-9a-f-]{36}\.(glb|gltf)$/.test(path);
    const spec = sanitizeSpec(row.spec, `hub-${id}`, hasCad, `hub-${id}`);
    if (spec.customCad) spec.customCad.url = publicPrefix() + path;
    spec.name = String(row.name ?? spec.name).slice(0, 60) || spec.name;
    return {
      id,
      createdAt: String(row.created_at ?? ''),
      name: spec.name,
      team: Number(row.team) || spec.teamNumber,
      author: String(row.author ?? '').slice(0, 40),
      spec,
      cadBytes: Number(row.cad_bytes) || 0,
      downloads: Number(row.downloads) || 0,
    };
  } catch {
    return null;
  }
}

export async function listHubRobots(): Promise<HubRobot[]> {
  const rows = await rest<Array<Record<string, unknown>>>(`robots?select=${COLS}&order=created_at.desc&limit=300`);
  return rows.map(hubRow).filter((r): r is HubRobot => !!r);
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Robots que publiqué (id → token para borrarlos). */
export const myHubTokens = (): Record<string, string> => loadJSON<Record<string, string>>(TOKENS_KEY, {});

/**
 * Publica el robot: primero el GLB (si tiene CAD propio) y luego la fila. Devuelve el id.
 * `cad` es el archivo tal como se importó.
 */
export async function publishHubRobot(spec: RobotSpec, author: string, cad?: ArrayBuffer): Promise<string> {
  let cadPath: string | null = null;
  if (cad && spec.customCad) {
    if (cad.byteLength > COMMUNITY.maxCadBytes) throw new Error('too-big');
    const glb = new TextDecoder().decode(new Uint8Array(cad, 0, Math.min(4, cad.byteLength))) === 'glTF';
    cadPath = `${crypto.randomUUID()}.${glb ? 'glb' : 'gltf'}`;
    const r = await fetch(`${COMMUNITY.url}/storage/v1/object/robots/${cadPath}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': glb ? 'model/gltf-binary' : 'model/gltf+json', 'x-upsert': 'false' }),
      body: cad,
    });
    if (!r.ok) throw new Error(`upload ${r.status} ${await r.text().catch(() => '')}`.trim());
  }
  const clean: Partial<RobotSpec> = { ...structuredClone(spec), real: undefined };
  delete clean.id;
  if (clean.customCad) {
    delete (clean.customCad as Partial<typeof spec.customCad>)!.id;
    delete clean.customCad.url;
  }
  if (!cadPath) delete clean.customCad;
  const token = crypto.randomUUID();
  const rows = await rest<Array<{ id: string }>>('robots?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name: spec.name.slice(0, 60),
      team: Math.round(spec.teamNumber),
      author: author.slice(0, 40),
      spec: clean,
      cad_path: cadPath,
      cad_bytes: cad && cadPath ? cad.byteLength : 0,
      delete_hash: await sha256(token),
    }),
  });
  const id = rows[0].id;
  saveJSON(TOKENS_KEY, { ...myHubTokens(), [id]: token });
  return id;
}

export async function deleteHubRobot(id: string): Promise<boolean> {
  const token = myHubTokens()[id];
  if (!token) return false;
  const ok = await rest<boolean>('rpc/delete_robot', { method: 'POST', body: JSON.stringify({ rid: id, token }) });
  if (ok) {
    const all = myHubTokens();
    delete all[id];
    saveJSON(TOKENS_KEY, all);
  }
  return !!ok;
}

export const reportHubRobot = (id: string): Promise<unknown> => rest('rpc/report_robot', { method: 'POST', body: JSON.stringify({ rid: id }) });
export const countHubDownload = (id: string): Promise<unknown> => rest('rpc/count_download', { method: 'POST', body: JSON.stringify({ rid: id }) }).catch(() => null);
