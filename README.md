# REBUILT Sim — simulador 3D de FRC 2026 REBUILT (fan project)

> **Simulador no oficial hecho por fans. No está afiliado a FIRST®.** No usa logos, arte ni audio
> oficiales. Los nombres de los elementos del juego (HUB, FUEL, TOWER…) se usan como referencia.

Simulador web de **FRC 2026 REBUILT presented by Haas** con reglas del Game Manual (TU22),
física con Rapier (WASM) y gráficos con Three.js. Funciona en **celular, tablet y computadora**,
con **pantalla táctil, teclado/mouse y control** (Xbox, PlayStation, genéricos), se instala como
**app (PWA)** y funciona **sin conexión**.

## Qué incluye

- **Campo a escala real** (16.54 × 8.07 m) con HUB, BUMPS, TRENCHES, DEPOT, TOWER, OUTPOST
  (CHUTE y CORRAL), DRIVER STATIONS y los 32 AprilTags 36h11 reales en las posiciones del
  layout oficial de WPILib.
- **504 FUEL** (o 600) con física: arrastre, efecto Magnus, rodadura, salidas aleatorias del HUB.
  El FUEL no atraviesa las paredes aunque un robot lo aprisione, y el que sale del campo lo
  regresa FIELD STAFF por donde salió (G405).
- **Match completo**: AUTO 0:20, 3 s de evaluación, TRANSITION, SHIFT 1–4 y END GAME con las
  luces del HUB (activo, aviso de 3 s, persecución blanca), gracia de 3 s, puntos y Ranking Points.
- **Robots**: swerve o tank, intake, hopper, shooter fijo o turret con auto-aim balístico y
  disparo en movimiento, pase, climb L1–L3. Editor para diseñar robots propios.
- **Árbitro automático**: G403, G404, G405, G407, G408, G413, G414, G415/416/417, G418 (PIN con
  contador visible), G419, G420 (+LEVEL 3), G427 y tarjetas (YELLOW + YELLOW = RED).
- **HUMAN PLAYER**: CHUTE DOOR, CORRAL → CHUTE y lanzamientos por encima de la ALLIANCE WALL.
- **Modos**: práctica libre, match 3 vs 3 contra IA (Fácil → Einstein), multijugador local 2–4
  (pantalla dividida o cámara compartida), torneo rápido (Qualifications, rankings, alianzas y
  Playoffs), espectador IA vs IA, diseñador de AUTO y editor de robots.
- **Robots reales de 2026 con su CAD**: 1678 Limestone, 5000 Icarus, 604 Toploader, 6328 Darwin,
  971 Mixtape, 341 Miss Daisy, 190 Doomspiral y 4915 Artemis, con el modelo 3D que cada equipo
  publicó en su repositorio de código (simplificado para la web) **y sus mecanismos funcionando
  como en el código del equipo**: la intake se despliega, el hopper se extiende, la turret y el
  hood apuntan, el spindexer gira y el climber sube; se ve el FUEL dentro del hopper. Medidas,
  extensión de la intake y dirección del shooter (1678 y 6328 tiran hacia atrás, 190 de lado)
  tomadas del CAD y del código. Galería para elegirlos desde el menú (con una demostración de
  sus mecanismos); la IA también los usa. La intake y el hopper desplegados chocan con el campo
  y los otros robots, y los dumpers (1678, 6328) sueltan ráfagas de 1 a 4 FUEL al azar a lo
  ancho del shooter.
- **6 cámaras**: tercera persona (como en MoSim: detrás del robot, siempre mirando al campo
  contrario, no gira con el robot), DRIVER STATION, desde el robot (POV, sin el robot propio
  tapando la vista), superior,
  transmisión y libre (práctica). La rueda del mouse acerca/aleja la tercera persona.
- **Guía de tiro**: la trayectoria del siguiente FUEL en puntos (verde = entra al HUB activo,
  amarillo = HUB inactivo, blanco = no entra). Se apaga en Ajustes.
