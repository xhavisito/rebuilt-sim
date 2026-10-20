/**
 * Árbitro automático. Revisa el estado del juego en cada paso de física y aplica las
 * reglas del Game Manual TU22 (§7.4). Las reglas se cobran "como las percibe un REFEREE":
 * cada heurística y umbral está documentado junto a su regla.
 *
 * Penalizaciones (Tabla 6-6): MINOR = 5 y MAJOR = 15 puntos para el oponente.
 * MOMENTARY < ~3 s · CONTINUOUS > ~10 s · REPEATED = más de una vez en el match.
 */
import * as F from '../config/field';
import { isTeleop, T } from '../core/clock';
import type { RuleCode } from '../core/fouls';
import type { Match } from '../core/match';
import { opponent, type Alliance, type FoulSeverity } from '../core/types';
import type { HumanPlayer } from '../game/HumanPlayer';
import type { Robot } from '../game/Robot';
import { FLAG_FROM_HUB, FLAG_SHOT, type FuelSystem } from '../physics/FuelSystem';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export interface RefereeContext {
  robots: Robot[];
  match: Match;
  fuel: FuelSystem;
  pw: PhysicsWorld;
  humanPlayers: Record<Alliance, HumanPlayer>;
}

interface PinState {
  pinner: number;
  victim: number;
  count: number;
  /** Faltas ya cobradas (1 = MINOR a los 3 s, luego MAJOR cada 3 s). */
  charged: number;
  startP: { x: number; z: number };
  startV: { x: number; z: number };
  /** Segundos "en pausa" (separados o movidos 72 in). */
  away: number;
  active: boolean;
  carded: boolean;
}

const PIN_LIMIT = 3;
const SEP = F.PIN_SEPARATION; // 72 in

export class Referee {
  enabled = true;
  /** Robots con LEVEL 3 otorgado por G420. */
  readonly g420Level3 = new Set<number>();
  /** Robots inelegibles para TOWER (G414). */
  readonly g414 = new Set<number>();
  private pins = new Map<string, PinState>();
  /** Contactos robot-robot de este paso (pares i<j). */
  private contacts = new Set<string>();
  private prevContacts = new Set<string>();
  /** Robots que tocan el campo (para PIN transitivo). */
  private touchField = new Set<number>();
  private counts = new Map<string, number>();
  private cooldown = new Map<string, number>();
  private g403 = new Set<number>();
  private g408 = new Map<number, { last: number; n: number; charged: boolean }>();
  private g413 = new Map<number, number>();
  private g419 = new Map<Alliance, number>();
  private g427 = new Map<Alliance, number>();
  private rams = new Map<string, number[]>();
  /** Por FUEL: lanzado con los BUMPERS fuera de la ALLIANCE ZONE (G407) y oponente apuntado (G404). */
  private launchedOutside: Uint8Array;
  private aimedAt: Int16Array;

  constructor(private ctx: RefereeContext) {
    this.launchedOutside = new Uint8Array(ctx.fuel.count);
    this.aimedAt = new Int16Array(ctx.fuel.count).fill(-1);
  }

  // ------------------------------------------------------------------ utilidades
  private get t(): number {
    return this.ctx.match.t;
  }

  private foul(rule: RuleCode, sev: FoulSeverity, r: Robot | Alliance, note?: string): void {
    if (!this.enabled) return;
    const offender = typeof r === 'string' ? r : r.alliance;
    const idx = typeof r === 'string' ? -1 : r.index;
    this.ctx.match.addFoul(rule, sev, offender, idx, note);
    if (typeof r !== 'string') r.stats.fouls++;
    this.counts.set(`${rule}:${offender}:${idx}`, (this.counts.get(`${rule}:${offender}:${idx}`) ?? 0) + 1);
  }

  private card(rule: RuleCode, r: Robot, red = false): void {
    if (!this.enabled) return;
    this.ctx.match.addCard(red ? 'RED' : 'YELLOW', r.alliance, r.index, rule);
  }

  private count(rule: RuleCode, r: Robot): number {
    return this.counts.get(`${rule}:${r.alliance}:${r.index}`) ?? 0;
  }

  /** Evita cobrar la misma situación muchas veces seguidas. */
  private ready(key: string, seconds: number): boolean {
    const until = this.cooldown.get(key) ?? -Infinity;
    if (this.t < until) return false;
    this.cooldown.set(key, this.t + seconds);
    return true;
  }

