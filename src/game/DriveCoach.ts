/**
 * Drive coach: el que está atrás de los drivers. Recuerda el plan del match, avisa de los
 * cambios de SHIFT a tiempo, marca al rival peligroso, sugiere variar el juego (acaparar,
 * defender), cuida el END GAME (cuándo salir a trepar) y los RP, y le "dice" a los robots
 * aliados de la IA qué hacer (a quién marcar; si vamos abajo, que alguien defienda).
 * Emite mensajes con clave de i18n (la App los traduce, los muestra y, los importantes, los dice
 * en voz alta).
 */
import * as F from '../config/field';
import { isTeleop, phaseAt, T } from '../core/clock';
import { hubActive, shiftWindow } from '../core/hub';
import type { Match } from '../core/match';
import { RP_THRESHOLDS } from '../core/rp';
import { opponent, type EventType } from '../core/types';
import { planAt, type RobotPlan } from '../ai/Strategy';
import type { RobotAI } from '../ai/RobotAI';
import type { RobotProfile } from '../ai/Scouting';
import type { FuelSystem } from '../physics/FuelSystem';
import type { Robot } from './Robot';

export interface CoachMsg {
  key: string;
  params?: Record<string, string | number>;
  /** call = orden urgente (se dice en voz alta), tip = sugerencia, team = a un compañero, warn = alerta. */
  kind: 'call' | 'tip' | 'team' | 'warn';
}

export interface CoachContext {
  robots: Robot[];
  match: Match;
  fuel: FuelSystem;
  ais: Map<number, RobotAI>;
  plans: Array<RobotPlan | undefined>;
  profile(i: number): RobotProfile;
  eventType: EventType;
  /** Nombre de la rutina de AUTO de cada robot (para anunciar el plan). */
  autoName?(i: number): string;
}

/** Tarea de un robot en cada fase según su plan (o su rol). Los textos van con '@' (clave de i18n). */
function phaseTasks(p: RobotPlan | undefined, maxLevel: number): { act: 'score' | 'feed'; inact: 'stockpile' | 'defend' | 'feed'; climb: number } {
  const role = p?.role ?? 'auto';
  const act = p?.active ?? (role === 'feeder' ? 'feed' : 'score');
  const inact = p?.inactive ?? (role === 'defender' ? 'defend' : role === 'feeder' ? 'feed' : 'stockpile');
  const climb = p && p.climb !== 'auto' ? Math.min(p.climb, maxLevel) : maxLevel;
  return { act, inact, climb };
}

export class DriveCoach {
  private tick = 0;
  private teleopT = 0;
  private idleT = 0;
  private lastActive: boolean | null = null;
  private once = new Set<string>();
  private cool = new Map<string, number>();
  private announced = false;
  /** Próxima revisión de compañeros esperando. */
  private watchAt = 0;
  private shots0 = { shot: 0, scored: 0 };

  constructor(
    private ctx: CoachContext,
    private player: Robot,
    private emit: (m: CoachMsg) => void,
  ) {}

  private say(key: string, kind: CoachMsg['kind'], params?: CoachMsg['params'], cooldown = 0): void {
    const m = this.ctx.match;
    if (cooldown > 0) {
      const last = this.cool.get(key) ?? -1e9;
      if (m.t - last < cooldown) return;
      this.cool.set(key, m.t);
    }
    this.emit({ key, params, kind });
  }

  private sayOnce(key: string, kind: CoachMsg['kind'], params?: CoachMsg['params'], id = key): void {
    if (this.once.has(id)) return;
    this.once.add(id);
    this.emit({ key, params, kind });
  }

  private activeAt(t: number): boolean {
    const m = this.ctx.match;
    return hubActive(phaseAt(t), this.player.alliance, m.firstInactive);
  }

  /** Segundos hasta que cambia el estado del HUB propio (busca hacia adelante). */
  private untilChange(): number {
    const m = this.ctx.match;
    const now = this.activeAt(m.t);
    for (let dt = 0.25; dt < 40; dt += 0.25) if (this.activeAt(m.t + dt) !== now) return dt;
    return 99;
  }

