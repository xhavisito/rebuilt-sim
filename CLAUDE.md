# REBUILT Sim — contexto para Claude Code

Simulador 3D web **no oficial** (fan project) de FRC 2026 *REBUILT presented by Haas*.
Sin logos ni audio/arte oficial. Nombres de elementos (HUB, FUEL, TOWER…) sí.
UI en español (México) por defecto + inglés; términos del juego siempre en inglés.

- Reglas: `docs/2026GameManual.pdf` (TU22, local, no versionado). Extraer con
  `pdftotext -layout docs/2026GameManual.pdf docs/manual.txt` y buscar con grep.
  No inventar reglas: citar número de regla/sección en comentarios.
- Plan, árbol de archivos, decisiones y supuestos: `docs/PLAN.md` (léelo al retomar).

## Comandos
- `npm run dev` — servidor de desarrollo (Vite, http://localhost:5173)
- `npm test` — pruebas unitarias (Vitest) de `src/core`, `src/physics/ballistics`
- `npm run build` — `tsc --noEmit` + build estático en `dist/` (incluye `sw.js`)
- `npm run preview` — sirve `dist/`
- `npm run shots` — capturas Playwright (escritorio 1920×1080 + móvil 844×390 táctil)
  en `shots/`, más errores de consola y FPS. Requiere `npm run build` antes.
- Node está instalado en `~/.local/bin` (v24); si `node` no aparece, agrega
  `~/.local/bin` al PATH.

## Arquitectura (src/)
- `core/` lógica pura SIN Three.js ni Rapier: reloj/periodos/SHIFTS, estado de HUBS,
  puntuación, TOWER, faltas, RP, rankings, RNG. Todo con pruebas en `tests/`.
- `config/` medidas del campo (metros, con pulgadas en comentarios), presets de robots, ajustes.
- `physics/` mundo Rapier (WASM), colisionadores del campo, FUEL (pool), robots, balística.
- `render/` escena Three.js (WebGL2), materiales, luces, cámaras, efectos, calidad.
- `input/` acciones abstractas; teclado/mouse, gamepad, táctil; reasignables.
- `ai/` robots y HUMAN PLAYERS de la computadora; navegación por grafo.
- `referee/` árbitro automático (faltas G4xx, tarjetas).
- `audio/` sonidos sintetizados con Web Audio (sin archivos).
- `ui/` DOM: menús, HUD, resultados, ajustes, diseñador de AUTO, editor de robot.
- `game/` sesión de juego: une física + core + render + IA + árbitro.

## Convenciones
- Unidades internas: metros, kg, segundos. `inch(x)` convierte; deja la medida original en comentario.
- Sistema de coordenadas: origen en el centro del campo, Y arriba. +X hacia la ALLIANCE WALL roja,
  la alianza azul está en −X. `Z = −y_WPILib` (diestro). El campo es simétrico por rotación de 180°
  (x,z) → (−x,−z) entre alianzas.
- Física a paso fijo (120 Hz por defecto) con interpolación al render.
- FUEL guardado (hopper, CHUTE, CORRAL, interior del HUB) = contador lógico; el cuerpo
  Rapier se deshabilita y se reutiliza (pool fijo, sin crear/destruir cuerpos).
- Textos de UI siempre vía `t('clave')` (`src/ui/i18n.ts`).
- Versiones exactas en package.json. Sin dependencias pesadas.
- Commits por fase: `feat(fase-N): …`.

## Reglas clave (TU22)
| Periodo | Duración | Timer | HUBS |
|---|---|---|---|
| AUTO | 20 s | 0:20→0:00 | ambos activos |
| (gracia post-AUTO) | 3 s | — | FUEL aún cuenta como AUTO |
| TRANSITION SHIFT | 10 s | 2:20→2:10 | ambos activos |
| SHIFT 1–4 | 25 s c/u | 2:10→1:45→1:20→0:55→0:30 | alternan; quien anotó MÁS FUEL en AUTO queda inactivo en SHIFT 1 (empate → aleatorio) |
| END GAME | 30 s | 0:30→0:00 | ambos activos |

- FUEL cuenta hasta 3 s después de que el HUB se desactiva y 3 s después del final.
- Puntos: FUEL en HUB activo 1 (AUTO y TELEOP); TOWER L1 = 15 en AUTO (máx. 2 robots/alianza),
  TELEOP L1/L2/L3 = 10/20/30 (un nivel por robot).
- RP: ganar 3, empate 1; ENERGIZED/SUPERCHARGED (FUEL en HUB activo) y TRAVERSAL (puntos TOWER):
  Regional/District 100/360/50 · District Champ 240/360/50 · FIRST Champ 360/500/50.
- Faltas: MINOR = 5, MAJOR = 15 puntos para el OPONENTE. YELLOW + YELLOW = RED (DISQUALIFIED).
- MOMENTARY < ~3 s; CONTINUOUS > ~10 s; REPEATED = más de una vez en el match.
