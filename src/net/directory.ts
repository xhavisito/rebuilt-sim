/**
 * Directorio de salas públicas: el host de una sala pública la anuncia y la pantalla En línea
 * muestra la lista. Sin servidor propio: un mensaje "retained" por sala en un broker MQTT público
 * y gratuito (se borra al cerrar la sala o, si el host se cae, con su "last will"). Las privadas no
 * se anuncian: solo se entra con el código. `?signal=local` usa BroadcastChannel (pruebas).
 */
import { NET } from '../config/net';
import { MqttClient } from './mqtt';
import { parseRoomCode } from './protocol';

export interface PublicRoom {
  code: string;
  name: string;
  players: number;
  started: boolean;
  /** Sala de partida rápida (botón Jugar): arranca sola y deja entrar a medio match. */
  quick: boolean;
  /** Puede recibir a un jugador ahora (en el lobby con lugar o, rápida, con un robot de la IA). */
  open: boolean;
  /** Segundos que le quedan al match (0 en el lobby). */
  left: number;
  /** Cuándo se anunció (ms, reloj del host). */
  ts: number;
}

const TOPIC = 'rebuilt-sim/v1/rooms';
/** Un anuncio sin renovar en este tiempo ya no se lista (host caído sin last will). */
const STALE_MS = 90_000;
const REFRESH_MS = 30_000;

/** Valida un anuncio (viene de cualquiera que publique en el broker). */
export function parseAnnouncement(topicCode: string, payload: string, now = Date.now()): PublicRoom | null {
  if (!payload) return null;
  let o: Partial<PublicRoom> & { v?: number };
  try {
    o = JSON.parse(payload);
  } catch {
    return null;
  }
  const code = parseRoomCode(topicCode);
  if (!code || o.code !== code || o.v !== NET.protocol) return null;
  if (typeof o.ts !== 'number' || Math.abs(now - o.ts) > STALE_MS) return null;
  const players = Math.max(1, Math.min(NET.maxPlayers, Math.floor(Number(o.players) || 1)));
  const started = !!o.started;
  const left = Math.max(0, Math.min(600, Number(o.left) || 0));
  // (un anuncio sin `open`, de antes de la partida rápida: abierta si está en el lobby con lugar)
  const open = typeof o.open === 'boolean' ? o.open : !started && players < NET.maxPlayers;
  return { code, name: String(o.name ?? '').slice(0, 24), players, started, quick: !!o.quick, open, left, ts: o.ts };
}

export interface Transport {
  open(will?: { topic: string; payload: string; retain: boolean }): Promise<void>;
  publish(topic: string, payload: string, retain: boolean): void;
  subscribe(filter: string, on: (topic: string, payload: string) => void): void;
  close(): void;
}

class MqttTransport implements Transport {
  private c = new MqttClient(NET.directoryUrl);
  open(will?: { topic: string; payload: string; retain: boolean }) {
    return this.c.connect(will);
  }
  publish(topic: string, payload: string, retain: boolean) {
    this.c.publish(topic, payload, retain);
  }
  subscribe(filter: string, on: (topic: string, payload: string) => void) {
    this.c.onMessage = on;
    this.c.subscribe(filter);
  }
  close() {
    this.c.close();
  }
}

/** Entre pestañas: los anuncios se repiten seguido porque no hay "retained". */
class LocalTransport implements Transport {
  private ch = new BroadcastChannel('rebuilt-sim-directory');
  private last = new Map<string, string>();
  private timer = 0;
  open() {
    this.timer = window.setInterval(() => this.last.forEach((p, t) => this.ch.postMessage({ t, p })), 1000);
    return Promise.resolve();
  }
  publish(topic: string, payload: string) {
    this.last.set(topic, payload);
    this.ch.postMessage({ t: topic, p: payload });
  }
  subscribe(_f: string, on: (topic: string, payload: string) => void) {
    this.ch.onmessage = (e) => on(e.data.t, e.data.p);
  }
  close() {
    window.clearInterval(this.timer);
    this.ch.close();
  }
}

/** Broker MQTT público (o BroadcastChannel con `?signal=local`); también lo usa el ranking global. */
export const transport = (): Transport => (new URLSearchParams(location.search).get('signal') === 'local' ? new LocalTransport() : new MqttTransport());

/** Host de una sala pública: la anuncia mientras esté abierta. */
export class RoomAnnouncer {
  private t: Transport | null = null;
  private timer = 0;
  private info: Omit<PublicRoom, 'ts' | 'code'> = { name: '', players: 1, started: false, quick: false, open: true, left: 0 };

  constructor(readonly code: string) {}

  private get topic(): string {
    return `${TOPIC}/${this.code}`;
  }

  async start(): Promise<void> {
    if (this.t) return;
    const t = transport();
    this.t = t;
    // si el host se cae, el broker borra el anuncio (payload vacío retenido)
    await t.open({ topic: this.topic, payload: '', retain: true });
    if (this.t !== t) return;
    this.send();
    this.timer = window.setInterval(() => this.send(), REFRESH_MS);
  }

  update(info: Omit<PublicRoom, 'ts' | 'code'>): void {
    this.info = info;
    this.send();
  }

  private send(): void {
    this.t?.publish(this.topic, JSON.stringify({ v: NET.protocol, code: this.code, ...this.info, ts: Date.now() }), true);
  }

  stop(): void {
    window.clearInterval(this.timer);
    const t = this.t;
    this.t = null;
    if (!t) return;
    t.publish(this.topic, '', true);
    setTimeout(() => t.close(), 300);
  }
}

/** Lista de salas públicas en vivo. */
export class RoomBrowser {
  private t: Transport | null = null;
  private rooms = new Map<string, PublicRoom>();
  private timer = 0;
  onChange: (rooms: PublicRoom[]) => void = () => {};

  async start(): Promise<void> {
    const t = transport();
    this.t = t;
    await t.open();
    t.subscribe(`${TOPIC}/+`, (topic, payload) => {
      const code = topic.slice(TOPIC.length + 1);
      const r = parseAnnouncement(code, payload);
      if (r) this.rooms.set(r.code, r);
      else this.rooms.delete(code);
      this.emit();
    });
    // quita los que dejaron de anunciarse
    this.timer = window.setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [c, r] of this.rooms)
        if (now - r.ts > STALE_MS) {
          this.rooms.delete(c);
          changed = true;
        }
      if (changed) this.emit();
    }, 5000);
  }

  get list(): PublicRoom[] {
    return [...this.rooms.values()].sort((a, b) => Number(a.started) - Number(b.started) || b.ts - a.ts);
  }

  private emit(): void {
    this.onChange(this.list);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.t?.close();
    this.t = null;
  }
}
