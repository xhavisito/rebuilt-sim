import { describe, expect, it } from 'vitest';
import type { PublicRoom } from '../src/net/directory';
import { DrivePredictor, PREDICT, driveModel } from '../src/net/prediction';
import { QUICK, mergeTarget, nextAutoStart, rankQuickRooms } from '../src/net/quickMatch';

const room = (code: string, o: Partial<PublicRoom> = {}): PublicRoom => ({ code, name: code, players: 1, started: false, quick: true, open: true, left: 0, ts: 1000, ...o });

describe('partida rápida: a qué sala entrar', () => {
  it('solo salas rápidas, abiertas y con lugar', () => {
    const list = [room('AAAAA', { quick: false }), room('BBBBB', { open: false }), room('CCCCC', { players: 6 }), room('DDDDD')];
    expect(rankQuickRooms(list).map((r) => r.code)).toEqual(['DDDDD']);
  });
  it('primero lobbies (más gente primero), luego matches con más tiempo por delante', () => {
    const list = [
      room('AAAAA', { started: true, left: 120 }),
      room('BBBBB', { players: 2 }),
      room('CCCCC', { players: 4 }),
      room('DDDDD', { started: true, left: 60 }),
      room('EEEEE', { started: true, left: QUICK.lateJoinMin - 1 }),
    ];
    expect(rankQuickRooms(list).map((r) => r.code)).toEqual(['CCCCC', 'BBBBB', 'AAAAA', 'DDDDD']);
  });
  it('se salta las que ya intentó', () => {
    expect(rankQuickRooms([room('AAAAA'), room('BBBBB')], new Set(['AAAAA'])).map((r) => r.code)).toEqual(['BBBBB']);
  });
});

describe('partida rápida: dos hosts solitarios se juntan', () => {
  it('el de código mayor se cambia al menor; el menor se queda', () => {
    expect(mergeTarget({ code: 'BBBBB', players: 1 }, [room('AAAAA'), room('BBBBB')])?.code).toBe('AAAAA');
    expect(mergeTarget({ code: 'AAAAA', players: 1 }, [room('AAAAA'), room('BBBBB')])).toBeNull();
  });
  it('el solitario se va con el lobby que tiene gente; el que tiene gente no se mueve', () => {
    expect(mergeTarget({ code: 'AAAAA', players: 1 }, [room('ZZZZZ', { players: 3 })])?.code).toBe('ZZZZZ');
    expect(mergeTarget({ code: 'ZZZZZ', players: 2 }, [room('AAAAA')])).toBeNull();
  });
  it('no se cambia a un match empezado', () => {
    expect(mergeTarget({ code: 'BBBBB', players: 1 }, [room('AAAAA', { started: true, left: 100 })])).toBeNull();
  });
});

describe('partida rápida: cuándo arranca el lobby', () => {
  const opened = 0;
  const first = QUICK.lobbySeconds * 1000;
  it('sin cambios, a la hora prevista', () => {
    expect(nextAutoStart(5000, opened, first, 1, false)).toBe(first);
  });
  it('quien entra tarde tiene unos segundos para elegir, sin pasar del tope', () => {
    expect(nextAutoStart(first - 1000, opened, first, 2, true)).toBe(first - 1000 + QUICK.joinGrace * 1000);
    expect(nextAutoStart(QUICK.maxLobbySeconds * 1000 - 500, opened, QUICK.maxLobbySeconds * 1000 - 500, 2, true)).toBe(QUICK.maxLobbySeconds * 1000);
  });
  it('lleno de personas, arranca pronto', () => {
    expect(nextAutoStart(1000, opened, first, 6, true)).toBe(1000 + QUICK.fullStart * 1000);
  });
});

describe('predicción del robot propio', () => {
  const model = driveModel({ maxSpeed: 4.5, maxAccel: 9, traction: 1.1, maxOmega: 8, drivetrain: 'swerve' }, 0.4, 0.4);
  const dt = 1 / 60;

  it('acelera con el límite del robot y no pasa la velocidad máxima', () => {
    const p = new DrivePredictor(model);
    p.reset({ x: 0, z: 0, h: 0 });
    p.step({ vx: 10, vz: 0, omega: 0 }, dt);
    expect(p.vx).toBeCloseTo(model.aMax * dt, 6);
    for (let i = 0; i < 120; i++) p.step({ vx: 10, vz: 0, omega: 0 }, dt);
    expect(p.vx).toBeCloseTo(4.5, 6);
  });

  it('el tank solo avanza sobre su eje', () => {
    const p = new DrivePredictor({ ...model, tank: true });
    p.reset({ x: 0, z: 0, h: 0 });
    for (let i = 0; i < 60; i++) p.step({ vx: 0, vz: 3, omega: 0 }, dt);
    expect(Math.hypot(p.vx, p.vz)).toBeLessThan(1e-9);
  });

  it('sin diferencias con el host (va `tau` atrás), no corrige nada', () => {
    const p = new DrivePredictor(model);
    const host = new DrivePredictor(model);
    p.reset({ x: 0, z: 0, h: 0 });
    host.reset({ x: 0, z: 0, h: 0 });
    // el host maneja igual pero se ve 9 pasos tarde
    const lag = 9;
    const seen: Array<{ x: number; z: number; h: number }> = [];
    let err = 1;
    for (let i = 0; i < 120; i++) {
      const cmd = { vx: 2 + Math.sin(i / 10), vz: Math.cos(i / 7), omega: 1.5 };
      p.step(cmd, dt);
      host.step(cmd, dt);
      seen.push({ x: host.x, z: host.z, h: host.h });
      if (seen.length > lag) err = p.correct(seen[seen.length - 1 - lag], (lag - 0.5) * dt, dt);
    }
    expect(err).toBeLessThan(1e-6);
  });

  it('si el host lo detuvo (pared), converge a su pose y deja de empujar', () => {
    const p = new DrivePredictor(model);
    p.reset({ x: 0, z: 0, h: 0 });
    for (let i = 0; i < 180; i++) {
      p.step({ vx: 4, vz: 0, omega: 0 }, dt);
      p.correct({ x: 0, z: 0, h: 0 }, 0.15, dt);
    }
    expect(Math.abs(p.x)).toBeLessThan(0.35);
  });

  it('un error grande salta directo a la pose del host', () => {
    const p = new DrivePredictor(model);
    p.reset({ x: 0, z: 0, h: 0 });
    p.step({ vx: 0, vz: 0, omega: 0 }, dt);
    const err = p.correct({ x: PREDICT.snapDist + 1, z: 0, h: 0 }, 0.1, dt);
    expect(err).toBeGreaterThan(PREDICT.snapDist);
    expect(p.x).toBeCloseTo(PREDICT.snapDist + 1, 6);
  });
});
