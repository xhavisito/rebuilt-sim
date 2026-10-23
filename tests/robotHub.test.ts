import { afterEach, describe, expect, it, vi } from 'vitest';

const URL_ = 'https://abc.supabase.co';
const PATH = '0f8fad5b-d9cb-469f-a165-70867728950e.glb';

async function hub() {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', `${URL_}/`);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  return import('../src/net/robotHub');
}

afterEach(() => vi.unstubAllEnvs());

describe('galería de la comunidad', () => {
  it('solo acepta CAD del bucket público de la galería', async () => {
    const { hubCadUrlAllowed } = await hub();
    expect(hubCadUrlAllowed(`${URL_}/storage/v1/object/public/robots/${PATH}`)).toBe(true);
    expect(hubCadUrlAllowed(`https://evil.example/storage/v1/object/public/robots/${PATH}`)).toBe(false);
    expect(hubCadUrlAllowed(`${URL_}/storage/v1/object/public/robots/../x.glb`)).toBe(false);
    expect(hubCadUrlAllowed(undefined)).toBe(false);
  });

  it('valida la fila y apunta el CAD al GLB público', async () => {
    const { hubRow } = await hub();
    const id = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b';
    const r = hubRow({
      id,
      created_at: '2026-10-23T00:00:00Z',
      name: 'Bestia',
      team: 1234,
      author: 'Xhavi',
      spec: { maxSpeed: 5, customCad: { id: 'otro', name: 'r.glb', unit: 0.001, scalePct: 100, upAxis: 'z', yawDeg: 0, offsetIn: [0, 0, 0], url: 'https://evil.example/x.glb' } },
      cad_path: PATH,
      cad_bytes: 1000,
      downloads: 3,
    })!;
    expect(r.spec.id).toBe(`hub-${id}`);
    expect(r.spec.maxSpeed).toBe(5);
    expect(r.spec.customCad).toMatchObject({ id: `hub-${id}`, unit: 0.001, upAxis: 'z', url: `${URL_}/storage/v1/object/public/robots/${PATH}` });
    // Sin GLB en la galería, no hay CAD propio; ids raros se descartan
    expect(hubRow({ id, name: 'x', team: 1, spec: { customCad: { unit: 1 } }, cad_path: null })!.spec.customCad).toBeUndefined();
    expect(hubRow({ id: 'no-uuid', spec: {} })).toBeNull();
    expect(hubRow({ id, spec: 'x' })).toBeNull();
  });
});
