/**
 * Modo en línea: salas con código, lobby y el flujo del match.
 *
 * Modelo "host autoritativo": el navegador del host corre la física, la IA y el árbitro como en
 * un match local (los jugadores remotos son slots de jugador más, con su propia cámara virtual);
 * los clientes mandan sus controles y dibujan el estado que les llega (ver Replica). Las
 * conexiones son P2P por WebRTC; el broker de señalización solo presenta a los navegadores.
 */
import { NET } from '../config/net';
import { CAD_ROBOTS, ROBOT_PRESETS, robotById, type RobotSpec } from '../config/robots';
import type { Alliance, StationNumber } from '../core/types';
import type { GameSession, RobotSlotConfig, SessionConfig, SessionHooks } from '../game/GameSession';
import { emptyInput, type ButtonAction, type PlayerInput } from '../input/actions';
import { PeerLink, type LinkData } from './PeerLink';
import {
  decodeInput,
  encodeInput,
  encodeSnapshot,
  newFuelSnap,
  roomCode,
  type ClientMsg,
  type FuelSnap,
  type HostMsg,
  type LobbyInfo,
  type NetCamera,
  type NetEvent,
} from './protocol';
import { captureFuel, captureRobots, captureSlow, Replica } from './Replica';
import { RoomAnnouncer } from './directory';
import { LocalSignaling, PeerJsSignaling, type Signaling } from './signaling';

export function makeSignaling(id: string): Signaling {
  return new URLSearchParams(location.search).get('signal') === 'local' ? new LocalSignaling(id) : new PeerJsSignaling(id);
}

const hostId = (code: string) => `${NET.idPrefix}${code}`;

/** Robot que pide un jugador: los del juego, de la copia local; los de su editor, tal cual. */
function safeSpec(spec: RobotSpec | undefined): RobotSpec {
  const known = ROBOT_PRESETS.find((r) => r.id === spec?.id);
  if (known) return structuredClone(known);
  const ok = spec && typeof spec.name === 'string' && typeof spec.hopperCapacity === 'number' && typeof spec.shooter === 'object';
  return ok ? structuredClone(spec) : structuredClone(CAD_ROBOTS[0]);
}

interface Remote {
  id: string;
  link: PeerLink;
  name: string;
  alliance: Alliance;
  spec: RobotSpec;
  joined: boolean;
  /** Slot de jugador en la sesión (1…5) y robot. */
  slot: number;
  robot: number;
  input: PlayerInput;
  pressed: Set<ButtonAction>;
  /** Solo mira: sin robot; puede entrar con el match empezado. */
  spectator: boolean;
  /** Espectador que entró a medio match: le falta el FUEL completo (ver tick). */
  needsKey: boolean;
}

// ------------------------------------------------------------------ host
export class HostRoom {
  readonly remotes = new Map<string, Remote>();
  session: GameSession | null = null;
  me = { name: '', alliance: 'blue' as Alliance, spec: robotById('') };
  fillAi = true;
  difficulty = 'normal';
  fuel = 0;
  /** Pública: aparece en la lista de salas; privada: solo con el código. */
  private announcer: RoomAnnouncer | null = null;
  /** Robots de la IA para los lugares libres. */
  aiPool: () => RobotSpec[] = () => CAD_ROBOTS;
  onLobby: () => void = () => {};
  onLeft: (name: string) => void = () => {};
  private sent: FuelSnap | null = null;
  private fuelNow: FuelSnap | null = null;
  private snapAcc = 0;
  private slowAcc = 0;

  private constructor(
    readonly code: string,
    private sig: Signaling,
  ) {
    sig.onMessage = (src, msg) => {
      let r = this.remotes.get(src);
      if (!r && msg.kind === 'offer') r = this.accept(src);
      if (r) void r.link.handleSignal(msg);
    };
  }

  /** Abre una sala nueva (reintenta si el código ya existe). */
  static async create(): Promise<HostRoom> {
    let err: unknown;
    for (let k = 0; k < 4; k++) {
      const code = roomCode();
      const sig = makeSignaling(hostId(code));
      try {
        await sig.open();
        return new HostRoom(code, sig);
      } catch (e) {
        sig.close();
        err = e;
        if ((e as Error).message !== 'id-taken') break;
      }
    }
    throw err;
  }

