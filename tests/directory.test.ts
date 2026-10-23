import { describe, expect, it } from 'vitest';
import { parseAnnouncement } from '../src/net/directory';
import { connectPacket, encodeLength, parsePackets, publishPacket, subscribePacket } from '../src/net/mqtt';

describe('MQTT mínimo', () => {
  it('longitud variable', () => {
    expect(encodeLength(0)).toEqual([0]);
    expect(encodeLength(127)).toEqual([127]);
    expect(encodeLength(321)).toEqual([0xc1, 0x02]);
  });

  it('PUBLISH retenido y SUBSCRIBE', () => {
    expect([...publishPacket('a/b', 'hi', true)]).toEqual([0x31, 7, 0, 3, 97, 47, 98, 104, 105]);
    expect([...subscribePacket(1, 'a/+')]).toEqual([0x82, 8, 0, 1, 0, 3, 97, 47, 43, 0]);
  });

  it('CONNECT con last will retenido', () => {
    const p = connectPacket('id', 60, { topic: 't', payload: '', retain: true });
    // "MQTT", nivel 4, banderas: sesión limpia + will + will retain
    expect([...p.subarray(2, 10)]).toEqual([0, 4, 77, 81, 84, 84, 4, 0x26]);
  });

  it('paquetes partidos entre mensajes del WebSocket', () => {
    const a = publishPacket('x/AB', '{"n":1}', true);
    const both = new Uint8Array([0x20, 2, 0, 0, ...a]);
    const first = parsePackets(both.subarray(0, 7));
    expect(first.packets).toEqual([{ type: 'connack', rc: 0 }]);
    const rest = new Uint8Array([...first.rest, ...both.subarray(7)]);
    expect(parsePackets(rest).packets).toEqual([{ type: 'publish', topic: 'x/AB', payload: '{"n":1}' }]);
  });
});

describe('anuncios de salas públicas', () => {
  const now = 1_000_000;
  const ok = { v: 1, code: 'ABCDE', name: 'Bocho', players: 3, started: false, ts: now - 1000 };
  it('acepta un anuncio válido', () => {
    expect(parseAnnouncement('ABCDE', JSON.stringify(ok), now)).toEqual({ code: 'ABCDE', name: 'Bocho', players: 3, started: false, ts: now - 1000 });
  });
  it('descarta vacíos, viejos, de otra versión o con código que no coincide', () => {
    expect(parseAnnouncement('ABCDE', '', now)).toBeNull();
    expect(parseAnnouncement('ABCDE', JSON.stringify({ ...ok, ts: now - 200_000 }), now)).toBeNull();
    expect(parseAnnouncement('ABCDE', JSON.stringify({ ...ok, v: 99 }), now)).toBeNull();
    expect(parseAnnouncement('ZZZZZ', JSON.stringify(ok), now)).toBeNull();
    expect(parseAnnouncement('ABCDE', '{nope', now)).toBeNull();
  });
  it('acota los jugadores', () => {
    expect(parseAnnouncement('ABCDE', JSON.stringify({ ...ok, players: 99 }), now)?.players).toBe(6);
  });
});
