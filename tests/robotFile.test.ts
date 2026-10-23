import { describe, expect, it } from 'vitest';
import { decodeRobotFile, encodeRobotFile } from '../src/config/robotFile';
import { DEFAULT_LOOK, fitScalePct, guessCadUnit, newRobotTemplate, presetById, resolveLook, DEFAULT_ROBOT_ID } from '../src/config/robots';

describe('CAD propio: unidades y escala', () => {
  it('adivina la unidad por el tamaño del marco', () => {
    const frame = 27 * 0.0254; // 27 in
    expect(guessCadUnit(0.7, frame)).toBe(1); // metros
    expect(guessCadUnit(700, frame)).toBe(0.001); // mm
    expect(guessCadUnit(27.5, frame)).toBe(0.0254); // pulgadas
    expect(guessCadUnit(70, frame)).toBe(0.01); // cm
    expect(guessCadUnit(0, frame)).toBe(1);
  });

  it('ajusta la huella al marco por el lado más justo', () => {
    expect(fitScalePct(1, 0.5, 0.7, 0.7)).toBe(70);
    expect(fitScalePct(0.35, 0.35, 0.7, 0.7)).toBe(200);
  });
});

describe('archivo de robot', () => {
  it('ida y vuelta con CAD propio: ids nuevos y el GLB intacto', () => {
    const s = newRobotTemplate();
    s.name = 'Prueba';
    s.maxSpeed = 5.1;
    s.shooter.lanes = 3;
    s.customCad = { id: 'cad-x', name: 'r.glb', unit: 0.001, scalePct: 98, upAxis: 'z', yawDeg: 90, offsetIn: [1, 0, 2], turretNode: 'Turret' };
    const glb = new Uint8Array(70000).map((_, i) => i % 251);
    const back = decodeRobotFile(encodeRobotFile(s, glb.buffer), 'custom-new');
    expect(back.spec.id).toBe('custom-new');
    expect(back.spec.name).toBe('Prueba');
    expect(back.spec.maxSpeed).toBe(5.1);
    expect(back.spec.shooter.lanes).toBe(3);
    expect(back.spec.customCad).toMatchObject({ id: 'custom-new-cad', unit: 0.001, scalePct: 98, upAxis: 'z', yawDeg: 90, turretNode: 'Turret' });
    expect(new Uint8Array(back.cad!)).toEqual(glb);
  });

  it('sin GLB no conserva el CAD propio; el CAD real del equipo sí viaja', () => {
    const s = presetById(DEFAULT_ROBOT_ID);
    s.customCad = { id: 'x', name: 'r.glb', unit: 1, scalePct: 100, upAxis: 'y', yawDeg: 0, offsetIn: [0, 0, 0] };
    const back = decodeRobotFile(encodeRobotFile(s));
    expect(back.spec.customCad).toBeUndefined();
    expect(back.cad).toBeUndefined();
    expect(back.spec.cad).toEqual(s.cad);
    expect(back.spec.real).toBeUndefined();
  });

  it('completa campos faltantes e ignora tipos incorrectos', () => {
    const back = decodeRobotFile(JSON.stringify({ format: 'rebuilt-sim-robot', version: 1, spec: { name: 'Viejo', maxSpeed: 'rápido', intake: { rate: 20 } } }));
    expect(back.spec.name).toBe('Viejo');
    expect(back.spec.maxSpeed).toBe(newRobotTemplate().maxSpeed);
    expect(back.spec.intake.rate).toBe(20);
    expect(back.spec.intake.widthIn).toBe(newRobotTemplate().intake.widthIn);
  });

  it('rechaza archivos que no son robots o de versiones nuevas', () => {
    expect(() => decodeRobotFile('{')).toThrow('not-json');
    expect(() => decodeRobotFile('{"format":"otro","spec":{}}')).toThrow('not-robot');
    expect(() => decodeRobotFile('{"format":"rebuilt-sim-robot","version":99,"spec":{}}')).toThrow('newer-version');
  });
});

describe('estética del robot (look)', () => {
  it('completa lo que falta y descarta valores inválidos', () => {
    expect(resolveLook(undefined)).toEqual(DEFAULT_LOOK);
    expect(resolveLook({ finish: 'candy', underglow: '#00ffAA', leds: 'rainbow' })).toEqual({ finish: 'candy', underglow: '#00ffAA', leds: 'rainbow' });
    expect(resolveLook({ finish: 'oro', underglow: 'red; x', leds: 7 })).toEqual(DEFAULT_LOOK);
    expect(resolveLook({ underglow: 'off' }).underglow).toBe('off');
  });

  it('viaja en el archivo y se valida al importarlo', () => {
    const s = newRobotTemplate();
    s.look = { finish: 'carbon', underglow: '#ff00ff', leds: 'off' };
    expect(decodeRobotFile(encodeRobotFile(s)).spec.look).toEqual(s.look);
    const bad = JSON.parse(encodeRobotFile(s));
    bad.spec.look = { finish: 'x', underglow: 'url(evil)' };
    expect(decodeRobotFile(JSON.stringify(bad)).spec.look).toEqual(DEFAULT_LOOK);
  });
});
