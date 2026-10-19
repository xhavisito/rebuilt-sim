/**
 * Catálogo de reglas que aplica el árbitro automático (Game Manual TU22 §7) y valores de
 * penalización (Tabla 6-6): MINOR = 5, MAJOR = 15 puntos para el OPONENTE.
 */
import type { CardType, FoulSeverity } from './types';

export const FOUL_POINTS: Record<FoulSeverity, number> = { MINOR: 5, MAJOR: 15 };

export type RuleCode =
  | 'G211'
  | 'G303'
  | 'G403'
  | 'G404'
  | 'G405'
  | 'G407'
  | 'G408'
  | 'G410'
  | 'G412'
  | 'G413'
  | 'G414'
  | 'G415'
  | 'G416'
  | 'G417'
  | 'G418'
  | 'G419'
  | 'G420'
  | 'G425'
  | 'G427';

/** Título corto de la regla (tal como lo nombra el manual) y explicación. */
export const RULES: Record<RuleCode, { title: string; es: string; en: string }> = {
  G211: { title: 'Egregious or exceptional violations', es: 'Conducta grave o reincidente', en: 'Egregious or repeated behavior' },
  G303: { title: 'Start your ROBOTS', es: 'Requisitos de inicio', en: 'MATCH-start requirements' },
  G403: { title: 'Limited AUTO opponent interaction', es: 'Cruzó la CENTER LINE en AUTO', en: 'Crossed the CENTER LINE in AUTO' },
  G404: { title: 'Use SCORING ELEMENTS as directed', es: 'Uso indebido de FUEL', en: 'FUEL misuse' },
  G405: { title: 'Keep SCORING ELEMENTS in bounds', es: 'Sacó FUEL del campo', en: 'Ejected FUEL from the FIELD' },
  G407: { title: 'Only score while in your ALLIANCE ZONE', es: 'Lanzó al HUB fuera de su ALLIANCE ZONE', en: 'Launched into HUB outside ALLIANCE ZONE' },
  G408: { title: "Don't catch FUEL", es: 'Atrapó/redirigió FUEL que salía del HUB', en: 'Caught/redirected FUEL leaving the HUB' },
  G410: { title: 'Keep your BUMPERS low', es: 'BUMPERS fuera de la BUMPER ZONE', en: 'BUMPERS lifted out of BUMPER ZONE' },
  G412: { title: 'Watch your FIELD interaction', es: 'Se agarró del campo', en: 'Grabbed a FIELD element' },
  G413: { title: 'Expansion limits', es: 'Excedió los límites de extensión', en: 'Exceeded expansion limits' },
  G414: { title: "Don't Climb on each other", es: 'Cargó a un compañero en la TOWER', en: 'Supported a partner on the TOWER' },
  G415: { title: 'Stay out of other ROBOTS', es: 'Contacto dentro del perímetro rival', en: 'Contact inside opponent perimeter' },
  G416: { title: "This isn't combat robotics", es: 'Embestida temeraria', en: 'Reckless ramming' },
  G417: { title: "Don't tip or entangle", es: 'Volteó a un rival', en: 'Tipped an opponent' },
  G418: { title: "There's a 3-count on PINS", es: 'PIN de más de 3 s', en: 'PIN longer than 3 s' },
  G419: { title: "Don't collude with your partners", es: 'Bloqueo coordinado', en: 'Colluding to block' },
  G420: { title: 'TOWER protection', es: 'Tocó a un rival en su TOWER (END GAME)', en: 'Touched opponent at its TOWER (END GAME)' },
  G425: { title: 'SCORING ELEMENT delivery', es: 'Entrada de FUEL indebida', en: 'Illegal FUEL entry' },
  G427: { title: 'The OUTPOST has a storage limit', es: 'Exceso de FUEL en el OUTPOST', en: 'OUTPOST storage exceeded' },
};

export interface FoulRecord {
  rule: RuleCode;
  severity: FoulSeverity;
  /** Alianza que COMETE la falta (los puntos van al oponente). */
  offender: 'red' | 'blue';
  /** Índice del robot que la cometió (o -1 si fue el HUMAN PLAYER / alianza). */
  robot: number;
  /** Tiempo del match (s). */
  time: number;
  note?: string;
}

export interface CardRecord {
  card: CardType;
  offender: 'red' | 'blue';
  robot: number;
  rule: RuleCode;
  time: number;
}