  /** Rival más peligroso: el que mejor anota según el scouting por qué tan lleno viene. */
  private threat(): Robot | null {
    const { robots, fuel } = this.ctx;
    const opp = robots.filter((o) => o.alliance !== this.player.alliance && !o.climbing);
    let best: Robot | null = null;
    let bv = -1;
    for (const o of opp) {
      const v = this.ctx.profile(o.index).scoring * (0.3 + fuel.robotCount(o.index) / o.spec.hopperCapacity);
      if (v > bv) {
        bv = v;
        best = o;
      }
    }
    return best;
  }

  /** Plan del robot `i` con las tareas del SHIFT actual (ventana 0 = SHIFT 1–2, 1 = SHIFT 3–4). */
  private plan(i: number, w: 0 | 1 = shiftWindow(this.ctx.match.phase)): RobotPlan | undefined {
    const p = this.ctx.plans[i];
    return p ? planAt(p, w) : undefined;
  }

  private mates(): Robot[] {
    return this.ctx.robots.filter((o) => o !== this.player && o.alliance === this.player.alliance);
  }

  /** Al arrancar: el plan del match de cada quien (AUTO, SHIFT activo, inactivo y END GAME). */
  private announcePlan(): void {
    this.announced = true;
    this.say('coach_plan', 'tip');
    const threat = this.threat();
    for (const r of [this.player, ...this.mates()]) {
      // las dos ventanas: SHIFT activo / inactivo 1 (SHIFT 1–2) y 2 (SHIFT 3–4)
      const [p1, p2] = [this.plan(r.index, 0), this.plan(r.index, 1)];
      const [t1, t2] = [phaseTasks(p1, r.spec.climb.maxLevel), phaseTasks(p2, r.spec.climb.maxLevel)];
      const mark = (tk: typeof t1, p: RobotPlan | undefined) => (tk.inact === 'defend' ? ` ${p?.defendTeam ?? threat?.spec.teamNumber ?? ''}` : '');
      this.emit({
        key: 'coach_orderFull',
        params: {
          who: r === this.player ? '@coach_you' : String(r.spec.teamNumber),
          auto: this.ctx.autoName?.(r.index) ?? '—',
          act: `@task_${t1.act}`,
          act2: `@task_${t2.act}`,
          inact: `@task_${t1.inact}`,
          target: mark(t1, p1),
          inact2: `@task_${t2.inact}`,
          target2: mark(t2, p2),
          eg: t2.climb > 0 ? `L${t2.climb}` : '@task_noClimb',
        },
        kind: r === this.player ? 'tip' : 'team',
      });
    }
  }

