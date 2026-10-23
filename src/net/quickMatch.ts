/**
 * Partida rápida (botón "Jugar" de En línea): sin códigos. Se busca en el directorio de salas
 * públicas una sala rápida con lugar; si no hay, se abre una propia que se anuncia y arranca sola
 * (la IA llena los lugares vacíos). En una sala rápida se puede entrar a medio match: el jugador
 * toma un robot de la IA. Aquí solo las decisiones (puras, con pruebas); la red, en Online.ts y
 * el flujo, en App.
 */
import { NET } from '../config/net';
import type { PublicRoom } from './directory';

export const QUICK = {
  /** Tiempo para juntar los anuncios del directorio antes de decidir (ms). */
  searchMs: 1600,
  /** Lobby de una sala rápida nueva: arranca sola tras este tiempo (s). */
  lobbySeconds: 25,
  /** Cuando entra alguien, al menos este tiempo para elegir alianza y robot (s). */
  joinGrace: 8,
  /** Tope de espera desde que se abrió el lobby (s): no se alarga para siempre. */
  maxLobbySeconds: 45,
  /** Con los 6 lugares ocupados por personas, arranca en (s). */
  fullStart: 3,
  /** Ya no se entra a un match al que le quedan menos de estos segundos. */
  lateJoinMin: 30,
  /** Intentos de entrar (si una sala se llena o se cae, la siguiente). */
  tries: 3,
};

/** Salas a las que conviene entrar, de mejor a peor (sin las de `skip`). */
export function rankQuickRooms(rooms: PublicRoom[], skip: ReadonlySet<string> = new Set()): PublicRoom[] {
  return rooms
    .filter((r) => r.quick && r.open && !skip.has(r.code) && r.players < NET.maxPlayers && (!r.started || r.left >= QUICK.lateJoinMin))
    .sort(
      (a, b) =>
        // primero un lobby (se juega el match completo), luego la que tenga más gente (se llena antes),
        // a medio match la que tenga más tiempo por delante; al final, la más reciente
        Number(a.started) - Number(b.started) || b.players - a.players || b.left - a.left || b.ts - a.ts,
    );
}

/**
 * Dos jugadores que pican "Jugar" al mismo tiempo no ven sala y abren una cada quien. El host de
 * un lobby rápido en el que sigue solo se cambia a otro lobby rápido: al que tenga gente o, entre
 * dos solitarios, al de código menor (así solo uno de los dos se mueve). Devuelve a cuál, o null.
 */
export function mergeTarget(mine: { code: string; players: number }, rooms: PublicRoom[]): PublicRoom | null {
  if (mine.players > 1) return null;
  return rankQuickRooms(rooms.filter((r) => !r.started && r.code !== mine.code)).find((r) => r.players > 1 || r.code < mine.code) ?? null;
}

/**
 * Cuándo arranca un lobby rápido (ms, mismo reloj que `now`): `opened` = cuándo se abrió,
 * `current` = la hora prevista, `humans` = personas en la sala, `joined` = alguien acaba de entrar.
 */
export function nextAutoStart(now: number, opened: number, current: number, humans: number, joined: boolean): number {
  let at = current;
  if (joined) at = Math.max(at, Math.min(now + QUICK.joinGrace * 1000, opened + QUICK.maxLobbySeconds * 1000));
  if (humans >= NET.maxPlayers) at = Math.min(at, now + QUICK.fullStart * 1000);
  return at;
}
