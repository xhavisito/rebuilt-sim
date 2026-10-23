import { describe, expect, it } from 'vitest';
import { DEFAULT_PAD, PAD } from '../src/input/actions';
import { hapticPattern, type HapticPrefs } from '../src/input/haptics';
import { axisDeadzone, buttonDown, matchPreset, PAD_PRESETS, radialDeadzone, readSticks, rebindPad } from '../src/input/padMath';

const prefs = (o: Partial<HapticPrefs> = {}): HapticPrefs => ({
  vibration: true,
  vibrationStrength: 1,
  triggerRumble: true,
  haptics: { shots: true, impacts: true, intake: true, match: true },
  ...o,
});

describe('vibración', () => {
  it('apagada globalmente o por grupo no vibra', () => {
    expect(hapticPattern('shot', 1, prefs({ vibration: false }))).toBeNull();
    expect(hapticPattern('shot', 1, prefs({ haptics: { shots: false, impacts: true, intake: true, match: true } }))).toBeNull();
    expect(hapticPattern('impact', 1, prefs({ haptics: { shots: false, impacts: true, intake: true, match: true } }))).not.toBeNull();
  });
  it('escala con la intensidad y la fuerza del choque', () => {
    const full = hapticPattern('impact', 1, prefs())!;
    const soft = hapticPattern('impact', 0.3, prefs({ vibrationStrength: 0.5 }))!;
    expect(soft.strong).toBeCloseTo(full.strong * 0.15);
    expect(soft.ms).toBeLessThan(full.ms);
    expect(hapticPattern('impact', 0.001, prefs())).toBeNull();
  });
  it('los gatillos solo vibran si están activados', () => {
    expect(hapticPattern('shot', 1, prefs())!.right).toBeGreaterThan(0);
    expect(hapticPattern('shot', 1, prefs({ triggerRumble: false }))!.right).toBeUndefined();
    expect(hapticPattern('intake', 1, prefs())!.left).toBeGreaterThan(0);
  });
  it('los tiros no hacen vibrar el teléfono', () => {
    expect(hapticPattern('shot', 1, prefs())!.phoneMs).toBe(0);
    expect(hapticPattern('impact', 1, prefs())!.phoneMs).toBeGreaterThan(0);
  });
});

describe('sticks', () => {
  it('zona muerta radial reescalada', () => {
    expect(radialDeadzone(0.05, 0.05, 0.12, 'linear')).toEqual([0, 0]);
    const [x, y] = radialDeadzone(1, 0, 0.12, 'linear');
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(0);
    // la diagonal conserva su dirección
    const [dx, dy] = radialDeadzone(0.5, 0.5, 0.1, 'quadratic');
    expect(dx).toBeCloseTo(dy);
    expect(axisDeadzone(-0.1, 0.12, 'linear')).toBe(0);
    expect(axisDeadzone(-1, 0.12, 'quadratic')).toBeCloseTo(-1);
  });
  it('esquema zurdo intercambia los sticks e invertir giro cambia el signo', () => {
    const axes = [0.9, 0, 0, -0.9]; // izq. a la derecha, der. arriba
    const std = readSticks(axes, { deadzone: 0.1, curve: 'linear', layout: 'standard', invertRotate: false });
    expect(std.moveX).toBeGreaterThan(0.8);
    expect(std.moveY).toBeCloseTo(0);
    const south = readSticks(axes, { deadzone: 0.1, curve: 'linear', layout: 'southpaw', invertRotate: true });
    expect(south.moveY).toBeGreaterThan(0.8);
    expect(south.rotate).toBeLessThan(-0.8);
  });
});

describe('botones', () => {
  it('umbral de gatillos', () => {
    expect(buttonDown({ pressed: true, value: 0.2 }, PAD.RT, 0.3)).toBe(false);
    expect(buttonDown({ pressed: true, value: 0.35 }, PAD.RT, 0.3)).toBe(true);
    // gatillo digital que solo reporta pressed
    expect(buttonDown({ pressed: true, value: 0 }, PAD.LT, 0.3)).toBe(true);
    expect(buttonDown({ pressed: true, value: 1 }, PAD.A, 0.9)).toBe(true);
    expect(buttonDown(undefined, PAD.A, 0.3)).toBe(false);
  });
  it('reasignar intercambia con la acción que usaba el botón', () => {
    const b = rebindPad(DEFAULT_PAD, 'shoot', PAD.A);
    expect(b.shoot).toEqual([PAD.A]);
    expect(b.climbUp).toEqual([PAD.RT]);
    expect(DEFAULT_PAD.shoot).toEqual([PAD.RT]); // no muta el original
    expect(rebindPad(DEFAULT_PAD, 'pass', PAD.X).cameraNext).toEqual([PAD.RB]);
  });
  it('detecta los esquemas', () => {
    expect(matchPreset(DEFAULT_PAD)).toBe('default');
    expect(matchPreset(PAD_PRESETS.bumpers)).toBe('bumpers');
    expect(matchPreset(rebindPad(DEFAULT_PAD, 'shoot', PAD.A))).toBeNull();
  });
});