  /** Extensión de la huella (con BUMPERS) a lo largo de X. */
  private extX(r: Robot): number {
    const h = r.phys.heading();
    return Math.abs(Math.cos(h)) * r.phys.outerL + Math.abs(Math.sin(h)) * r.phys.outerW;
  }

  /** ¿BUMPERS al menos parcialmente dentro de su ALLIANCE ZONE? */
  inZonePartially(r: Robot): boolean {
    const x = r.phys.curPos.x;
    const e = this.extX(r);
    return r.alliance === 'blue' ? x - e <= F.STARTING_LINE_X_BLUE : x + e >= -F.STARTING_LINE_X_BLUE;
  }

  private dist(a: Robot, b: Robot): number {
    return Math.hypot(a.phys.curPos.x - b.phys.curPos.x, a.phys.curPos.z - b.phys.curPos.z);
  }

  /** Distancia entre BUMPERS (aprox. con círculos inscritos). */
  private gap(a: Robot, b: Robot): number {
    return this.dist(a, b) - (Math.min(a.phys.outerL, a.phys.outerW) + Math.min(b.phys.outerL, b.phys.outerW));
  }

  private touchingTower(r: Robot): boolean {
    if (r.climbing) return true;
    const tw = F.towerInfo(r.alliance);
    const p = r.phys.curPos;
    const dx = Math.abs(p.x - tw.cx);
    return dx < F.TOWER_BASE_DEPTH + r.phys.outerL + 0.03 && Math.abs(p.z - tw.cz) < F.TOWER_WIDTH / 2 + r.phys.outerW;
  }

  // ------------------------------------------------------------------ eventos
  /** Se llama al lanzar un FUEL (G404, G407). */
  onLaunch(r: Robot, i: number, kind: 'shot' | 'pass' | 'corral'): void {
    this.launchedOutside[i] = this.inZonePartially(r) ? 0 : 1;
    this.aimedAt[i] = -1;
    if (kind === 'corral') return;
    // G404: ¿el tiro va dirigido a un robot rival cercano (y no al HUB)?
    const v = this.ctx.fuel.bodies[i].linvel();
    const yaw = Math.atan2(-v.z, v.x);
    const hub = F.hubCenter(r.alliance);
    const p = r.phys.curPos;
    const hubYaw = Math.atan2(-(hub.z - p.z), hub.x - p.x);
    for (const o of this.ctx.robots) {
      if (o.alliance === r.alliance) continue;
      const d = this.dist(r, o);
      if (d > 6) continue;
      const oy = Math.atan2(-(o.phys.curPos.z - p.z), o.phys.curPos.x - p.x);
      const off = Math.abs(Math.atan2(Math.sin(yaw - oy), Math.cos(yaw - oy)));
      const offHub = Math.abs(Math.atan2(Math.sin(yaw - hubYaw), Math.cos(yaw - hubYaw)));
      if (off < 0.14 && offHub > 0.3) this.aimedAt[i] = o.index;
    }
  }

  /** FUEL capturado por una intake (G408). */
  onIntake(r: Robot, i: number): void {
    if (!(this.ctx.fuel.flags[i] & FLAG_FROM_HUB)) return;
    // G408: CONTROL de FUEL liberado por el HUB antes de que toque otra cosa.
    // Una "instancia" agrupa capturas seguidas (el flujo se detiene > 1 s = nueva instancia).
    let st = this.g408.get(r.index);
    if (!st || this.t - st.last > 1.0) {
      st = { last: this.t, n: 0, charged: false };
      this.g408.set(r.index, st);
      this.foul('G408', 'MINOR', r);
    }
    st.n++;
    st.last = this.t;
    // Estratégico: estacionado bajo las salidas del HUB juntando varias → MAJOR (una vez por instancia)
    const hub = F.hubCenter(r.alliance === 'blue' ? 'blue' : 'red');
    const other = F.hubCenter(opponent(r.alliance));
    const nearExit = [hub, other].some((h) => Math.hypot(r.phys.curPos.x - h.x, r.phys.curPos.z - h.z) < F.HUB_SIZE / 2 + 1.0);
    if (!st.charged && st.n >= 3 && nearExit) {
      st.charged = true;
      this.foul('G408', 'MAJOR', r, 'strategic');
    }
  }

