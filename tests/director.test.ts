import { describe, expect, it } from 'vitest';
import { Director, type DirectorRobot } from '../src/game/Director';

const robots = (n = 6): DirectorRobot[] => Array.from({ length: n }, (_, i) => ({ speed: 0, alliance: i < 3 ? 'red' : 'blue', climbing: false }));

describe('director de cámaras', () => {
  it('antes del match: toma abierta', () => {
    const d = new Director(() => 0);
    expect(d.update(0.1, robots(), 'PRE', 160).mode).toBe('broadcast');
  });

  it('corta al robot más interesante, pero no antes de 3.5 s', () => {
    const d = new Director(() => 0);
    const rs = robots();
    d.update(0.1, rs, 'SHIFT1', 100);
    d.note(4, 4);
    expect(d.update(1, rs, 'SHIFT1', 99).focus).toBe(0);
    let shot = d.shot;
    for (let k = 0; k < 30 && shot.focus !== 4; k++) {
      d.note(4, 1); // ráfaga de tiros
      shot = d.update(0.2, rs, 'SHIFT1', 98);
    }
    expect(shot.focus).toBe(4);
    expect(d.held).toBe(0);
  });

  it('un choque fuerte corta antes', () => {
    const d = new Director(() => 0);
    const rs = robots();
    d.update(0.1, rs, 'SHIFT2', 80);
    d.update(1.6, rs, 'SHIFT2', 78);
    d.note(2, 6);
    expect(d.update(0.05, rs, 'SHIFT2', 78).focus).toBe(2);
  });

  it('nunca repite la toma y sin acción corta a los 9 s', () => {
    const d = new Director(() => 0.5);
    const rs = robots();
    let prev = d.update(0.1, rs, 'SHIFT3', 60);
    let cuts = 0;
    for (let k = 0; k < 400; k++) {
      const s = d.update(0.1, rs, 'SHIFT3', 60);
      if (s !== prev) {
        expect(s.mode).not.toBe(prev.mode);
        cuts++;
      }
      prev = s;
    }
    expect(cuts).toBeGreaterThanOrEqual(4);
  });

  it('al final, quien sube a la TOWER sale de cerca', () => {
    const d = new Director(() => 0.99);
    const rs = robots();
    rs[5].climbing = true;
    let s = d.update(0.1, rs, 'END_GAME', 15);
    for (let k = 0; k < 100 && s.focus !== 5; k++) s = d.update(0.1, rs, 'END_GAME', 15);
    expect(s).toEqual({ mode: 'third', focus: 5 });
  });
});
