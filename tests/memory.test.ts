import { describe, expect, it } from 'vitest';
import { AiMemory, type MemoryData } from '../src/ai/Memory';
import { Rng } from '../src/core/rng';

const fresh = (prior: MemoryData | null = null) => new AiMemory(prior, { v: 1, robots: {} }, false);

describe('memoria de la IA (prueba y error)', () => {
  it('deja de usar la táctica que no funciona y se queda con la que sí', () => {
    const mem = fresh();
    const rng = new Rng(3);
    const truth: Record<string, number> = { hold: 0, stockpile: 8, defend: -6 };
    const picks: string[] = [];
    for (let k = 0; k < 200; k++) {
      const t = mem.choose('r', 'inactive-S', ['hold', 'stockpile', 'defend'], rng, {}, 0.05);
      picks.push(t);
      mem.record('r', 'inactive-S', t, truth[t] + rng.gauss() * 6);
    }
    const last = picks.slice(-60);
    expect(last.filter((t) => t === 'stockpile').length).toBeGreaterThan(40);
    expect(last.filter((t) => t === 'defend').length).toBeLessThan(8);
    expect(mem.arm('r', 'inactive-S', 'stockpile').mean).toBeGreaterThan(mem.arm('r', 'inactive-S', 'defend').mean);
  });

  it('el playbook de fábrica pesa poco: lo que aprende el jugador se impone', () => {
    const prior: MemoryData = { v: 1, robots: { r: { tactics: { c: { hold: { n: 500, mean: 10 } } }, hazards: {}, rate: { value: 1, n: 5 }, matches: 50 } } };
    const mem = fresh(prior);
    for (let k = 0; k < 20; k++) mem.record('r', 'c', 'hold', -10);
    expect(mem.arm('r', 'c', 'hold').mean).toBeLessThan(0);
  });

  it('recuerda dónde se atoró y lo va olvidando', () => {
    const mem = fresh();
    for (let k = 0; k < 4; k++) mem.addHazard('r', -6.9, 0.2);
    const c0 = mem.hazardCost('r', -7.1, 0.4);
    expect(c0).toBeGreaterThan(1);
    expect(mem.hazardCost('r', 3, 3)).toBe(0);
    for (let k = 0; k < 12; k++) mem.endMatch('r', null);
    expect(mem.hazardCost('r', -7.1, 0.4)).toBeLessThan(c0 / 3);
  });

  it('aprende su ritmo de anotación', () => {
    const mem = fresh();
    expect(mem.rate('r')).toBeNull();
    mem.endMatch('r', 1.2);
    mem.endMatch('r', 1.6);
    expect(mem.rate('r')).toBeCloseTo(1.4, 5);
  });
});