  /**
   * FUEL que salió del campo (G405). La regla castiga sacarlo A PROPÓSITO ("intentionally
   * eject"), directo o rebotando: se cobra al robot que lo lanzó si salió todavía en vuelo
   * (tiro o pase fuera del campo). Uno que se escapa empujado o rebotando en el piso no es
   * intencional (y FIELD STAFF lo regresa por donde salió).
   */
  onOut(i: number, shot: boolean): void {
    if (!shot) return;
    const f = this.ctx.fuel;
    const who = f.shotBy[i];
    if (who < 0 || this.t - f.shotTime[i] > 6) return;
    const r = this.ctx.robots[who];
    if (!r) return;
    const repeated = this.count('G405', r) > 0;
    this.foul('G405', repeated ? 'MAJOR' : 'MINOR', r);
    // G211: sacar mucho FUEL del campo a propósito
    if (this.count('G405', r) === 5) this.card('G211', r);
  }

  /** FUEL que entró a un HUB (G407). */
  onHubEnter(i: number, hub: Alliance): void {
    const shooter = this.ctx.fuel.shotBy[i];
    if (shooter < 0) return;
    const r = this.ctx.robots[shooter];
    if (!r || r.alliance !== hub || !this.launchedOutside[i]) return;
    // Una falta por ráfaga (tiros seguidos), no por pelota
    if (this.ready(`G407:${r.index}`, 2.5)) {
      this.foul('G407', 'MAJOR', r);
      if (this.count('G407', r) === 3) this.card('G211', r);
    }
  }

  /** Inicio de contacto entre colisionadores (robot-robot o robot-FUEL). */
  onRobotContactStart(a: Robot, b: Robot): void {
    if (a.alliance === b.alliance) return;
    // G403: contacto con un rival estando completamente del otro lado en AUTO
    if (this.ctx.match.phase === 'AUTO')
      for (const [x, y] of [
        [a, b],
        [b, a],
      ])
        if (this.g403.has(x.index) && this.crossedCenter(x) && this.ready(`G403c:${x.index}:${y.index}`, 1)) this.foul('G403', 'MAJOR', x, 'contact');
  }

  /** Golpe robot-robot con fuerza (N). G415 / G416 / G417 (mutuamente excluyentes). */
  onRobotForce(a: Robot, b: Robot, force: number): void {
    if (a.alliance === b.alliance || !isTeleop(this.ctx.match.phase)) return;
    const pa = a.phys.curPos;
    const pb = b.phys.curPos;
    const d = Math.max(0.01, Math.hypot(pb.x - pa.x, pb.z - pa.z));
    const nx = (pb.x - pa.x) / d;
    const nz = (pb.z - pa.z) / d;
    const va = a.phys.velocity();
    const vb = b.phys.velocity();
    const aToward = va.x * nx + va.z * nz;
    const bToward = -(vb.x * nx + vb.z * nz);
    // "Iniciar contacto": moverse hacia el rival claramente más rápido que él
    let ini: Robot | null = null;
    let vic: Robot | null = null;
    if (aToward > 1.0 && aToward > bToward + 0.5) [ini, vic] = [a, b];
    else if (bToward > 1.0 && bToward > aToward + 0.5) [ini, vic] = [b, a];
    if (!ini || !vic) return;
    const closing = aToward + bToward;
    const key = `${ini.index}>${vic.index}`;
    if (!this.ready(`ram:${key}`, 0.6)) return;
    const list = (this.rams.get(key) ?? []).filter((t) => this.t - t < 10);
    if (closing > 2.5) list.push(this.t);
    this.rams.set(key, list);
    const viaExtension = ini.intakeDeploy > 0.5 && this.frontHit(ini, vic);
    const tipping = vic.phys.tilt() > 0.45;
    let rule: RuleCode | null = null;
    // G417: contactar a un rival que ya se está volteando (pudo evitarse)
    if (tipping && closing > 1.5) rule = 'G417';
    // G416: embestida temeraria con extensión a alta velocidad, o embestidas repetidas
    else if ((viaExtension && closing > 3.2) || list.length >= 3) rule = 'G416';
    // G415: con BUMPERS fuera de su zona, contacto de su extensión dentro del perímetro rival
    else if (viaExtension && closing > 2.0 && !this.inZonePartially(ini) && force > 2500) rule = 'G415';
    if (!rule || !this.ready(`${rule}:${ini.index}`, 4)) return;
    this.foul(rule, 'MAJOR', ini);
    // RED CARD si el rival queda incapaz de manejar (volteado)
    const unable = vic.phys.tilt() > 1.0 || vic.disabled;
    this.card(rule, ini, unable);
    if (rule === 'G416') this.rams.set(key, []);
  }

