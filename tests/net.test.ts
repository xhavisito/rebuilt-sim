import { describe, expect, it } from 'vitest';
import { emptyInput } from '../src/input/actions';
import { decodeInput, decodeSnapshot, encodeInput, encodeSnapshot, newFuelSnap, parseRoomCode, qPos, roomCode, ROBOT_MECH, type RobotSnap } from '../src/net/protocol';

const robot = (x: number): RobotSnap => ({ p: [x, 0.1, -2], q: [0, 0.6, 0, 0.8], v: [1.5, -0.5], mech: ROBOT_MECH.map((_, k) => k * 0.25), flags: 5 });

describe('protocolo en línea', () => {
  it('controles: ida y vuelta, con flancos y mouse', () => {
    const inp = emptyInput();
    inp.moveX = 0.5;
    inp.moveY = -1;
    inp.rotate = 0.25;
    inp.held.shoot = true;
    inp.held.slow = true;
    inp.pressed.add('intake');
    inp.mouseNdc = { x: 0.1, y: -0.2 };
    const out = decodeInput(JSON.parse(JSON.stringify(encodeInput(inp))));
    expect([out.moveX, out.moveY, out.rotate]).toEqual([0.5, -1, 0.25]);
    expect(out.held.shoot && out.held.slow && !out.held.pass).toBe(true);
    expect([...out.pressed]).toEqual(['intake']);
    expect(out.mouseNdc).toEqual({ x: 0.1, y: -0.2 });
  });

  it('controles de otra computadora se sanean', () => {
    const out = decodeInput({ mx: 99, my: Number.NaN, rot: -5, held: 0, pressed: 0, mouse: null });
    expect([out.moveX, out.moveY, out.rotate]).toEqual([1, 0, -1]);
  });

  it('estado: robots completos y FUEL solo cuando cambia', () => {
    const n = 4;
    const fuel = newFuelSnap(n);
    fuel.state.fill(0);
    for (let i = 0; i < n * 3; i++) fuel.pos[i] = qPos(i * 0.1);
    const sent = newFuelSnap(n);
    const a = encodeSnapshot(1.5, 3.25, [robot(1), robot(-2)], fuel, sent);
    const s1 = decodeSnapshot(a, newFuelSnap(n))!;
    expect(s1.t).toBeCloseTo(1.5);
    expect(s1.mt).toBeCloseTo(3.25);
    expect(s1.robots[1].p[0]).toBeCloseTo(-2);
    expect(s1.robots[0].mech[3]).toBeCloseTo(0.75);
    expect(s1.robots[0].flags).toBe(5);
    expect([...s1.fuel.pos]).toEqual([...fuel.pos]);
    // sin cambios: el FUEL no se reenvía
    const b = encodeSnapshot(1.6, 3.35, [robot(1), robot(-2)], fuel, sent);
    expect(b.byteLength).toBeLessThan(a.byteLength);
    // un FUEL entra a un robot: solo ese viaja, y el estado se reconstruye sobre el anterior
    fuel.state[2] = 1;
    fuel.owner[2] = 1;
    const c = encodeSnapshot(1.7, 3.45, [robot(1), robot(-2)], fuel, sent);
    expect(c.byteLength - b.byteLength).toBe(11);
    const s3 = decodeSnapshot(c, decodeSnapshot(b, s1.fuel)!.fuel)!;
    expect(s3.fuel.state[2]).toBe(1);
    expect(s3.fuel.owner[2]).toBe(1);
    expect(s3.fuel.pos[0]).toBe(fuel.pos[0]);
  });

  it('un mensaje corrupto no se decodifica', () => {
    expect(decodeSnapshot(new ArrayBuffer(5), newFuelSnap(2))).toBeNull();
  });

  it('códigos de sala', () => {
    const c = roomCode();
    expect(c).toMatch(/^[A-Z2-9]{5}$/);
    expect(parseRoomCode(` ${c.toLowerCase().slice(0, 2)}-${c.slice(2)} `)).toBe(c);
    expect(parseRoomCode('ABC')).toBeNull();
    expect(parseRoomCode('ABCD0')).toBeNull();
  });
});
