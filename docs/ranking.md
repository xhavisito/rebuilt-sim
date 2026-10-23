# Ranking global (backend)

El ranking global usa el **mismo proyecto gratuito de Supabase** que la galería de robots
([comunidad.md](comunidad.md)). Si la galería ya está activada, solo falta el paso 1.

## Activarlo

1. **Supabase → SQL Editor → New query**: pega todo [`ranking.sql`](ranking.sql) y dale **Run**
   (se puede volver a correr sin romper nada).
2. Si todavía no hiciste los pasos de [comunidad.md](comunidad.md) (crear el proyecto y poner
   `SUPABASE_URL` / `SUPABASE_ANON_KEY` en las variables del repo), hazlos y vuelve a publicar.

Sin esas variables el juego usa el ranking informal por el broker MQTT público (sin servidor).

## Cómo funciona

- **Cuentas sin correo**: al terminar su primer match con el ranking activado, cada navegador crea
  una cuenta (id + token secreto; el servidor guarda solo el hash del token). En
  **Estadísticas → Ranking global → Tu cuenta del ranking** está el **código de cuenta** para usarla
  en otro dispositivo. Apagar "Aparecer en el ranking global" borra la cuenta y sus matches.
- **El servidor calcula el rating** (Elo, igual que `src/core/stats.ts`): la página solo manda los
  números del match y `submit_match` los valida:
  - un match cada 140 s por cuenta (un match dura 2:40) y fechas de las últimas 24 h, nunca antes
    que el match anterior (los matches sin conexión esperan en una cola y se mandan después);
  - solo modos con reglas completas (3 vs 3, multijugador, torneo, en línea) y dificultad válida;
  - números posibles en REBUILT: FUEL ≤ 600 y ≤ tiros; TOWER por robot 0/10/15/20/25/30/35/45;
    faltas en múltiplos de 5; FUEL + TOWER del robot ≤ puntos de su alianza.
- La página nunca escribe las tablas directo (solo funciones) y no puede leer los tokens.

El simulador corre en el navegador de cada quien, así que un tramposo decidido todavía podría
inventar un match *creíble*; los límites evitan los puntajes absurdos y el spam.

## Moderación

**Table Editor → players**: `banned = true` lo saca del ranking y ya no puede mandar matches;
borrar la fila borra también sus matches. **Table Editor → matches** tiene cada match recibido.

## Probarlo en local

- `npm run test:sql` corre `tests/sql/ranking.test.sql` en un Postgres desechable (necesita
  PostgreSQL instalado): validaciones, rating, permisos y borrado.
- `node scripts/scenarios/ranking.mjs` juega un match en el navegador contra ese mismo SQL.