  get started(): boolean {
    return !!this.session;
  }

  private accept(id: string): Remote {
    const link = new PeerLink(this.sig, id, false);
    const r: Remote = { id, link, name: '', alliance: 'red', spec: robotById(''), joined: false, slot: -1, robot: -1, input: emptyInput(), pressed: new Set(), spectator: false, needsKey: false };
    this.remotes.set(id, r);
    link.onData = (d) => this.onData(r, d);
    link.onClose = () => this.drop(r);
    return r;
  }

  private onData(r: Remote, d: LinkData): void {
    if (typeof d !== 'string') return;
    let m: ClientMsg;
    try {
      m = JSON.parse(d);
    } catch {
      return;
    }
    if (m.t === 'hello') {
      const spectate = !!m.spectate;
      const players = this.players().length + 1;
      const watching = this.joined().filter((x) => x.spectator).length;
      const reject =
        m.v !== NET.protocol ? 'version' : spectate ? (watching >= NET.maxSpectators ? 'full' : null) : this.started ? 'started' : players >= NET.maxPlayers ? 'full' : null;
      if (reject) {
        this.send(r, { t: 'reject', reason: reject });
        setTimeout(() => r.link.close(), 500);
        return;
      }
      r.joined = true;
      r.spectator = spectate;
      r.name = String(m.name || '').slice(0, 24) || (spectate ? `👁 ${watching + 1}` : `P${players + 1}`);
      r.alliance = m.alliance === 'blue' ? 'blue' : 'red';
      r.spec = safeSpec(m.spec);
      this.send(r, { t: 'welcome', id: r.id });
      // con el match empezado, el espectador entra directo a verlo
      if (spectate && this.session) this.startSpectator(r, this.session);
      this.lobbyChanged();
    } else if (m.t === 'pick' && r.joined && !r.spectator && !this.started) {
      r.alliance = m.alliance === 'blue' ? 'blue' : 'red';
      r.spec = safeSpec(m.spec);
      this.lobbyChanged();
    } else if (m.t === 'in' && r.joined && r.robot >= 0) {
      r.input = decodeInput(m.i);
      // los flancos se juntan hasta el siguiente frame del host
      for (const a of r.input.pressed) r.pressed.add(a);
      if (m.cam) this.session?.setRemoteCamera(r.slot, m.cam);
    } else if (m.t === 'bye') r.link.close();
  }

  private drop(r: Remote): void {
    if (!this.remotes.delete(r.id) || !r.joined) return;
    if (this.session && r.robot >= 0) {
      // el resto del match lo maneja la IA
      this.session.handOverToAi(r.robot);
      this.broadcastEvent({ k: 'left', name: r.name });
    }
    this.onLeft(r.name);
    this.lobbyChanged();
  }

  private send(r: Remote, m: HostMsg): void {
    r.link.sendJson(m);
  }

  private joined(): Remote[] {
    return [...this.remotes.values()].filter((r) => r.joined && r.link.open);
  }

  /** Jugadores remotos (sin los espectadores). */
  private players(): Remote[] {
    return this.joined().filter((r) => !r.spectator);
  }

  lobby(): LobbyInfo {
    return {
      players: [
        { id: 'host', name: this.me.name || 'Host', alliance: this.me.alliance, robotName: this.me.spec.name, team: this.me.spec.teamNumber, host: true },
        ...this.players().map((r) => ({ id: r.id, name: r.name, alliance: r.alliance, robotName: r.spec.name, team: r.spec.teamNumber, host: false })),
        ...this.joined()
          .filter((r) => r.spectator)
          .map((r) => ({ id: r.id, name: r.name, alliance: r.alliance, robotName: '', team: 0, host: false, spectator: true })),
      ],
      difficulty: this.difficulty,
      fillAi: this.fillAi,
      fuel: this.fuel,
    };
  }

  get isPublic(): boolean {
    return !!this.announcer;
  }

  /** Hace la sala pública (la anuncia en el directorio) o privada. Falla si no hay directorio. */
  async setPublic(on: boolean): Promise<void> {
    if (on === this.isPublic) return;
    if (!on) {
      this.announcer?.stop();
      this.announcer = null;
      return;
    }
    const a = new RoomAnnouncer(this.code);
    this.announcer = a;
    this.announce();
    try {
      await a.start();
    } catch (e) {
      if (this.announcer === a) this.announcer = null;
      a.stop();
      throw e;
    }
  }