- **HUD estilo transmisión** que escala con la pantalla (no se corta en laptops con zoom ni en
  celulares): marcador con el estado de cada HUB y el progreso a ENERGIZED/SUPERCHARGED, avance
  del periodo, panel del robot con el hopper. **Menú de pausa** con marcador, ajustes rápidos
  (auto-aim, disparo en movimiento, guía de tiro, field-relative, volumen), cámara y controles;
  se navega con control.
- **Calidad** Baja / Media / Alta / Ultra / Auto (mide los FPS y se ajusta sola).
- Español (México) e inglés; modo daltonismo; volumen separado de música, efectos y voces.

## Cómo correrlo

Requisitos: [Node.js](https://nodejs.org) 20 o superior.

```bash
npm install
npm run dev        # http://localhost:5173 (también accesible desde tu red local)
```

Otros comandos:

| Comando | Qué hace |
|---|---|
| `npm test` | Pruebas unitarias (reglas, puntuación, balística, física, torneo) |
| `npm run build` | Revisa tipos y genera el sitio estático en `dist/` (con service worker) |
| `npm run preview` | Sirve `dist/` para probar el build |
| `npm run e2e` | Escenarios en navegador real con Playwright (requiere `npm run build`) |
| `npm run shots` | Capturas de escritorio y celular en `shots/` con FPS y errores de consola |

Para probar en tu celular: `npm run dev`, abre en el teléfono la dirección "Network" que muestra
Vite (misma red Wi-Fi). Para instalarla como app necesitas HTTPS (por ejemplo, GitHub Pages).

Parámetros útiles en la URL: `?mode=match`, `?mode=practice`, `?mode=match&spectate=1`,
`?cam=broadcast`, `?quality=low|medium|high|ultra`, `?fps=1`.

## Publicar gratis en GitHub Pages (paso a paso)

El proyecto ya trae el workflow `.github/workflows/deploy.yml`, que compila y publica en cada
push a `main`. El build usa rutas relativas, así que funciona en `https://usuario.github.io/<repo>/`
sin configurar nada.

1. Crea un repositorio vacío en GitHub (por ejemplo `rebuilt-sim`).
2. En esta carpeta:
   ```bash
   git remote add origin https://github.com/<tu-usuario>/rebuilt-sim.git
   git push -u origin main
   ```
3. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Espera a que termine la acción "Deploy to GitHub Pages" (pestaña **Actions**). Tu simulador
   queda en `https://<tu-usuario>.github.io/rebuilt-sim/`.

Con [GitHub CLI](https://cli.github.com): `gh repo create rebuilt-sim --public --source . --push`
y luego el paso 3. También funciona en Netlify o Vercel: comando `npm run build`, carpeta `dist`.

## Controles

Los tres tipos de control funcionan al mismo tiempo; el HUD se adapta al último usado.
Todo se puede reasignar en **Ajustes → Controles**.

| Acción | Teclado / mouse | Control (Xbox / PlayStation) | Táctil |
|---|---|---|---|
| Moverse | W A S D | Stick izquierdo | Joystick flotante izquierdo |
| Girar | Q / E o ← → | Stick derecho | Joystick flotante derecho |
| Modo lento | Shift | LB / L1 | — |
| Disparar | Espacio o clic izquierdo | RT / R2 | Botón **Disparar** |
| Intake (encender/apagar) | F o clic derecho | LT / L2 | Botón **Intake** |
| Pasar / CORRAL | G | RB / R1 | Botón **Pasar** |
| Climb subir / bajar | R / V | A / B (✕ / ○) | Botón **Climb** |
| Reset de giroscopio | Z | Y / △ | — |
| Field / robot-relative | X | View / Create | — |
| Cambiar cámara | C o botón 📷 arriba a la derecha | X / □ | Botón **Cámara** |
| Pausa | Esc o P | Menu / Options | Botón ❚❚ |
| HUMAN PLAYER: CHUTE DOOR / lanzar | O / H | ↑ / ↓ | Botones **CHUTE** / **Lanzar** |
| Mostrar FPS | F3 | — | Ajustes |

- En AUTO tu robot ejecuta la rutina elegida (diséñala en **Diseñador de AUTO**); no recibe mandos.
- Manejo field-relative por defecto: "arriba" es hacia el lado contrario del campo visto desde
  tu DRIVER STATION. Con la cámara de transmisión o la superior, "arriba" es arriba de la pantalla.
  Con la cámara desde el robot, "arriba" es hacia donde mira el robot.
- Opción de apuntar con el mouse en Ajustes. El control vibra al chocar, al anotar y en los SHIFTS.
- Táctil: los joysticks aparecen donde pones el dedo; en Ajustes puedes cambiar tamaño, opacidad
  y posición de los botones ("Editar layout táctil").

## Arquitectura

```
src/
  core/      lógica pura (reloj, HUBS, puntuación, TOWER, RP, faltas, torneo) — con pruebas
  config/    medidas del campo en metros (pulgadas en comentarios), robots, ajustes
  physics/   Rapier: colisionadores, FUEL, robots, balística
  render/    Three.js: campo, robots, FUEL, cámaras, efectos, estadio, calidad
  input/     acciones abstractas: teclado/mouse, gamepad, táctil
  game/      sesión de juego, mecanismos, climb, HUMAN PLAYER, resultados
  ai/        IA de robots y navegación
  auto/      rutinas de AUTO y su ejecutor
  referee/   árbitro automático
  audio/     sonidos sintetizados (Web Audio) y voces
  ui/        HUD, menús, ajustes, resultados, diseñador de AUTO, editor de robots, torneo
```

Detalles, decisiones técnicas y supuestos (donde el manual o los planos no alcanzan para simular):
[`docs/PLAN.md`](docs/PLAN.md). Las medidas aproximadas están marcadas en el código con
`// TODO: verificar con CAD oficial`.

## Rendimiento

Medido con Playwright: 60 FPS en una laptop con gráficos integrados (Alta/Ultra) y 30–50 FPS en
calidad Media emulando un celular de gama media (CPU 4× más lenta). La física corre a paso fijo
(120 Hz en Alta, 60 Hz en Media/Baja), el FUEL en reposo se duerme pronto, el FUEL guardado es un
contador lógico y los 504 FUEL se dibujan en una sola malla instanciada.

## Créditos

- Juego: FRC 2026 REBUILT presented by Haas, de *FIRST*®. Este proyecto no está afiliado a FIRST.
- [Three.js](https://threejs.org) (MIT) · [Rapier](https://rapier.rs) (Apache-2.0) ·
  [Vite](https://vitejs.dev) (MIT).
- Códigos de AprilTag 36h11: [AprilRobotics/apriltag](https://github.com/AprilRobotics/apriltag) (BSD-2).
- Posiciones de AprilTags: layout "2026-rebuilt-welded" de [WPILib](https://github.com/wpilibsuite/allwpilib) (BSD).
- Todo el audio es sintetizado en el navegador; todas las texturas se generan con código.
- Modelos 3D de robots: publicados por los equipos 1678, 5000, 604, 6328, 971, 341, 190 y 4915
  en sus repositorios de código (licencias MIT / BSD; detalle y textos en
  [public/robots/LICENSES.md](public/robots/LICENSES.md)). Datos de rendimiento:
  [Statbotics](https://www.statbotics.io) y el
  [FRC 2026 REBUILT Robot Study Dashboard](https://dmeglan.github.io/frc2026-rebuilt-dashboard/).
  Para regenerarlos: `node scripts/robots/fetch-sources.mjs <dir>` y
  `node scripts/robots/build-models.mjs <dir>` (`BUDGET=` triángulos por robot, 140k por omisión).
