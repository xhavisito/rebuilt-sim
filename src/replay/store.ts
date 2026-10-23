/**
 * Repeticiones guardadas en el navegador (IndexedDB): se guardan solas las últimas
 * `KEEP_RECENT` (las más viejas se borran); las marcadas con estrella se quedan.
 */
import { deserializeReplay, serializeReplay, type ReplayData, type ReplayMeta } from './Recording';

export const KEEP_RECENT = 8;
const DB = 'rebuilt-sim-replays';
const STORE = 'replays';

export interface StoredReplay {
  id: string;
  meta: ReplayMeta;
  /** Tamaño del archivo comprimido (bytes). */
  size: number;
  starred: boolean;
}

interface Row extends StoredReplay {
  bytes: Uint8Array;
}

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp)
    dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('sin IndexedDB'));
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE, { keyPath: 'id' });
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  dbp.catch(() => (dbp = null));
  return dbp;
}

function run<T>(mode: IDBTransactionMode, fn: (st: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const rq = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(rq.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

const strip = ({ bytes: _b, ...rest }: Row): StoredReplay => rest;

/** Todas, de la más nueva a la más vieja (sin los datos). */
export async function listReplays(): Promise<StoredReplay[]> {
  const rows = await run<Row[]>('readonly', (st) => st.getAll() as IDBRequest<Row[]>);
  return rows.map(strip).sort((a, b) => b.meta.date - a.meta.date);
}

/** Guarda una repetición y borra las más viejas sin estrella. */
export async function saveReplay(d: ReplayData, starred = false): Promise<StoredReplay> {
  const bytes = await serializeReplay(d);
  const row: Row = { id: `${d.meta.date.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, meta: d.meta, size: bytes.length, starred, bytes };
  await run('readwrite', (st) => st.put(row));
  const old = (await listReplays()).filter((r) => !r.starred).slice(KEEP_RECENT);
  for (const r of old) await deleteReplay(r.id);
  return strip(row);
}

export async function loadReplay(id: string): Promise<ReplayData> {
  const row = await run<Row | undefined>('readonly', (st) => st.get(id) as IDBRequest<Row | undefined>);
  if (!row) throw new Error('replay: no existe');
  return deserializeReplay(row.bytes);
}

/** El archivo tal cual (para descargarlo). */
export async function replayBytes(id: string): Promise<Uint8Array> {
  const row = await run<Row | undefined>('readonly', (st) => st.get(id) as IDBRequest<Row | undefined>);
  if (!row) throw new Error('replay: no existe');
  return row.bytes;
}

export async function setStarred(id: string, starred: boolean): Promise<void> {
  const row = await run<Row | undefined>('readonly', (st) => st.get(id) as IDBRequest<Row | undefined>);
  if (row) await run('readwrite', (st) => st.put({ ...row, starred }));
}

export async function deleteReplay(id: string): Promise<void> {
  await run('readwrite', (st) => st.delete(id));
}