  update(dt: number): void {
    const m = this.ctx.match;
    if (!m.running) return;
    if (!this.announced && m.phase === 'AUTO') this.announcePlan();
    this.tick -= dt;
    const teleop = isTeleop(m.phase) && m.t < T.teleopEnd;
    if (teleop) this.teleopT += dt;
    // Tiros del jugador en TELEOP (los del AUTO son de la rutina, no suyos)
    if (!teleop && m.phase !== 'POST') this.shots0 = { shot: this.player.stats.fuelShot - this.player.stats.passes, scored: this.player.stats.fuelScored };
    // Parado sin razón (ni trepando ni en AUTO)
    const p = this.player;
    const v = p.phys.velocity();
    if (teleop && !p.climbing && Math.hypot(v.x, v.z) < 0.25) this.idleT += dt;
    else this.idleT = 0;
    if (this.tick > 0) return;
    this.tick = 0.25;
    const own = p.alliance;
    const opp = opponent(own);
    const active = this.activeAt(m.t);
    const until = this.untilChange();
    const fuel = this.ctx.fuel;
    const n = fuel.robotCount(p.index);
    const cap = p.spec.hopperCapacity;
    const endgame = m.phase === 'END_GAME';
    const shiftKey = m.phase;
    if (teleop && !endgame) {
      // ---- Cambios de SHIFT del HUB propio
      if (!active && until <= 5 && until > 3.5) this.sayOnce('coach_activeSoon', 'call', { s: 5 }, `aS:${shiftKey}`);
      if (active && until <= 5 && until > 3.5 && m.phase !== 'TRANSITION') this.sayOnce('coach_inactiveSoon', 'call', { s: 5 }, `iS:${shiftKey}`);
      if (this.lastActive !== null && active !== this.lastActive) {
        if (active) {
          this.say('coach_activeNow', 'call');
          // quién alimenta en este SHIFT (según el plan)
          for (const o of this.mates())
            if (phaseTasks(this.plan(o.index), o.spec.climb.maxLevel).act === 'feed') this.emit({ key: 'coach_partnerFeed', params: { who: o.spec.teamNumber }, kind: 'team' });
        } else {
          const threat = this.threat();
          const mine = phaseTasks(this.plan(p.index), p.spec.climb.maxLevel);
          // tu tarea del plan para el SHIFT inactivo
          if (this.plan(p.index)?.inactive) {
            const target = this.plan(p.index)?.defendTeam ?? threat?.spec.teamNumber ?? '';
            this.say('coach_youInactive', 'tip', { task: `@task_${mine.inact}`, target: mine.inact === 'defend' ? ` ${target}` : '' });
          } else if (n >= cap - 2) this.say('coach_inactiveFull', 'tip', { target: threat?.spec.teamNumber ?? '' });
          else this.say('coach_inactiveFill', 'tip', { s: Math.round(until) });
          // A los compañeros de la IA: quién marca a quién y quién acapara
          this.orderMates(threat, m);
        }
      }
      // ---- Rival peligroso yendo lleno a tirar mientras nuestro HUB está apagado
      if (!active && m.isHubActive(opp)) {
        const th = this.threat();
        if (th && fuel.robotCount(th.index) >= th.spec.hopperCapacity * 0.7) {
          const hub = F.hubCenter(opp);
          const d = Math.hypot(th.phys.curPos.x - hub.x, th.phys.curPos.z - hub.z);
          if (d < 4.5) {
            const defender = this.mates().find((o) => this.ctx.ais.get(o.index)?.state === 'defend');
            this.say('coach_threat', 'warn', { target: th.spec.teamNumber, who: defender ? String(defender.spec.teamNumber) : '@coach_you' }, 12);
          }
        }
      }
    }
    // Nadie de la alianza se queda esperando todo un SHIFT inactivo (revisa cada ~2 s)
    if (teleop && !endgame && !active && m.t >= this.watchAt) {
      this.watchAt = m.t + 2;
      this.watchMates(m, until);
    }
    // ---- Variar el juego (una vez cada cosa)
    if (teleop && this.teleopT > 70 && p.stats.passes === 0 && !active) this.sayOnce('coach_varyPass', 'tip');
    if (teleop && this.teleopT > 95 && p.stats.defenseSec < 2 && !active) this.sayOnce('coach_varyDefend', 'tip', { target: this.threat()?.spec.teamNumber ?? '' });
    if (this.idleT > 5 && !endgame && teleop) {
      this.say('coach_idle', 'tip', undefined, 20);
      this.idleT = 0;
    }
    // ---- Puntería (solo sus tiros de TELEOP)
    const shots = p.stats.fuelShot - p.stats.passes - this.shots0.shot;
    const scored = p.stats.fuelScored - this.shots0.scored;
    if (teleop && shots >= 12 && scored / shots < 0.6) this.say('coach_accuracy', 'tip', { p: Math.round((scored / shots) * 100) }, 35);
    // ---- END GAME: cuándo salir a trepar; RP
    if (endgame) {
      // el nivel que dice el plan (o el máximo de su robot)
      const lvl = phaseTasks(this.plan(p.index), p.spec.climb.maxLevel).climb;
      const need = lvl ? [0, p.spec.climb.timeL1, p.spec.climb.timeL2, p.spec.climb.timeL3][lvl] + 4 : 0;
      const left = T.teleopEnd - m.t;
      if (lvl === 0 && p.spec.climb.maxLevel > 0) this.sayOnce('coach_youNoClimb', 'tip');
      if (lvl > 0) {
        this.sayOnce('coach_climbPlan', 'tip', { l: lvl, s: Math.round(need), t: Math.round(need + 2) });
        if (!p.climbing && left <= need + 2 && left > need - 1) this.sayOnce('coach_climbNow', 'call', { s: Math.round(left) });
      }
      const climbers = this.mates()
        .map((o) => ({ o, l: phaseTasks(this.plan(o.index), o.spec.climb.maxLevel).climb }))
        .filter((x) => x.l > 0)
        .map((x) => `${x.o.spec.teamNumber} L${x.l}`);
      if (climbers.length) this.sayOnce('coach_partnersClimb', 'team', { list: climbers.join(', ') });
      const th = RP_THRESHOLDS[this.ctx.eventType];
      const counted = m.fuel[own].auto + m.fuel[own].teleop;
      if (counted < th.energized && th.energized - counted <= 40) this.sayOnce('coach_energized', 'tip', { n: th.energized - counted });
      else if (counted < th.supercharged && th.supercharged - counted <= 60) this.sayOnce('coach_supercharged', 'tip', { n: th.supercharged - counted });
    }
    // ---- Marcador al final
    const left = T.teleopEnd - m.t;
    for (const mark of [60, 25])
      if (left <= mark && left > mark - 1) {
        const diff = m.score(own) - m.score(opp);
        if (diff < -15) this.sayOnce('coach_behind', 'warn', { n: -diff }, `b${mark}`);
        else if (diff > 25) this.sayOnce('coach_ahead', 'tip', { n: diff }, `a${mark}`);
      }
    this.lastActive = active;
  }