  private announce(): void {
    this.announcer?.update({ name: this.me.name || 'Host', players: this.players().length + 1, started: this.started });
  }

  lobbyChanged(): void {
    this.announce();
    const info = this.lobby();
    for (const r of this.joined()) this.send(r, { t: 'lobby', info });
    this.onLobby();
  }

  /**
   * Arma los robots del match: el host es el slot 0; cada jugador remoto, el siguiente slot en su
   * alianza (si está llena, pasa a la otra); los lugares libres, IA (si `fillAi`).
   */
  buildRobots(): RobotSlotConfig[] {
    const robots: RobotSlotConfig[] = [];
    const count: Record<Alliance, number> = { red: 0, blue: 0 };
    const seat = (al: Alliance, spec: RobotSpec, slot: number): number => {
      const a: Alliance = count[al] < 3 ? al : al === 'red' ? 'blue' : 'red';
      if (count[a] >= 3) return -1;
      count[a]++;
      robots.push({ spec: structuredClone(spec), alliance: a, station: count[a] as StationNumber, control: { type: 'player', slot } });
      return robots.length - 1;
    };
    seat(this.me.alliance, this.me.spec, 0);
    this.players().forEach((r, k) => {
      r.slot = k + 1;
      r.robot = seat(r.alliance, r.spec, r.slot);
    });
    if (this.fillAi) {
      let k = 0;
      const pool = this.aiPool();
      for (const a of ['blue', 'red'] as Alliance[])
        while (count[a] < 3) {
          count[a]++;
          const spec = structuredClone(pool[k++ % pool.length]);
          robots.push({ spec, alliance: a, station: count[a] as StationNumber, control: { type: 'ai' } });
        }
    }
    return robots;
  }

  /** La sesión del host ya existe: manda a cada cliente su copia de la configuración. */
  begin(s: GameSession): void {
    this.session = s;
    this.announce();
    this.sent = newFuelSnap(s.fuel.count);
    this.fuelNow = newFuelSnap(s.fuel.count);
    this.snapAcc = 1;
    this.slowAcc = 1;
    for (const r of this.joined()) {
      if (r.spectator) {
        this.startSpectator(r, s);
        continue;
      }
      if (r.robot < 0) continue;
      r.input = emptyInput();
      r.pressed.clear();
      const cfg: SessionConfig = {
        ...s.cfg,
        net: { role: 'client', localPlayers: 1 },
        robots: s.cfg.robots.map((rc, i) => ({ ...rc, control: i === r.robot ? { type: 'player', slot: 0 } : { type: 'none' }, plan: undefined })),
      };
      this.send(r, { t: 'start', cfg, robot: r.robot });
    }
  }

  /**
   * Manda al espectador el match (ningún robot es suyo). Recibe el estado desde el siguiente envío,
   * con el FUEL completo (needsKey) porque los demás solo reciben lo que cambia.
   */
  private startSpectator(r: Remote, s: GameSession): void {
    r.robot = -1;
    r.slot = -1;
    r.needsKey = true;
    const cfg: SessionConfig = {
      ...s.cfg,
      net: { role: 'client', localPlayers: 1 },
      robots: s.cfg.robots.map((rc) => ({ ...rc, control: { type: 'none' }, plan: undefined })),
    };
    this.send(r, { t: 'start', cfg, robot: -1 });
    this.slowAcc = 1;
  }

  /** Controles de todos los slots: los locales y, en su slot, los de cada jugador remoto. */
  mergeInputs(local: PlayerInput[]): PlayerInput[] {
    const out = local.slice();
    for (const r of this.remotes.values()) {
      if (r.slot < 1) continue;
      const inp: PlayerInput = { ...r.input, pressed: new Set(r.pressed) };
      // la cámara y la pausa son de su pantalla
      inp.pressed.delete('cameraNext');
      inp.pressed.delete('pause');
      r.pressed.clear();
      while (out.length < r.slot) out.push(emptyInput());
      out[r.slot] = inp;
    }
    return out;
  }

