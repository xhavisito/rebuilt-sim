/** Resumen de reglas (Game Manual TU22) para la pantalla "Reglas", en español e inglés. */
import type { Lang } from '../config/settings';

export interface RulesSection {
  title: string;
  rows?: Array<[string, string]>;
  items?: string[];
  text?: string;
}

const es: RulesSection[] = [
  {
    title: 'El match',
    rows: [
      ['AUTO (sin piloto)', '0:20'],
      ['Evaluación post-AUTO', '3 s'],
      ['TRANSITION SHIFT', '2:20 → 2:10'],
      ['SHIFT 1 – 4', '25 s c/u'],
      ['END GAME', '0:30 → 0:00'],
    ],
    text: 'Ambos HUBS están activos en AUTO, TRANSITION y END GAME. En los SHIFTS solo uno está activo y se alternan.',
  },
  {
    title: 'HUBS y SHIFTS',
    items: [
      'La alianza que anotó MÁS FUEL en AUTO queda INACTIVA en SHIFT 1 y 3 (empate: lo decide el FMS al azar).',
      'Luces: color al 100 % = activo · pulsando = se apaga en 3 s · persecución blanca = será el inactivo en SHIFT 1 · apagado = inactivo.',
      'El FUEL que entra hasta 3 s después de que el HUB se apaga todavía cuenta.',
      'Solo puedes lanzar al HUB con los BUMPERS al menos parcialmente en tu ALLIANCE ZONE (G407).',
    ],
  },
  {
    title: 'Puntos',
    rows: [
      ['FUEL en HUB activo', '1'],
      ['TOWER LEVEL 1 en AUTO (máx. 2 robots)', '15'],
      ['TOWER LEVEL 1 / 2 / 3 en TELEOP', '10 / 20 / 30'],
      ['MINOR FOUL (al rival)', '5'],
      ['MAJOR FOUL (al rival)', '15'],
    ],
  },
  {
    title: 'Ranking Points',
    rows: [
      ['Ganar / empatar', '3 / 1'],
      ['ENERGIZED (FUEL ≥ 100)', '1'],
      ['SUPERCHARGED (FUEL ≥ 360)', '1'],
      ['TRAVERSAL (TOWER ≥ 50)', '1'],
    ],
    text: 'Umbrales de Regional/District; en District Championship y FIRST Championship son mayores.',
  },
  {
    title: 'Faltas frecuentes',
    items: [
      'G403 · En AUTO no cruces COMPLETAMENTE la CENTER LINE (MAJOR).',
      'G408 · No atrapes FUEL que sale del HUB antes de que toque otra cosa.',
      'G418 · PIN máximo de 3 s (MINOR, y MAJOR cada 3 s más).',
      'G420 · En los últimos 30 s no toques a un rival en su TOWER (MAJOR y el rival recibe LEVEL 3).',
      'G405 · No saques FUEL del campo (salvo por la abertura del CORRAL).',
    ],
  },
  {
    title: 'Campo',
    items: [
      'Los BUMPS se cruzan por encima (rampas de 15°); los TRENCHES por debajo solo si mides ≤ 22.25 in.',
      'DEPOT: 24 FUEL junto a tu pared. CHUTE: el HUMAN PLAYER suelta FUEL. CORRAL: empuja FUEL para tu HUMAN PLAYER.',
      'TOWER: LEVEL 1 = sin tocar el piso · LEVEL 2 = BUMPERS sobre el LOW RUNG · LEVEL 3 = sobre el MID RUNG.',
    ],
  },
];

const en: RulesSection[] = [
  {
    title: 'The match',
    rows: [
      ['AUTO (no driver)', '0:20'],
      ['Post-AUTO assessment', '3 s'],
      ['TRANSITION SHIFT', '2:20 → 2:10'],
      ['SHIFT 1 – 4', '25 s each'],
      ['END GAME', '0:30 → 0:00'],
    ],
    text: 'Both HUBS are active in AUTO, TRANSITION and END GAME. During SHIFTS only one is active and they alternate.',
  },
  {
    title: 'HUBS & SHIFTS',
    items: [
      'The alliance that scored MORE FUEL in AUTO is INACTIVE in SHIFT 1 and 3 (tie: the FMS picks at random).',
      'Lights: solid color = active · pulsing = turns off in 3 s · white chase = will be inactive in SHIFT 1 · off = inactive.',
      'FUEL entering up to 3 s after the HUB turns off still counts.',
      'You may only launch into your HUB with BUMPERS at least partly inside your ALLIANCE ZONE (G407).',
    ],
  },
  {
    title: 'Points',
    rows: [
      ['FUEL in an active HUB', '1'],
      ['TOWER LEVEL 1 in AUTO (max 2 robots)', '15'],
      ['TOWER LEVEL 1 / 2 / 3 in TELEOP', '10 / 20 / 30'],
      ['MINOR FOUL (to opponent)', '5'],
      ['MAJOR FOUL (to opponent)', '15'],
    ],
  },
  {
    title: 'Ranking Points',
    rows: [
      ['Win / tie', '3 / 1'],
      ['ENERGIZED (FUEL ≥ 100)', '1'],
      ['SUPERCHARGED (FUEL ≥ 360)', '1'],
      ['TRAVERSAL (TOWER ≥ 50)', '1'],
    ],
    text: 'Regional/District thresholds; District Championship and FIRST Championship are higher.',
  },
  {
    title: 'Common fouls',
    items: [
      'G403 · In AUTO do not FULLY cross the CENTER LINE (MAJOR).',
      'G408 · Do not catch FUEL leaving the HUB before it touches something else.',
      'G418 · 3-second PIN limit (MINOR, then MAJOR every 3 s).',
      'G420 · In the last 30 s do not touch an opponent at its TOWER (MAJOR and they get LEVEL 3).',
      'G405 · Do not eject FUEL from the field (except through the CORRAL opening).',
    ],
  },
  {
    title: 'Field',
    items: [
      'Drive over the BUMPS (15° ramps); under the TRENCHES only if you are ≤ 22.25 in tall.',
      'DEPOT: 24 FUEL by your wall. CHUTE: your HUMAN PLAYER releases FUEL. CORRAL: push FUEL to your HUMAN PLAYER.',
      'TOWER: LEVEL 1 = off the floor · LEVEL 2 = BUMPERS above the LOW RUNG · LEVEL 3 = above the MID RUNG.',
    ],
  },
];

export const RULES_CONTENT: Record<Lang, RulesSection[]> = { es, en };
