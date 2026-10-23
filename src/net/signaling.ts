/**
 * Señalización para WebRTC: solo sirve para que dos navegadores intercambien la oferta, la
 * respuesta y los candidatos ICE; después el juego va directo por el DataChannel (P2P).
 *
 * - `PeerJsSignaling`: el broker público y gratuito de PeerJS (0.peerjs.com) por WebSocket. No usa
 *   la librería `peerjs`: el servidor solo reenvía mensajes `{type, dst, payload}` entre ids
 *   conectados, así que basta con hablar su protocolo (OPEN / OFFER / ANSWER / CANDIDATE / EXPIRE…).
 * - `LocalSignaling`: BroadcastChannel entre pestañas del mismo navegador (pruebas e2e y desarrollo
 *   sin internet: `?signal=local`).
 */

export type SignalKind = 'offer' | 'answer' | 'ice' | 'bye';

export interface SignalMessage {
  kind: SignalKind;
  data?: unknown;
}

export interface Signaling {
  readonly id: string;
  /** Se conecta con su id; falla si el id ya está tomado o no hay conexión. */
  open(): Promise<void>;
  send(dst: string, msg: SignalMessage): void;
  /** Mensaje de otro id. */
  onMessage: (src: string, msg: SignalMessage) => void;
  /** El broker no encontró a `dst` (la sala no existe o el host se fue). */
  onUnreachable: (dst: string) => void;
  close(): void;
}

const TYPE: Record<SignalKind, string> = { offer: 'OFFER', answer: 'ANSWER', ice: 'CANDIDATE', bye: 'LEAVE' };
const KIND: Record<string, SignalKind> = { OFFER: 'offer', ANSWER: 'answer', CANDIDATE: 'ice', LEAVE: 'bye' };

export class PeerJsSignaling implements Signaling {
  onMessage: (src: string, msg: SignalMessage) => void = () => {};
  onUnreachable: (dst: string) => void = () => {};
  private ws: WebSocket | null = null;
  private beat = 0;

  constructor(
    readonly id: string,
    private url = 'wss://0.peerjs.com/peerjs?key=peerjs',
  ) {}

  open(): Promise<void> {
    const token = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.url}&id=${encodeURIComponent(this.id)}&token=${token}`);
      this.ws = ws;
      const to = window.setTimeout(() => reject(new Error('timeout')), 10000);
      ws.onmessage = (ev) => {
        let m: { type?: string; src?: string; dst?: string; payload?: unknown };
        try {
          m = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (m.type === 'OPEN') {
          window.clearTimeout(to);
          // El broker cierra la conexión si no hay latido
          this.beat = window.setInterval(() => this.raw({ type: 'HEARTBEAT' }), 5000);
          resolve();
        } else if (m.type === 'ID-TAKEN' || m.type === 'INVALID-KEY' || m.type === 'ERROR') {
          window.clearTimeout(to);
          reject(new Error(m.type === 'ID-TAKEN' ? 'id-taken' : 'error'));
        } else if (m.type === 'EXPIRE' && m.src) this.onUnreachable(m.src);
        else if (m.type && KIND[m.type] && m.src) this.onMessage(m.src, { kind: KIND[m.type], data: m.payload });
      };
      ws.onerror = () => {
        window.clearTimeout(to);
        reject(new Error('network'));
      };
      ws.onclose = () => window.clearInterval(this.beat);
    });
  }

  send(dst: string, msg: SignalMessage): void {
    this.raw({ type: TYPE[msg.kind], dst, payload: msg.data ?? null });
  }

  private raw(o: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }

  close(): void {
    window.clearInterval(this.beat);
    this.ws?.close();
    this.ws = null;
  }
}

/** Señalización entre pestañas del mismo navegador (sin red). */
export class LocalSignaling implements Signaling {
  onMessage: (src: string, msg: SignalMessage) => void = () => {};
  onUnreachable: (dst: string) => void = () => {};
  private ch: BroadcastChannel | null = null;
  private seen = new Set<string>();

  constructor(readonly id: string) {}

  open(): Promise<void> {
    const ch = new BroadcastChannel('rebuilt-sim-signal');
    this.ch = ch;
    ch.onmessage = (ev) => {
      const m = ev.data as { src: string; dst: string; msg?: SignalMessage; ping?: boolean; pong?: boolean };
      if (m.dst !== this.id) return;
      if (m.ping) ch.postMessage({ src: this.id, dst: m.src, pong: true });
      else if (m.pong) this.seen.add(m.src);
      else if (m.msg) this.onMessage(m.src, m.msg);
    };
    return Promise.resolve();
  }

  send(dst: string, msg: SignalMessage): void {
    if (!this.ch) return;
    this.ch.postMessage({ src: this.id, dst, msg });
    // Como el broker: si nadie con ese id responde, avisa
    if (msg.kind === 'offer' && !this.seen.has(dst)) {
      this.ch.postMessage({ src: this.id, dst, ping: true });
      window.setTimeout(() => {
        if (!this.seen.has(dst)) this.onUnreachable(dst);
      }, 1500);
    }
  }

  close(): void {
    this.ch?.close();
    this.ch = null;
  }
}
