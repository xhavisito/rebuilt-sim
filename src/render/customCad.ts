/**
 * CAD propio del taller de robots: los GLB se guardan en IndexedDB (localStorage no alcanza) y se
 * leen al arrancar para que RobotView los tenga listos al armar cada robot. Si el archivo no
 * está (otro dispositivo, un robot que llegó por la red), el robot se dibuja con el diseño del
 * simulador.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { CustomCad, RobotSpec } from '../config/robots';

const DB_NAME = 'rebuilt-sim';
const STORE = 'cad';

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp)
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((res, rej) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      }),
  );
}

export const putCadFile = (id: string, buf: ArrayBuffer): Promise<IDBValidKey> => tx('readwrite', (s) => s.put(buf, id));
export const getCadFile = (id: string): Promise<ArrayBuffer | undefined> => tx('readonly', (s) => s.get(id) as IDBRequest<ArrayBuffer | undefined>);
export const deleteCadFile = (id: string): Promise<undefined> => tx('readwrite', (s) => s.delete(id));
const cadKeys = (): Promise<IDBValidKey[]> => tx('readonly', (s) => s.getAllKeys());

let loader: GLTFLoader | null = null;

/**
 * Lee un .glb o un .gltf autocontenido (buffers en data URI). Lanza Error('external') si el .gltf
 * pide archivos aparte y Error('draco') si viene comprimido con Draco (no se incluye decodificador).
 */
export async function parseCad(buf: ArrayBuffer): Promise<THREE.Group> {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 4)));
  if (head !== 'glTF') {
    const json = new TextDecoder().decode(buf);
    if (/"uri"\s*:\s*"(?!data:)/.test(json)) throw new Error('external');
  }
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  try {
    const g = await loader.parseAsync(buf, '');
    return g.scene;
  } catch (e) {
    if (/draco/i.test(String((e as Error)?.message ?? e))) throw new Error('draco');
    throw e;
  }
}

const models = new Map<string, THREE.Group>();

/** Modelo ya leído (listo para clonar) o undefined si no está en este dispositivo. */
export const customModel = (id: string): THREE.Group | undefined => models.get(id);
export const registerCustomModel = (id: string, scene: THREE.Group): void => void models.set(id, scene);
export const forgetCustomModel = (id: string): void => void models.delete(id);

/**
 * Al arrancar: lee los CAD de los robots guardados y borra los archivos que ya no usa ninguno
 * (importados y nunca guardados, o de robots borrados). Nunca falla.
 */
export async function preloadCustomCads(robots: RobotSpec[]): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const used = new Set(robots.map((r) => r.customCad?.id).filter((x): x is string => !!x));
    const keys = await cadKeys();
    await Promise.all(
      keys.map(async (k) => {
        const id = String(k);
        if (!used.has(id)) return deleteCadFile(id);
        if (models.has(id)) return;
        const buf = await getCadFile(id);
        if (buf) registerCustomModel(id, await parseCad(buf));
      }),
    );
  } catch (e) {
    console.warn('custom CAD', e);
  }
}

/** Ejes del modelo ya parado (Y arriba) y girado al frente del robot, en unidades del modelo. */
export function cadFrame(c: Pick<CustomCad, 'upAxis' | 'yawDeg'>): THREE.Group {
  const yaw = new THREE.Group();
  yaw.rotation.y = (c.yawDeg * Math.PI) / 180;
  const up = new THREE.Group();
  up.rotation.x = c.upAxis === 'z' ? -Math.PI / 2 : 0;
  yaw.add(up);
  return yaw;
}

/** Medidas del modelo (x = largo al frente, y = alto, z = ancho), en unidades del modelo. */
export function cadSize(scene: THREE.Object3D, c: Pick<CustomCad, 'upAxis' | 'yawDeg'>): THREE.Vector3 {
  const f = cadFrame(c);
  const holder = new THREE.Group();
  holder.add(scene.clone(true));
  f.children[0].add(holder);
  f.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(f).getSize(new THREE.Vector3());
}

/** Nombres de los nodos con geometría (candidatos a turret / intake), sin repetir. */
export function cadNodeNames(scene: THREE.Object3D, max = 300): string[] {
  const out = new Set<string>();
  scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    for (let p: THREE.Object3D | null = o; p && p !== scene && out.size < max; p = p.parent) if (p.name) out.add(p.name);
  });
  return [...out].sort((a, b) => a.localeCompare(b));
}
