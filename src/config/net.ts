/**
 * Red del modo en línea. STUN público y gratuito (descubre la IP pública) y un relay TURN para las
 * redes que no dejan conectar directo (datos móviles, NAT simétrico, Wi-Fi sin "hairpinning"):
 * por defecto el TURN público y gratuito de freeturn.net (sin cuenta; el tráfico va cifrado con
 * DTLS de punta a punta, el relay no lo puede leer). Uno propio, p. ej. el de Cloudflare, se
 * define al compilar (VITE_TURN_URL, VITE_TURN_USER, VITE_TURN_PASS) y reemplaza al público.
 */
export const NET = {
  /** Versión del protocolo: host y clientes deben coincidir. */
  protocol: 2,
  /** Jugadores humanos por sala (6 robots en el campo). */
  maxPlayers: 6,
  /** Espectadores por sala (además de los jugadores; cada uno recibe el estado del host). */
  maxSpectators: 8,
  /** Estado del campo que manda el host (Hz). */
  snapshotHz: 30,
  /** Estado lento (marcador, faltas, estadísticas) (Hz). */
  slowHz: 4,
  /** Retraso de interpolación del cliente (s): margen para el jitter de la red. */
  interpDelay: 0.1,
  /** Prefijo de los ids en el broker (el código de sala va después). */
  idPrefix: 'rebuiltsim',
  /** Directorio de salas públicas: broker MQTT público y gratuito (WebSocket). */
  directoryUrl: 'wss://broker.hivemq.com:8884/mqtt',
};

/** Broker MQTT del directorio y de la señalización (`?broker=ws://…` lo cambia: pruebas con uno local). */
export function brokerUrl(): string {
  const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('broker');
  return q && /^wss?:\/\//.test(q) ? q : NET.directoryUrl;
}

export function iceServers(): RTCIceServer[] {
  const out: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  const env = import.meta.env;
  if (env.VITE_TURN_URL) out.push({ urls: String(env.VITE_TURN_URL).split(','), username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });
  else out.push({ urls: ['turn:freeturn.net:3478', 'turns:freeturn.net:5349'], username: 'free', credential: 'free' });
  return out;
}
