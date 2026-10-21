import { describe, expect, it } from 'vitest';
import * as F from '../src/config/field';
import { behindTower } from '../src/ai/Navigator';

describe('IA: FUEL detrás de la TOWER', () => {
  for (const a of ['red', 'blue'] as const) {
    const tw = F.towerInfo(a);
    const wall = (d: number) => tw.uprightX - tw.facing * d; // hacia la pared
    it(`${a}: entre UPRIGHTS y pared, y en la esquina junto a la TOWER`, () => {
      expect(behindTower(wall(0.5), tw.cz)).toBe(a);
      expect(behindTower(wall(0.7), tw.cz - F.TOWER_WIDTH / 2 - 0.4, 0.5)).toBe(a);
      expect(behindTower(tw.uprightX + tw.facing * 0.2, tw.cz, 0.5, 0.35)).toBe(a);
    });
    it(`${a}: frente a la TOWER y lejos de ella no`, () => {
      expect(behindTower(tw.uprightX + tw.facing * 0.6, tw.cz, 0.5, 0.35)).toBeNull();
      expect(behindTower(wall(0.5), tw.cz + F.TOWER_WIDTH / 2 + 0.8, 0.5)).toBeNull();
    });
  }
  it('el centro del campo no', () => expect(behindTower(0, 0, 0.5, 0.35)).toBeNull());
});