  /** Después de simular: manda el estado (30 Hz) y el estado lento (4 Hz). */
  tick(dt: number): void {
    const s = this.session;
    if (!s || !this.sent || !this.fuelNow) return;
    const peers = this.joined().filter((r) => r.robot >= 0 || r.spectator);
    this.snapAcc += dt;
    this.slowAcc += dt;
    if (this.snapAcc >= 1 / NET.snapshotHz) {
      this.snapAcc = 0;
      captureFuel(s.fuel, this.fuelNow);
      const robots = captureRobots(s);
      const buf = encodeSnapshot(s.simTime, s.match?.t ?? 0, robots, this.fuelNow, this.sent);
      for (const r of peers) if (!r.needsKey) r.link.send(buf);
      // el recién llegado: todo el FUEL (desde aquí ya tiene lo mismo que `sent`)
      const late = peers.filter((r) => r.needsKey);
      if (late.length) {
        const key = encodeSnapshot(s.simTime, s.match?.t ?? 0, robots, this.fuelNow, newFuelSnap(s.fuel.count));
        for (const r of late) {
          r.needsKey = false;
          r.link.send(key);
        }
      }
    }
    if (this.slowAcc >= 1 / NET.slowHz) this.sendSlow();
  }

  sendSlow(): void {
    if (!this.session) return;
    this.slowAcc = 0;
    const msg = JSON.stringify({ t: 'slow', s: captureSlow(this.session) } satisfies HostMsg);
    for (const r of this.joined()) r.link.send(msg);
  }

  broadcastEvent(e: NetEvent): void {
    const msg = JSON.stringify({ t: 'ev', e } satisfies HostMsg);
    for (const r of this.joined()) r.link.send(msg);
  }

  /** Envuelve los hooks de la sesión del host para que los clientes también oigan y vean. */
  wrapHooks(h: SessionHooks, isLocal: (robot: number) => boolean): SessionHooks {
    return {
      ...h,
      matchEvent: (e) => {
        h.matchEvent?.(e);
        if (e.type === 'evalAutoTower' || e.type === 'evalTeleopTower') return;
        // primero el marcador al día (al final, los resultados salen de él)
        this.sendSlow();
        this.broadcastEvent({ k: 'match', e });
      },
      fuelScored: (hub, counted, x, y, z) => {
        h.fuelScored?.(hub, counted, x, y, z);
        this.broadcastEvent({ k: 'score', hub, counted, x, y, z });
      },
      launch: (robot, kind, isPlayer) => {
        h.launch?.(robot, kind, isPlayer && isLocal(robot.index));
        this.broadcastEvent({ k: 'launch', robot: robot.index, kind });
      },
      hpAction: (a, what) => {
        h.hpAction?.(a, what);
        this.broadcastEvent({ k: 'hp', a, what });
      },
      impact: (strength, slot, x, y, z, robots = []) => {
        h.impact?.(strength, slot < (this.session?.localCount ?? 1) ? slot : -1, x, y, z, robots);
        this.broadcastEvent({ k: 'impact', s: strength, robots, x, y, z });
      },
      toast: (key, robot) => {
        if (isLocal(robot)) h.toast?.(key, robot);
        else this.broadcastEvent({ k: 'toast', key, robot });
      },
    };
  }

  /** Regresa al lobby (después de un match). */
  endMatch(): void {
    this.session = null;
    for (const r of this.remotes.values()) {
      r.robot = -1;
      r.slot = -1;
    }
    this.lobbyChanged();
  }

  close(): void {
    this.announcer?.stop();
    this.announcer = null;
    for (const r of this.remotes.values()) {
      this.send(r, { t: 'close' });
      r.link.onClose = () => {};
      setTimeout(() => r.link.close(), 200);
    }
    this.remotes.clear();
    setTimeout(() => this.sig.close(), 300);
  }
}

// ------------------------------------------------------------------ cliente
/** `p2p`: el host respondió pero la conexión directa no se pudo abrir (red que bloquea P2P). */
export type JoinError = 'notFound' | 'full' | 'version' | 'started' | 'network' | 'p2p';

