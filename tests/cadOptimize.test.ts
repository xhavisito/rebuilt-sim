import { readFileSync } from 'node:fs';
import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { countTriangles, optimizeCadBuffer } from '../src/render/cadOptimize';

describe('optimizar CAD propio', () => {
  it('baja al presupuesto de triángulos, conserva los nombres y sigue siendo un GLB válido', async () => {
    const src = new Uint8Array(readFileSync('public/robots/1678.glb'));
    const steps: string[] = [];
    const r = await optimizeCadBuffer(src, { targetTriangles: 20_000 }, (s) => steps.push(s));
    expect(steps).toEqual(['read', 'clean', 'simplify', 'compress']);
    expect(r.trianglesIn).toBeGreaterThan(40_000);
    expect(r.trianglesOut).toBeLessThan(r.trianglesIn * 0.6);
    expect(r.glb.byteLength).toBeLessThan(src.byteLength);
    await MeshoptDecoder.ready;
    const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.readBinary(r.glb);
    expect(countTriangles(doc)).toBe(r.trianglesOut);
    const names = doc.getRoot().listNodes().map((n) => n.getName());
    expect(names).toContain('main');
    expect(names).toContain('c0');
  }, 60_000);
});