  /** ¿El golpe de `ini` sobre `vic` fue con su frente (lado de la intake)? */
  private frontHit(ini: Robot, vic: Robot): boolean {
    const h = ini.phys.heading();
    const dx = vic.phys.curPos.x - ini.phys.curPos.x;
    const dz = vic.phys.curPos.z - ini.phys.curPos.z;
    const d = Math.hypot(dx, dz) || 1;
    return (dx * Math.cos(h) - dz * Math.sin(h)) / d > 0.7;
  }

  private crossedCenter(r: Robot): boolean {
    const x = r.phys.curPos.x;
    const e = this.extX(r);
    return r.alliance === 'blue' ? x - e > F.CENTER_LINE_X : x + e < F.CENTER_LINE_X;
  }

  // ------------------------------------------------------------------ paso
  step(dt: number): void {
    const m = this.ctx.match;
    if (!m.running || m.phase === 'AUTO_PAUSE' || m.phase === 'POST' || m.phase === 'DONE') return;
    this.gatherContacts();
    const robots = this.ctx.robots;

    for (const r of robots) {
      if (!r.enabled) continue;
      // ---- G403: en AUTO, cruzar COMPLETAMENTE la CENTER LINE (una vez por robot)
      if (m.phase === 'AUTO' && !this.g403.has(r.index) && this.crossedCenter(r)) {
        this.g403.add(r.index);
        this.foul('G403', 'MAJOR', r);
      }
      // ---- G413: extensión > 12 in (R105) por más de un MOMENTARY (≈3 s)
      if (F.inch(r.spec.intake.extensionIn) > F.MAX_EXTENSION + 1e-6 && r.intakeDeploy > 0.9) {
        const tt = (this.g413.get(r.index) ?? 0) + dt;
        this.g413.set(r.index, tt);
        if (tt > 3 && tt - dt <= 3) this.foul('G413', 'MAJOR', r, 'R105');
      } else this.g413.set(r.index, 0);
    }

    // ---- FUEL dirigido a rivales (G404) y FUEL que sale del HUB (G408: se limpia al tocar otra cosa)
    this.checkFlaggedFuel();

    // ---- G418: PIN
    this.updatePins(dt);

    // ---- G419: dos robots de una alianza bloquean ambos TRENCHES o ambos BUMPS de una línea
    this.checkCollusion(dt);

    // ---- G420: últimos 30 s, tocar a un rival que toca su TOWER
    if (m.phase === 'END_GAME')
      for (const key of this.contacts) {
        const [i, j] = key.split('-').map(Number);
        const a = robots[i];
        const b = robots[j];
        if (a.alliance === b.alliance) continue;
        for (const [off, vic] of [
          [a, b],
          [b, a],
        ]) {
          // sin importar quién inicia; una falta por instancia de contacto (contacto nuevo)
          if (!this.touchingTower(vic) || this.prevContacts.has(key)) continue;
          if (!this.ready(`G420:${off.index}:${vic.index}`, 1)) continue;
          this.foul('G420', 'MAJOR', off);
          // si el rival está despegado del piso, recibe LEVEL 3 automáticamente
          if (vic.phys.curPos.y > 0.03) this.g420Level3.add(vic.index);
        }
      }

    // ---- G427: OUTPOST lleno y exceso sin meter al campo
    for (const a of ['red', 'blue'] as Alliance[]) {
      const hp = this.ctx.humanPlayers[a];
      const tt = hp.excessTime;
      const charged = this.g427.get(a) ?? 0;
      if (tt > 3 && charged === 0) {
        this.foul('G427', 'MINOR', a);
        this.g427.set(a, 1);
      } else if (tt > 10 && charged === 1) {
        this.foul('G427', 'MAJOR', a, 'CONTINUOUS');
        this.g427.set(a, 2);
      } else if (tt === 0) this.g427.set(a, 0);
    }
  }

  /** Contactos actuales robot-robot y robot-campo. */
  private gatherContacts(): void {
    this.prevContacts = this.contacts;
    this.contacts = new Set();
    this.touchField.clear();
    const w = this.ctx.pw.world;
    for (const r of this.ctx.robots) {
      for (const col of r.phys.solids()) {
        w.contactPairsWith(col, (other) => {
          const tag = this.ctx.pw.tagOf(other.handle);
          if (!tag) return;
          let touching = false;
          w.contactPair(col, other, (man) => {
            if (man.numContacts() > 0) touching = true;
          });
          if (!touching) return;
          if (tag.kind === 'robot' && tag.robot !== r.index) {
            const a = Math.min(r.index, tag.robot);
            const b = Math.max(r.index, tag.robot);
            this.contacts.add(`${a}-${b}`);
          } else if (tag.kind === 'field') this.touchField.add(r.index);
        });
      }
    }
    for (const k of this.contacts)
      if (!this.prevContacts.has(k)) {
        const [i, j] = k.split('-').map(Number);
        this.onRobotContactStart(this.ctx.robots[i], this.ctx.robots[j]);
      }
  }

