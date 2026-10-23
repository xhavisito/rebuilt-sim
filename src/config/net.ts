/**
 * Red del modo en línea. STUN público y gratuito (descubre la IP pública); un relay TURN es
 * opcional y solo se usa si se define al compilar (VITE_TURN_URL, VITE_TURN_USER, VITE_TURN_PASS),
 * p. ej. el de Cloudflare: sin él, algunas redes muy cerradas (NAT simétrico) no conectan.
 */
export const NET = {
  /** Versión del protocolo: host y clientes deben coincidir. */
  protocol: 1,
  /** Jugadores humanos por sala (6 robots en el campo). */
  maxPlayers: 6,
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

export function iceServers(): RTCIceServer[] {
  const out: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  const env = import.meta.env;
  if (env.VITE_TURN_URL) out.push({ urls: String(env.VITE_TURN_URL).split(','), username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });
  return out;
}