  /**
   * Al apagarse nuestro HUB: le da a CADA compañero de la IA su tarea para el SHIFT (nadie se queda
   * esperando en la zona): el defensor marca al rival peligroso y los demás acaparan (pasan FUEL a
   * nuestra ALLIANCE ZONE). Si vamos abajo y nadie defiende, pone a defender al que menos anota y
   * mejor empuja.
   */
  private orderMates(threat: Robot | null, m: Match): void {
    const mates = this.mates().filter((o) => this.ctx.ais.has(o.index));
    const own = this.player.alliance;
    const behind = m.score(own) < m.score(opponent(own)) - 10;
    const until = m.t + this.untilChange() - 0.5;
    let defender = mates.find((o) => {
      const plan = this.plan(o.index);
      if (plan?.inactive) return plan.inactive === 'defend';
      return plan?.role === 'defender' || (plan?.role !== 'scorer' && this.ctx.ais.get(o.index)?.dynRole === 'defender');
    });
    if (!defender && behind && threat) {
      // solo entre los que no tienen tarea fija en el plan (lo que tú decidiste se respeta)
      const cands = mates.filter((o) => this.plan(o.index)?.role !== 'feeder' && !this.plan(o.index)?.inactive);
      cands.sort((a, b) => this.ctx.profile(a.index).scoring - this.ctx.profile(a.index).defense - (this.ctx.profile(b.index).scoring - this.ctx.profile(b.index).defense));
      defender = cands[0];
    }
    for (const o of mates) {
      const ai = this.ctx.ais.get(o.index)!;
      if (o === defender && threat) {
        const target = this.plan(o.index)?.defendTeam ?? threat.spec.teamNumber;
        ai.coachOrder = { task: 'defend', until };
        ai.coachVictim = target;
        this.emit({ key: 'coach_partnerDefend', params: { who: o.spec.teamNumber, target }, kind: 'team' });
      } else if (phaseTasks(this.plan(o.index), o.spec.climb.maxLevel).inact === 'feed') {
        ai.coachOrder = null; // alimentador: pasa todo a la zona (su propia lógica)
        this.emit({ key: 'coach_partnerFeed', params: { who: o.spec.teamNumber }, kind: 'team' });
      } else {
        ai.coachOrder = { task: 'stockpile', until };
        this.emit({ key: 'coach_partnerStock', params: { who: o.spec.teamNumber }, kind: 'team' });
      }
    }
  }

  /**
   * Durante nuestro SHIFT inactivo: si un compañero se quedó esperando en la zona con tiempo de
   * sobra, se lo dice por su número y lo manda a acaparar.
   */
  private watchMates(m: Match, until: number): void {
    if (until < 7) return;
    for (const o of this.mates()) {
      const ai = this.ctx.ais.get(o.index);
      if (!ai || ai.state !== 'stage') continue;
      ai.coachOrder = { task: 'stockpile', until: m.t + until - 0.5 };
      // una vez cada 10 s por robot
      const k = `noWait:${o.index}`;
      if (m.t - (this.cool.get(k) ?? -1e9) < 10) continue;
      this.cool.set(k, m.t);
      this.emit({ key: 'coach_noWait', params: { who: o.spec.teamNumber }, kind: 'team' });
    }
  }
}
