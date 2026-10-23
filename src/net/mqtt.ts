/**
 * Cliente MQTT 3.1.1 mínimo sobre WebSocket (solo QoS 0): CONNECT con "last will", PUBLISH
 * (con retain), SUBSCRIBE y PINGREQ. Lo usa el directorio de salas públicas con un broker
 * público y gratuito; sin dependencias. El codec es puro (pruebas en tests/net.test.ts).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Longitud restante (varint de MQTT). */
export function encodeLength(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}

const str = (s: string | Uint8Array): number[] => {
  const b = typeof s === 'string' ? enc.encode(s) : s;
  return [b.length >> 8, b.length & 0xff, ...b];
};

const packet = (head: number, body: number[]): Uint8Array<ArrayBuffer> => new Uint8Array([head, ...encodeLength(body.length), ...body]);

export function connectPacket(clientId: string, keepAlive: number, will?: { topic: string; payload: string; retain: boolean }): Uint8Array<ArrayBuffer> {
  // banderas: sesión limpia (0x02), will (0x04), will retain (0x20)
  const flags = 0x02 | (will ? 0x04 | (will.retain ? 0x20 : 0) : 0);
  const body = [...str('MQTT'), 4, flags, keepAlive >> 8, keepAlive & 0xff, ...str(clientId)];
  if (will) body.push(...str(will.topic), ...str(enc.encode(will.payload)));
  return packet(0x10, body);
}

export function publishPacket(topic: string, payload: string, retain: boolean): Uint8Array<ArrayBuffer> {
  return packet(0x30 | (retain ? 1 : 0), [...str(topic), ...enc.encode(payload)]);
}

export function subscribePacket(id: number, filter: string): Uint8Array<ArrayBuffer> {
  return packet(0x82, [id >> 8, id & 0xff, ...str(filter), 0]);
}

export const PINGREQ = new Uint8Array([0xc0, 0]);
export const DISCONNECT = new Uint8Array([0xe0, 0]);

export type MqttPacket = { type: 'connack'; rc: number } | { type: 'publish'; topic: string; payload: string } | { type: 'other'; head: number };

/** Corta un búfer en paquetes completos; devuelve los paquetes y lo que sobra. */
export function parsePackets(buf: Uint8Array): { packets: MqttPacket[]; rest: Uint8Array } {
  const packets: MqttPacket[] = [];
  let k = 0;
  while (k < buf.length) {
    let len = 0;
    let mul = 1;
    let i = k + 1;
    for (;;) {
      if (i >= buf.length) return { packets, rest: buf.slice(k) };
      const b = buf[i++];
      len += (b & 0x7f) * mul;
      mul *= 128;
      if (!(b & 0x80)) break;
      if (mul > 128 ** 4) return { packets, rest: new Uint8Array(0) }; // corrupto
    }
    if (i + len > buf.length) return { packets, rest: buf.slice(k) };
    const head = buf[k];
    const body = buf.subarray(i, i + len);
    if (head >> 4 === 2) packets.push({ type: 'connack', rc: body[1] ?? 255 });
    else if (head >> 4 === 3) {
      const tl = (body[0] << 8) | body[1];
      const qos = (head >> 1) & 3;
      const start = 2 + tl + (qos ? 2 : 0);
      packets.push({ type: 'publish', topic: dec.decode(body.subarray(2, 2 + tl)), payload: dec.decode(body.subarray(start)) });
    } else packets.push({ type: 'other', head });
    k = i + len;
  }
  return { packets, rest: new Uint8Array(0) };
}

export class MqttClient {
  onMessage: (topic: string, payload: string) => void = () => {};
  onClose: () => void = () => {};
  private ws: WebSocket | null = null;
  private buf: Uint8Array = new Uint8Array(0);
  private ping = 0;
  private nextId = 1;

  constructor(private url: string) {}

  connect(will?: { topic: string; payload: string; retain: boolean }): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const to = window.setTimeout(() => reject(new Error('timeout')), 8000);
      ws.onopen = () => ws.send(connectPacket(`rbsim${Math.random().toString(36).slice(2, 12)}`, 60, will));
      ws.onmessage = (ev) => {
        const data = new Uint8Array(ev.data as ArrayBuffer);
        const all = new Uint8Array(this.buf.length + data.length);
        all.set(this.buf);
        all.set(data, this.buf.length);
        const { packets, rest } = parsePackets(all);
        this.buf = rest;
        for (const p of packets) {
          if (p.type === 'connack') {
            window.clearTimeout(to);
            if (p.rc !== 0) return reject(new Error(`connack ${p.rc}`));
            this.ping = window.setInterval(() => this.send(PINGREQ), 30000);
            resolve();
          } else if (p.type === 'publish') this.onMessage(p.topic, p.payload);
        }
      };
      ws.onerror = () => {
        window.clearTimeout(to);
        reject(new Error('network'));
      };
      ws.onclose = () => {
        window.clearInterval(this.ping);
        this.onClose();
      };
    });
  }

  private send(p: Uint8Array<ArrayBuffer>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(p);
  }

  publish(topic: string, payload: string, retain = false): void {
    this.send(publishPacket(topic, payload, retain));
  }

  subscribe(filter: string): void {
    this.send(subscribePacket(this.nextId++ & 0xffff || 1, filter));
  }

  close(): void {
    this.onClose = () => {};
    this.send(DISCONNECT);
    window.clearInterval(this.ping);
    this.ws?.close();
    this.ws = null;
  }
}