  private checkFlaggedFuel(): void {
    const f = this.ctx.fuel;
    const w = this.ctx.pw.world;
    for (let i = 0; i < f.count; i++) {
      const fl = f.flags[i];
      if (!(fl & (FLAG_FROM_HUB | FLAG_SHOT)) || f.state[i] !== 0) continue;
      const col = f.colliders[i];
      w.contactPairsWith(col, (other) => {
        const tag = this.ctx.pw.tagOf(other.handle);
        if (!tag) return;
        let touching = false;
        w.contactPair(col, other, (man) => {
          if (man.numContacts() > 0) touching = true;
        });
        if (!touching) return;
        if (tag.kind === 'robot') {
          f.lastTouch[i] = tag.robot;
          f.lastTouchTime[i] = this.t;
          // G404: un tiro dirigido golpea al rival apuntado antes de tocar otra cosa
          if (fl & FLAG_SHOT && this.aimedAt[i] === tag.robot) {
            const off = this.ctx.robots[f.shotBy[i]];
            if (off && this.ready(`G404:${off.index}`, 3)) this.foul('G404', 'MAJOR', off);
            this.aimedAt[i] = -1;
          }
          if (fl & FLAG_SHOT && f.shotBy[i] !== tag.robot) f.flags[i] &= ~FLAG_SHOT;
        } else {
          // tocó alfombra/campo/otro FUEL: ya no es "FUEL que sale del HUB"
          f.flags[i] &= ~FLAG_FROM_HUB;
          if (tag.kind !== 'fuel') this.aimedAt[i] = -1;
        }
      });
    }
  }

  private updatePins(dt: number): void {
    const robots = this.ctx.robots;
    // Detecta nuevos PINS: rival en contacto que no puede moverse (contra el campo o
    // contra otro robot) o que intenta moverse y no avanza.
    for (const key of this.contacts) {
      const [i, j] = key.split('-').map(Number);
      for (const [p, v] of [
        [robots[i], robots[j]],
        [robots[j], robots[i]],
      ]) {
        if (p.alliance === v.alliance) continue;
        const vv = v.phys.velocity();
        const sp = Math.hypot(vv.x, vv.z);
        const wants = Math.hypot(v.phys.lastCmd.vx, v.phys.lastCmd.vz) > 0.6;
        const trapped = this.touchField.has(v.index) || [...this.contacts].some((k) => k !== key && k.split('-').map(Number).includes(v.index));
        // El que hace PIN es quien empuja hacia el rival; si el "pineado" es quien empuja
        // contra un robot quieto, no es PIN (G418: impedir el movimiento del rival).
        const dx = v.phys.curPos.x - p.phys.curPos.x;
        const dz = v.phys.curPos.z - p.phys.curPos.z;
        const dl = Math.hypot(dx, dz) || 1;
        const pc = p.phys.lastCmd;
        const vc = v.phys.lastCmd;
        const pPush = (pc.vx * dx + pc.vz * dz) / dl > 0.4;
        const vPush = -(vc.vx * dx + vc.vz * dz) / dl > 0.4;
        if (sp < 0.25 && (trapped || wants) && pPush && !vPush) {
          const k = `${p.index}>${v.index}`;
          let st = this.pins.get(k);
          if (!st || !st.active) {
            st = {
              pinner: p.index,
              victim: v.index,
              count: st?.active ? st.count : 0,
              charged: 0,
              startP: { x: p.phys.curPos.x, z: p.phys.curPos.z },
              startV: { x: v.phys.curPos.x, z: v.phys.curPos.z },
              away: 0,
              active: true,
              carded: false,
            };
            this.pins.set(k, st);
          }
        }
      }
    }
    for (const st of this.pins.values()) {
      if (!st.active) continue;
      const p = robots[st.pinner];
      const v = robots[st.victim];
      // C. el robot que hace PIN queda pineado → termina
      if (this.pins.get(`${st.victim}>${st.pinner}`)?.active && this.pins.get(`${st.victim}>${st.pinner}`)!.count > st.count) {
        st.active = false;
        continue;
      }
      const separated = this.gap(p, v) >= SEP;
      const movedP = Math.hypot(p.phys.curPos.x - st.startP.x, p.phys.curPos.z - st.startP.z) >= SEP;
      const movedV = Math.hypot(v.phys.curPos.x - st.startV.x, v.phys.curPos.z - st.startV.z) >= SEP;
      const inContact = this.contacts.has(`${Math.min(p.index, v.index)}-${Math.max(p.index, v.index)}`);
      if (separated || movedP || movedV || !inContact) {
        // la cuenta se pausa; termina si dura > 3 s (A y B), o si dejan de estar en contacto
        st.away += dt;
        if (st.away > 3 || (!inContact && !separated && st.away > 1.5)) st.active = false;
        continue;
      }
      st.away = 0;
      st.count += dt;
      // MINOR a los 3 s y luego MAJOR por cada 3 s adicionales
      const due = Math.floor(st.count / PIN_LIMIT);
      while (st.charged < due) {
        st.charged++;
        this.foul('G418', st.charged === 1 ? 'MINOR' : 'MAJOR', p);
      }
      // G211: PIN de más de 15 s → tarjeta
      if (st.count > 15 && !st.carded) {
        st.carded = true;
        this.card('G211', p);
      }
    }
  }

