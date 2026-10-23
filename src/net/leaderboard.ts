/**
 * Ranking global sin servidor propio: cada jugador publica su resumen como mensaje "retained" en
 * su propio tema del broker MQTT público (el mismo del directorio de salas) y la pantalla de
 * estadísticas se suscribe a todos. Es "best effort": el broker gratuito puede borrar los
 * mensajes retenidos y cualquiera puede publicar, así que todo lo que llega se valida y se acota
 * (`parseBoardEntry`).
 */
import { BOARD_VERSION, parseBoardEntry, type BoardEntry } from '../core/stats';
import { transport, type Transport } from './directory';

const TOPIC = 'rebuilt-sim/v1/rank';

/** Publica (o, con `null`, borra) el resumen del jugador `id`. */
export async function publishBoard(id: string, entry: BoardEntry | null): Promise<void> {
  const t = transport();
  try {
    await t.open();
    t.publish(`${TOPIC}/${id}`, entry ? JSON.stringify({ v: BOARD_VERSION, ...entry }) : '', true);
  } finally {
    setTimeout(() => t.close(), 600);
  }
}

/** Lista del ranking global en vivo. */
export class BoardBrowser {
  private t: Transport | null = null;
  private entries = new Map<string, BoardEntry>();
  onChange: (list: BoardEntry[]) => void = () => {};

  async start(): Promise<void> {
    const t = transport();
    this.t = t;
    await t.open();
    if (this.t !== t) return;
    t.subscribe(`${TOPIC}/+`, (topic, payload) => {
      const id = topic.slice(TOPIC.length + 1);
      const e = parseBoardEntry(id, payload);
      if (e) this.entries.set(id, e);
      else this.entries.delete(id);
      this.onChange(this.list);
    });
  }

  /** Pone (o quita) la entrada propia sin esperar a que regrese del broker. */
  setLocal(id: string, e: BoardEntry | null): void {
    if (e) this.entries.set(id, e);
    else this.entries.delete(id);
    this.onChange(this.list);
  }

  get list(): BoardEntry[] {
    return [...this.entries.values()];
  }

  stop(): void {
    const t = this.t;
    this.t = null;
    t?.close();
  }
}
