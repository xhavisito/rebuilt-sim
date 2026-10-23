/** Pruebas de la lógica pura del juego (Game Manual TU22). */
import { describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { formatTimer, phaseAt, T, timerSeconds, timeToNextShiftChange } from '../src/core/clock';
import { decideFirstInactive, fuelCounts, hubActive, hubLight } from '../src/core/hub';
import { Match } from '../src/core/match';
import { Rng } from '../src/core/rng';
import { RP_THRESHOLDS, rankingPoints } from '../src/core/rp';
import { levelOf, scoreAutoTower, scoreTeleopTower, type ClimbSnapshot } from '../src/core/tower';
import type { Alliance, Phase } from '../src/core/types';

describe('reloj y periodos (§6.4, Tabla 6-2)', () => {
  it('secuencia y tiempos exactos', () => {
    const seq: Array<[number, Phase]> = [
      [-0.1, 'PRE'],
      [0, 'AUTO'],
      [19.99, 'AUTO'],
      [20, 'AUTO_PAUSE'],
      [22.99, 'AUTO_PAUSE'],
      [23, 'TRANSITION'],
      [32.99, 'TRANSITION'],
      [33, 'SHIFT1'],
      [58, 'SHIFT2'],
      [83, 'SHIFT3'],
      [108, 'SHIFT4'],
      [133, 'END_GAME'],
      [162.99, 'END_GAME'],
      [163, 'POST'],
      [166, 'DONE'],
    ];
    for (const [t, p] of seq) expect(phaseAt(t), `t=${t}`).toBe(p);
  });

  it('el timer muestra 0:20→0:00 en AUTO y 2:20→0:00 en TELEOP con las marcas de SHIFT', () => {
    expect(formatTimer(timerSeconds(0))).toBe('0:20');
    expect(formatTimer(timerSeconds(19.5))).toBe('0:01');
    expect(formatTimer(timerSeconds(21))).toBe('0:00');
    expect(formatTimer(timerSeconds(T.teleopStart))).toBe('2:20');
    expect(formatTimer(timerSeconds(T.shift1))).toBe('2:10');
    expect(formatTimer(timerSeconds(T.shift2))).toBe('1:45');
    expect(formatTimer(timerSeconds(T.shift3))).toBe('1:20');
    expect(formatTimer(timerSeconds(T.shift4))).toBe('0:55');
    expect(formatTimer(timerSeconds(T.endGame))).toBe('0:30');
    expect(formatTimer(timerSeconds(T.teleopEnd - 0.01))).toBe('0:01');
  });

  it('duraciones: AUTO 20 s, TRANSITION 10 s, SHIFTS 25 s, END GAME 30 s, TELEOP 2:20', () => {
    expect(T.autoEnd - T.autoStart).toBe(20);
    expect(T.shift1 - T.teleopStart).toBe(10);
    expect(T.shift2 - T.shift1).toBe(25);
    expect(T.endGame - T.shift4).toBe(25);
    expect(T.teleopEnd - T.endGame).toBe(30);
    expect(T.teleopEnd - T.teleopStart).toBe(140);
  });

  it('cuenta regresiva al próximo cambio de SHIFT', () => {
    expect(timeToNextShiftChange(T.teleopStart)).toBe(10);
    expect(timeToNextShiftChange(T.shift1 + 5)).toBe(20);
    expect(timeToNextShiftChange(T.endGame + 1)).toBeNull();
  });
});

describe('estado de los HUBS (Tabla 6-3)', () => {
  const table = (first: Alliance) =>
    (['AUTO', 'TRANSITION', 'SHIFT1', 'SHIFT2', 'SHIFT3', 'SHIFT4', 'END_GAME'] as Phase[]).map((p) => [
      hubActive(p, 'red', first),
      hubActive(p, 'blue', first),
    ]);

  it('rojo anota más en AUTO → rojo inactivo en SHIFT 1 y 3', () => {
    const first = decideFirstInactive({ red: 10, blue: 4 }, new Rng(1));
    expect(first).toEqual({ alliance: 'red', random: false });
    expect(table(first.alliance)).toEqual([
      [true, true],
      [true, true],
      [false, true],
      [true, false],
      [false, true],
      [true, false],
      [true, true],
    ]);
  });

  it('azul anota más en AUTO → azul inactivo en SHIFT 1 y 3', () => {
    const first = decideFirstInactive({ red: 3, blue: 9 }, new Rng(1));
    expect(first.alliance).toBe('blue');
    expect(table('blue')).toEqual([
      [true, true],
      [true, true],
      [true, false],
      [false, true],
      [true, false],
      [false, true],
      [true, true],
    ]);
  });

  it('empate → el FMS elige al azar (ambas alianzas posibles)', () => {
    const seen = new Set<Alliance>();
    for (let s = 1; s < 40; s++) {
      const d = decideFirstInactive({ red: 7, blue: 7 }, new Rng(s));
      expect(d.random).toBe(true);
      seen.add(d.alliance);
    }
    expect(seen.size).toBe(2);
  });

  it('3 s de gracia después de la desactivación', () => {
    // Rojo inactivo en SHIFT 1: su HUB se apaga a 2:10 (t = 33)
    expect(fuelCounts(T.shift1 - 0.1, 'red', 'red')).toBe(true);
    expect(fuelCounts(T.shift1 + 2.9, 'red', 'red')).toBe(true);
    expect(fuelCounts(T.shift1 + 3.1, 'red', 'red')).toBe(false);
    // Azul (activo en SHIFT 1) se apaga a 1:45 (t = 58)
    expect(fuelCounts(T.shift2 + 2.5, 'blue', 'red')).toBe(true);
    expect(fuelCounts(T.shift2 + 3.5, 'blue', 'red')).toBe(false);
    // Al reactivarse cuenta de inmediato
    expect(fuelCounts(T.shift2 + 0.01, 'red', 'red')).toBe(true);
    // Final del match: cuenta hasta 3 s después de 0:00
    expect(fuelCounts(T.teleopEnd + 2.9, 'red', 'red')).toBe(true);
    expect(fuelCounts(T.teleopEnd + 3.1, 'red', 'red')).toBe(false);
  });

  it('luces: persecución blanca en TRANSITION para el que se apaga, pulso 3 s antes', () => {
    expect(hubLight(T.teleopStart + 1, 'red', 'red')).toBe('chase');
    expect(hubLight(T.teleopStart + 1, 'blue', 'red')).toBe('active');
    expect(hubLight(T.shift1 - 2, 'red', 'red')).toBe('pulse');
    expect(hubLight(T.shift1 + 1, 'red', 'red')).toBe('off');
    expect(hubLight(T.shift2 - 1, 'blue', 'red')).toBe('pulse');
    expect(hubLight(T.teleopEnd - 1, 'blue', 'red')).toBe('pulse');
    expect(hubLight(T.teleopEnd + 1, 'blue', 'red')).toBe('white');
    expect(hubLight(T.postEnd + 1, 'blue', 'red')).toBe('purple');
    expect(hubLight(-1, 'blue', null)).toBe('off');
  });
});

describe('puntuación del match', () => {
  it('FUEL de AUTO cuenta hasta 3 s tras 0:00 y decide el SHIFT 1', () => {
    const m = new Match('regional', new Rng(3));
    m.seek(10);
    m.fuelEntered('blue');
    m.fuelEntered('blue');
    m.fuelEntered('red');
    m.seek(21.5); // pausa de evaluación
    m.fuelEntered('red');
    m.fuelEntered('red');
    expect(m.fuel.red.auto).toBe(3);
    expect(m.fuel.blue.auto).toBe(2);
    const ev = m.seek(T.teleopStart + 0.1);
    expect(ev.some((e) => e.type === 'firstInactive' && e.alliance === 'red')).toBe(true);
    // SHIFT 1: rojo inactivo → no da puntos
    m.seek(T.shift1 + 5);
    expect(m.fuelEntered('red').counted).toBe(false);
    expect(m.fuelEntered('blue').counted).toBe(true);
    expect(m.fuel.red.wasted).toBe(1);
    expect(m.score('blue')).toBe(3);
  });

  it('faltas: MINOR = 5 y MAJOR = 15 para el oponente', () => {
    const m = new Match('regional', new Rng(1));
    m.start();
    m.addFoul('G418', 'MINOR', 'red', 0);
    m.addFoul('G403', 'MAJOR', 'red', 0);
    m.addFoul('G408', 'MINOR', 'blue', 3);
    expect(m.foulPointsFor('blue')).toBe(20);
    expect(m.foulPointsFor('red')).toBe(5);
    expect(m.score('blue')).toBe(20);
    expect(m.score('red')).toBe(5);
  });

  it('YELLOW + YELLOW = RED y descalifica (0 RP en Qualification)', () => {
    const m = new Match('regional', new Rng(1));
    m.start();
    expect(m.addCard('YELLOW', 'red', 2, 'G415').card).toBe('YELLOW');
    expect(m.addCard('YELLOW', 'red', 2, 'G417').card).toBe('RED');
    expect(m.disqualified.has(2)).toBe(true);
    expect(m.rp('red', true).total).toBe(0);
  });

  it('una YELLOW CARD de un match anterior convierte la siguiente en RED', () => {
    const m = new Match('regional', new Rng(1));
    m.carryYellow(4);
    m.start();
    expect(m.hasYellow(4)).toBe(true);
    expect(m.cards.length).toBe(0); // la que trae no se vuelve a anotar
    expect(m.addCard('YELLOW', 'blue', 4, 'G418').card).toBe('RED');
    expect(m.disqualified.has(4)).toBe(true);
    expect(m.addCard('YELLOW', 'blue', 5, 'G418').card).toBe('YELLOW');
  });
});

describe('TOWER (§6.5.2)', () => {
  const snap = (o: Partial<ClimbSnapshot>): ClimbSnapshot => ({
    robot: 0,
    alliance: 'red',
    touchingFloorOrBase: false,
    bumperBottom: 0.1,
    touchingOwnRungOrUpright: true,
    touchingIllegal: false,
    ineligible: false,
    g420Level3: false,
    ...o,
  });

  it('criterios de nivel', () => {
    expect(levelOf(snap({ touchingFloorOrBase: true }))).toBe(0);
    expect(levelOf(snap({ bumperBottom: 0.1 }))).toBe(1);
    expect(levelOf(snap({ bumperBottom: F.RUNG_HEIGHTS.LOW + F.RUNG_OD / 2 + 0.01 }))).toBe(2);
    expect(levelOf(snap({ bumperBottom: F.RUNG_HEIGHTS.MID + F.RUNG_OD / 2 + 0.01 }))).toBe(3);
    expect(levelOf(snap({ touchingOwnRungOrUpright: false }))).toBe(0);
    expect(levelOf(snap({ touchingIllegal: true }))).toBe(0);
    expect(levelOf(snap({ ineligible: true, bumperBottom: 2 }))).toBe(0);
  });

  it('AUTO: 15 por robot en LEVEL 1, máximo 2 por alianza', () => {
    const r = scoreAutoTower([
      snap({ robot: 0 }),
      snap({ robot: 1 }),
      snap({ robot: 2, bumperBottom: 1.5 }), // aunque esté más alto, en AUTO solo cuenta L1
      snap({ robot: 3, alliance: 'blue' }),
    ]);
    expect(r.byAlliance.red).toBe(30);
    expect(r.byAlliance.blue).toBe(15);
    expect(r.perRobot.get(2)!.points).toBe(0);
  });

  it('TELEOP: 10 / 20 / 30, un nivel por robot', () => {
    const r = scoreTeleopTower([
      snap({ robot: 0, bumperBottom: 0.2 }),
      snap({ robot: 1, bumperBottom: F.RUNG_HEIGHTS.LOW + 0.1 }),
      snap({ robot: 2, bumperBottom: F.RUNG_HEIGHTS.MID + 0.1 }),
    ]);
    expect([0, 1, 2].map((i) => r.perRobot.get(i)!.points)).toEqual([10, 20, 30]);
    expect(r.byAlliance.red).toBe(60);
  });

  it('G420 otorga LEVEL 3 al robot despegado del piso', () => {
    const r = scoreTeleopTower([snap({ robot: 0, bumperBottom: 0.15, g420Level3: true })]);
    expect(r.perRobot.get(0)).toEqual({ level: 3, points: 30 });
  });
});

describe('Ranking Points (Tabla 6-5)', () => {
  it('umbrales por tipo de evento', () => {
    expect(RP_THRESHOLDS.regional).toEqual({ energized: 100, supercharged: 360, traversal: 50 });
    expect(RP_THRESHOLDS.districtChamp).toEqual({ energized: 240, supercharged: 360, traversal: 50 });
    expect(RP_THRESHOLDS.champs).toEqual({ energized: 360, supercharged: 500, traversal: 50 });
  });

  it('win/tie y bonus', () => {
    const base = { fuel: 100, towerPoints: 50, score: 200, opponentScore: 150 };
    expect(rankingPoints(base, 'regional')).toEqual({ win: 3, energized: true, supercharged: false, traversal: true, total: 5 });
    expect(rankingPoints({ ...base, fuel: 360 }, 'regional').total).toBe(6);
    expect(rankingPoints({ ...base, fuel: 239 }, 'districtChamp').energized).toBe(false);
    expect(rankingPoints({ ...base, fuel: 360 }, 'champs')).toMatchObject({ energized: true, supercharged: false });
    expect(rankingPoints({ ...base, fuel: 500 }, 'champs').supercharged).toBe(true);
    expect(rankingPoints({ ...base, score: 150 }, 'regional').win).toBe(1);
    expect(rankingPoints({ ...base, towerPoints: 49, score: 10 }, 'regional').total).toBe(1);
  });
});

