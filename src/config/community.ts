/**
 * Galería de robots de la comunidad: un proyecto gratuito de Supabase (tabla `robots` + bucket
 * público `robots`, ver docs/comunidad.md y docs/comunidad.sql). Se activa al compilar con
 * VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (la llave "anon" es pública por diseño: lo que puede
 * hacer la limitan los permisos del SQL). Sin ellas, la galería no aparece.
 */
export const COMMUNITY = {
  url: String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, ''),
  key: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''),
  /** Límite de archivo del plan gratuito de Supabase Storage. */
  maxCadBytes: 50 * 1024 * 1024,
  /** Reportes con los que un robot deja de mostrarse (se revisa a mano en el panel de Supabase). */
  hideAtReports: 3,
};

export const communityEnabled = (): boolean => !!COMMUNITY.url && !!COMMUNITY.key;