export class ClientRoom {
  onLobby: (info: LobbyInfo) => void = () => {};
  onStart: (cfg: SessionConfig, robot: number) => void = () => {};
  onEvent: (e: NetEvent) => void = () => {};
  onClosed: () => void = () => {};
  lobby: LobbyInfo | null = null;
  replica: Replica | null = null;
  /** Índice del robot propio en el match (−1 = espectador). */
  robot = -1;
  /** Entró solo a ver. */
  spectator = false;
  private lastSend = 0;
  private lastKey = '';

  private constructor(
    readonly code: string,
    private sig: Signaling,
    private link: PeerLink,
  ) {}

  /** Entra a la sala `code` (se resuelve al recibir la bienvenida del host). */
  static join(code: string, hello: { name: string; alliance: Alliance; spec: RobotSpec; spectate?: boolean }): Promise<ClientRoom> {
    const sig = makeSignaling(`${hostId(code)}c${Math.random().toString(36).slice(2, 10)}`);
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (e: JoinError) => {
        if (done) return;
        done = true;
        sig.close();
        reject(new Error(e));
      };
      // sin respuesta del host: la sala no existe; con respuesta pero sin canal: la red bloquea P2P
      let answered = false;
      let to = window.setTimeout(() => fail('notFound'), 12000);
      sig
        .open()
        .then(() => {
          const link = new PeerLink(sig, hostId(code), true);
          const room = new ClientRoom(code, sig, link);
          sig.onMessage = (src, msg) => {
            if (src !== hostId(code)) return;
            if (msg.kind === 'answer' && !answered) {
              answered = true;
              window.clearTimeout(to);
              to = window.setTimeout(() => fail('p2p'), 20000);
            }
            void link.handleSignal(msg);
          };
          sig.onUnreachable = () => fail('notFound');
          link.onOpen = () => link.sendJson({ t: 'hello', v: NET.protocol, ...hello } satisfies ClientMsg);
          link.onClose = () => {
            if (!done) fail(answered ? 'p2p' : 'network');
            else room.onClosed();
          };
          link.onData = (d) => {
            if (typeof d !== 'string') {
              room.replica?.push(d);
              return;
            }
            let m: HostMsg;
            try {
              m = JSON.parse(d);
            } catch {
              return;
            }
            if (m.t === 'welcome') {
              done = true;
              room.spectator = !!hello.spectate;
              window.clearTimeout(to);
              resolve(room);
            } else if (m.t === 'reject') {
              window.clearTimeout(to);
              fail(m.reason);
            } else room.handle(m);
          };
        })
        .catch(() => fail('network'));
    });
  }

  private handle(m: HostMsg): void {
    if (m.t === 'lobby') {
      this.lobby = m.info;
      this.onLobby(m.info);
    } else if (m.t === 'start') {
      this.robot = m.robot;
      this.onStart(m.cfg, m.robot);
    } else if (m.t === 'slow') this.replica?.applySlow(m.s);
    else if (m.t === 'ev') this.onEvent(m.e);
    else if (m.t === 'close') this.link.close();
  }

  /** Id en el broker (= id del jugador en el lobby del host). */
  get id(): string {
    return this.sig.id;
  }

  /** La sesión del cliente ya existe: desde ahora recibe el estado del host. */
  attach(s: GameSession): Replica {
    this.replica = new Replica(s);
    s.replica = this.replica;
    return this.replica;
  }

  pick(alliance: Alliance, spec: RobotSpec): void {
    this.link.sendJson({ t: 'pick', alliance, spec } satisfies ClientMsg);
  }

  /** Controles y cámara (cada frame con algo nuevo; si no, a 15 Hz). */
  sendInput(inp: PlayerInput, cam: NetCamera): void {
    const now = performance.now();
    const i = encodeInput(inp);
    const key = `${i.mx},${i.my},${i.rot},${i.held},${i.mouse}`;
    if (!i.pressed && key === this.lastKey && now - this.lastSend < 66) return;
    this.lastKey = key;
    this.lastSend = now;
    this.link.sendJson({ t: 'in', i, cam } satisfies ClientMsg);
  }

  close(): void {
    this.link.onClose = () => {};
    this.link.sendJson({ t: 'bye' } satisfies ClientMsg);
    setTimeout(() => {
      this.link.close();
      this.sig.close();
    }, 200);
  }
}
