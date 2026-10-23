# Galería de robots de la comunidad

Cualquiera publica su robot (ficha + CAD) desde el taller y le aparece a todos en
**Taller → 🌐 Comunidad**. En línea, cuando un jugador usa un robot de la galería, los demás
descargan su CAD automáticamente. GitHub Pages solo sirve archivos fijos, así que los robots se
guardan en un proyecto **gratuito de Supabase** (base de datos + almacenamiento). No hace falta
servidor propio.

Plan gratuito: 500 MB de base de datos y 1 GB de archivos (unos 100–300 robots con CAD, según el
peso), archivos de hasta 50 MB. Supabase pausa los proyectos gratuitos sin actividad por una
semana; se reactivan con un clic en el panel.

## Activarla (una vez, ~5 minutos)

1. Crea una cuenta en https://supabase.com y un proyecto nuevo (cualquier nombre y región).
2. **SQL Editor → New query**: pega todo [`comunidad.sql`](comunidad.sql) y dale **Run**.
3. **Project Settings → API** (o **Data API**): copia la **Project URL** y la llave **anon / public**.
   La llave anon es pública por diseño: lo que puede hacer lo limitan los permisos del SQL. La
   llave `service_role` **nunca** va en la página.
4. En GitHub: **Settings → Secrets and variables → Actions → Variables → New repository variable**:
   - `SUPABASE_URL` = la Project URL
   - `SUPABASE_ANON_KEY` = la llave anon
5. Vuelve a publicar la página (cualquier push a `main`, o **Actions → Deploy to GitHub Pages →
   Run workflow**). El build las pasa como `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

En local: crea `.env.local` con esas dos variables `VITE_…` y corre `npm run dev`.

## Moderación

- Cada robot se puede **reportar**; con 3 reportes deja de listarse.
- En el panel de Supabase: **Table Editor → robots** para borrar filas o poner `reports` en 0
  (vuelve a aparecer), y **Storage → robots** para borrar los GLB.
- Quien publica puede borrar su robot desde el mismo navegador (token guardado al publicar).

## Qué se guarda

Tabla `robots`: nombre, número de equipo, nombre de piloto (opcional), la ficha (JSON validado
al leer, como un archivo importado) y la ruta del GLB en el bucket público `robots`. No se
guardan correos ni cuentas.