  /** Contadores de PIN visibles (para el HUD). */
  activePins(): Array<{ victim: number; pinner: number; seconds: number }> {
    const out: Array<{ victim: number; pinner: number; seconds: number }> = [];
    for (const st of this.pins.values()) if (st.active && st.count > 0.3) out.push({ victim: st.victim, pinner: st.pinner, seconds: st.count });
    return out;
  }

  private checkCollusion(dt: number): void {
    const robots = this.ctx.robots;
    for (const a of ['red', 'blue'] as Alliance[]) {
      const mine = robots.filter((r) => r.alliance === a && r.enabled);
      let blocking = false;
      for (const line of ['red', 'blue'] as Alliance[]) {
        const hx = F.hubCenter(line).x;
        const at = (r: Robot) => Math.abs(r.phys.curPos.x - hx) < 0.9 && Math.hypot(r.phys.velocity().x, r.phys.velocity().z) < 0.3;
        const inTrench = (r: Robot, s: number) => at(r) && s * r.phys.curPos.z > F.HALF_W - F.TRENCH_CLEAR_WIDTH - 0.2;
        const onBump = (r: Robot, s: number) =>
          at(r) && s * r.phys.curPos.z > F.HUB_SIZE / 2 - 0.2 && s * r.phys.curPos.z < F.TRENCH_INNER_Z + 0.2;
        for (const test of [inTrench, onBump]) {
          const plus = mine.filter((r) => test(r, 1));
          const minus = mine.filter((r) => test(r, -1));
          if (plus.length && minus.length && plus.some((r) => !minus.includes(r))) blocking = true;
        }
      }
      // TOWER rival: dos robots estacionados frente a ella
      const tw = F.towerInfo(opponent(a));
      const near = mine.filter((r) => Math.hypot(r.phys.curPos.x - tw.cx, r.phys.curPos.z - tw.cz) < 1.6);
      if (near.length >= 2 && isTeleop(this.ctx.match.phase) && this.ctx.match.t > T.endGame) blocking = true;
      const tt = blocking ? (this.g419.get(a) ?? 0) + dt : 0;
      const prev = this.g419.get(a) ?? 0;
      this.g419.set(a, tt);
      // tras 3 s bloqueando: MAJOR, y otro MAJOR por cada 3 s adicionales
      if (blocking && Math.floor(tt / 3) > Math.floor(prev / 3) && tt >= 3) this.foul('G419', 'MAJOR', a);
    }
  }

  /** G414: robots sostenidos por un compañero (no tocan RUNG/UPRIGHT pero están en el aire). */
  evaluateG414(): void {
    for (const r of this.ctx.robots) {
      if (r.climbing) continue;
      if (r.phys.curPos.y > 0.08 && r.phys.grounded === 0) {
        const partnerBelow = this.ctx.robots.some(
          (o) => o !== r && o.alliance === r.alliance && o.climbing && this.dist(o, r) < o.phys.outerL + r.phys.outerL + 0.1,
        );
        if (partnerBelow) this.g414.add(r.index);
      }
    }
  }
}
