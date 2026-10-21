# PLAN — REBUILT Sim

## Objetivo
Simulador 3D web (estático, PWA) de FRC 2026 REBUILT: reglas TU22 completas, física creíble,
jugable con táctil, teclado/mouse y gamepad en celular, tablet y PC.

## Fases (estado)
- [x] Fase 0 — arranque: repo, Vite+TS, CLAUDE.md, este plan
- [x] Fase 1 — campo a escala, FUEL con física, robot swerve manejable (teclado/gamepad/táctil), cámaras piloto y seguimiento
- [x] Fase 2 — reloj, SHIFTS, luces/estado de HUBS, conteo y salidas del HUB, puntuación, HUD, sonidos
- [x] Fase 3 — intake, hopper, shooter balístico, pase, CORRAL/CHUTE/DEPOT, HUMAN PLAYER
- [x] Fase 4 — TOWER y climb, árbitro (sección 6 del prompt), RP, resultados
- [x] Fase 5 — IA (5 robots + HP), modos de juego, diseñador de AUTO, editor de robots
- [x] Fase 6 — pulido gráfico, presets de calidad, PWA/offline, móvil, README
- [x] Fase 7 — publicado en https://xhavisito.github.io/rebuilt-sim/ (repo github.com/xhavisito/rebuilt-sim) — GitHub Actions → GitHub Pages

(Se actualiza al cerrar cada fase. Al retomar: leer esto, `git log`, y la lista de tareas.)

## Árbol de archivos
```
index.html                 shell + pantalla de carga
vite.config.ts             base relativa, plugin que genera sw.js (precache)
public/                    manifest.webmanifest, íconos
src/
  main.ts                  arranque: carga Rapier, crea App
  app/App.ts               orquestador: menú ↔ sesión, bucle principal, ajustes
  game/GameSession.ts      una sesión (práctica/match): física+core+render+IA+árbitro
  game/Robot.ts            robot = spec + cuerpo físico + vista + controlador
  game/HumanPlayer.ts      HUMAN PLAYER (OUTPOST: CHUTE, CORRAL, lanzamiento)
  game/StartPositions.ts   posiciones de salida legales (G303)
  config/field.ts          medidas del campo (m; pulgadas en comentario)
  config/robots.ts         RobotSpec, presets, validación R104/R105/R107
  config/settings.ts       ajustes persistentes (localStorage)
  core/                    lógica pura + pruebas (tests/)
    types.ts  clock.ts  hub.ts  scoring.ts  tower.ts  fouls.ts  rp.ts  rankings.ts  rng.ts  events.ts
  physics/
    PhysicsWorld.ts        init Rapier, grupos de colisión, paso fijo
    FieldColliders.ts      colisionadores estáticos del campo
    FuelSystem.ts          pool de 504/600 FUEL, arrastre/Magnus, HUB, CORRAL, fuera de campo
    RobotPhysics.ts        manejo swerve/tank limitado por tracción, intake, shooter, climb
    ballistics.ts          solver balístico puro (con arrastre), testeable
  render/
    Renderer.ts            WebGLRenderer + composer (bloom/AO/AA) + presets de calidad
    FieldView.ts           geometría visual del campo
    textures.ts            texturas procedurales (alfombra, HDPE, diamond plate)
    apriltag.ts            texturas 36h11 reales (códigos de AprilRobotics)
    RobotView.ts           robot visual desde RobotSpec (procedural o CAD real articulado)
    cadRigs.ts             poses de los componentes de cada CAD real (del código de cada equipo)
    FuelView.ts            InstancedMesh de FUEL
    Effects.ts             partículas, estelas, chispas, temblor de cámara
    Stadium.ts             gradas, público instanciado, focos, pantalla
    CameraRig.ts           piloto / seguimiento / superior / TV / libre
  input/                   actions.ts, InputManager.ts, keyboard, gamepad, TouchControls.ts
  ai/                      RobotAI.ts, HumanPlayerAI.ts, NavGraph.ts
  auto/                    AutoRoutine.ts (tipos + ejecutor), rutinas default
  referee/Referee.ts       detección de violaciones
  audio/Audio.ts           Web Audio: cues del FMS, efectos, música, voz (SpeechSynthesis)
  ui/                      i18n.ts, styles.css, Menu, Hud, Results, Settings, AutoDesigner, RobotEditor, Tournament
  pwa/                     registro del SW y plantilla sw-template.js
tests/                     Vitest
scripts/screenshot.mjs     verificación con Playwright
```

## Decisiones técnicas
- **WebGL2 (WebGLRenderer) en lugar de WebGPURenderer**: WebGPU exige materiales de nodos (TSL)
  y otro pipeline de post-proceso; en Safari/iOS y Android de gama media su soporte aún es irregular.
  WebGL2 funciona en todos los navegadores objetivo con EffectComposer (bloom, GTAO, SMAA).
- **Rapier3D compat (WASM embebido en base64)**: no hay que servir un `.wasm` aparte → offline
  trivial y sin problemas de MIME en GitHub Pages.
- **UI en DOM sin framework**: menos peso, inicio rápido; HUD con CSS.
- **Pool de FUEL**: cuerpos creados una sola vez; los FUEL guardados se deshabilitan
  (`setEnabled(false)`) y su instancia se oculta. Arrastre aerodinámico solo para cuerpos activos rápidos.
- **Robot**: cuerpo dinámico con 4 esferas-rueda sin fricción + caja de chasis + caja de BUMPERS.
  La tracción se modela con un controlador de velocidad cuyo impulso horizontal por paso está
  limitado por `μ·m·g·dt` (y por la aceleración del motor). Así los empujones los gana la masa
  y la tracción, y las rampas de 15° del BUMP inclinan el robot de forma natural.
- **Climb**: animación cinemática con tiempos por diseño; criterios de LEVEL evaluados con la
  geometría real (BUMPERS sobre el LOW/MID RUNG).
- **Paso fijo** 120 Hz (Alto/Ultra) o 60 Hz (Bajo/Medio en móvil) con interpolación.
- **Base de Vite relativa** (`./`): el mismo build sirve en cualquier subruta de GitHub Pages.
- **PWA propia**: plugin de Vite de ~30 líneas genera `sw.js` con precache de todo el build.

## Sistema de coordenadas y layout del campo
Fuente: Game Manual TU22 §5 + layout oficial WPILib `2026-rebuilt-welded` (AprilTags) +
imagen superior del campo de WPILib (`fields/.../2026-rebuilt.png`).

- Campo 651.2 × 317.7 in (16.541 × 8.069 m). Origen en el centro; azul en −X.
  Conversión desde WPILib (pulgadas, origen en la esquina azul): `X = x − 325.6`, `Z = −(y − 158.85)`.
- HUB azul: centro (182.11, 158.84) in → X = −3.645 m (caras en 158.34 y 205.87 según tags).
- BUMPS: 44.4 in de fondo (centrados en x = 182.11), 73 in de ancho, pegados al HUB en y.
- TRENCH: brazo delgado (≈6 in) centrado en x = 182.11, bajo-brazo 22.25 in, hueco de 50.34 in
  desde el barandal; poste de 47 in de fondo entre hueco y BUMP.
- ROBOT STARTING LINE: borde de la ALLIANCE ZONE en x = 158.6 in (cinta de 2 in hacia la pared).
- TOWER azul: centrada en y = 147.47 in (tag 31 centrado), base 39 × 45.18 in desde la pared;
  UPRIGHTS cerca del borde frontal de la base (x ≈ 42 in). // supuesto, ver TODO en field.ts
- OUTPOST azul: esquina y ≈ 0–53 in; CHUTE y CORRAL centrados en y = 26.22 in (tag 29).
- DRIVER STATIONS azul: DS3 y ≈ 53–122 in, TOWER 122.8–172.1, DS2 ≈ 175–242, DS1 ≈ 245–317.7.
- DEPOT azul: x 0–27 in, y ≈ 213–255 in (lado de DS1/DS2, opuesto al OUTPOST).
- Rojo = rotación 180° de todo lo anterior.

## Supuestos (donde el manual es ambiguo para simular)
1. **Forma del HUB** (medida sobre las figs. 5-5 y 5-7): cuerpo negro hasta ~50.5 in, tapa
   biselada gris hasta ~59 in, placa de color de alianza y embudo hexagonal translúcido de
   ~24 in (fondo) a 41.7 in (arriba, a 72 in). Red ahumada inclinada hacia la NEUTRAL ZONE
   con la punta a ~120 in. // TODO CAD
2. **Abertura del HUB**: hexágono de 41.7 in **entre caras planas** (así lo acota la vista
   superior de la fig. 5-7; los vértices llegan al borde de la caja), borde a 72 in; el FUEL
   se cuenta al cruzar ~0.3 m bajo el borde, al fondo del embudo ("sensor array" §6.5.1).
3. **Salidas del HUB**: 4 aberturas a ~0.15 m de altura en la cara hacia la NEUTRAL ZONE,
   retardo de procesamiento 0.6–1.4 s, velocidad de salida 2.0–3.4 m/s.
4. **Gracia de 3 s** (§6.5): un FUEL que entra al HUB dentro de los 3 s posteriores a su
   desactivación cuenta como si estuviera activo. El FUEL de AUTO cuenta hasta 3 s tras 0:00;
   durante esos 3 s los robots están deshabilitados (pausa entre AUTO y TELEOP).
5. **Luces**: en TRANSITION, el HUB que será inactivo en SHIFT 1 muestra persecución blanca;
   3 s antes de cada desactivación (y del final) pulsa.
6. **CORRAL**: capacidad lógica 36 FUEL; CHUTE 25. G427 se evalúa cuando ambos están llenos y el
   HUMAN PLAYER tiene > 2 FUEL en la mano.
7. **Masa del robot**: ≤ 52.16 kg (R103) + BUMPERS ≈ 6.8 kg + batería ≈ 5.9 kg ≈ 65 kg máximo.
8. **Coeficientes**: FUEL (espuma) restitución 0.55 y alfombra 0.45 (promedio ≈ 0.5: rebota
   ~25 % de la altura), rodado sobre alfombra −1.0 m/s², Cd = 0.47, ρ = 1.2 kg/m³; Magnus
   suave (coef. 0.5·S). Salida del HUB a 2.0–3.4 m/s (llega hasta ~5 m, fig. 5-8). Tracción
   μ ≈ 1.0–1.3 según diseño.
9. **Árbitro heurístico** (las reglas son "como las percibe un REFEREE"): se documenta cada
   umbral en `src/referee/Referee.ts` (p. ej. embestida = velocidad de cierre > 3 m/s con
   extensión dentro del perímetro rival).
10. **G410 y G412** no son alcanzables por diseño: ninguna extensión del robot simulado puede
    levantar los BUMPERS (la intake no colisiona con la alfombra) y el climber solo engancha
    RUNGS/UPRIGHTS. Se documentan; el árbitro no los cobra.
11. **Tarjetas** (G211): PIN > 15 s, ≥ 5 FUEL sacados del campo, ≥ 3 ráfagas de G407.
12. **Umbral del CORRAL**: una cuña de 0.12 m (solo colisiona con FUEL) frente al umbral de 1.88 in
    permite que el FUEL empujado entre al CORRAL (en la realidad la espuma se comprime). // TODO CAD
13. **Robot contra FUEL**: las ruedas no colisionan con el FUEL; lo empuja la cara vertical de los
    BUMPERS, que un "faldón" (solo FUEL) baja hasta 0.5 in del piso, y el robot domina al FUEL
    (grupo de dominancia de Rapier: 0.2 kg de espuma no levantan a un robot de 55 kg). Así el
    robot no se trepa al FUEL ni lo hunde en la alfombra. Con un montón denso el solver no
    alcanza a sacar todas las pelotas a tiempo (el robot "se deslizaba" a través de ellas), así
    que después de cada paso `shoveFuel` saca por el lado más cercano cualquier FUEL que haya
    quedado dentro de la huella (o del rodillo de la intake desplegada) con la velocidad del
    robot. La intake desplegada tiene su propio colisionador (solo FUEL) y captura lo que toca.
14. **Robots reales** (`CAD_ROBOTS` en `src/config/robots.ts`): 1678, 5000, 604, 6328, 971,
    341, 190, 4915 y 3478, con el modelo 3D que cada equipo publicó en su repo de código (asset de
    AdvantageScope; licencias en `public/robots/LICENSES.md`), simplificado con
    `scripts/robots/` (fetch-sources → build-models): sin tornillería ni BUMPERS propios, error
    de simplificación ajustado a ~140k triángulos, materiales PBR según el color del CAD y
    normales con pliegue calculadas al cargar (el GLB va sin normales: pesa un tercio).
    **Articulados como en AdvantageScope**: el GLB conserva `main` y cada componente `cN` con
    su transformación "zeroed"; `src/render/cadRigs.ts` calcula la pose de cada componente con
    las fórmulas y constantes del código de cada equipo (intake, extensión del hopper, cuatro
    barras de 190, turret, hood, spindexer, climber). 4915 no publica poses: sus pivotes se
    dedujeron del CAD. 3478 (LamBot) mandó su CAD de SolidWorks exportado a .glb (fuente `local`
    en sources.mjs; config.json a mano en scripts/robots/local/: Y arriba → Z arriba); sus partes
    móviles se separan por nombre de subensamble (`parts`) y el rig se dedujo del CAD. 971 se gira 180° y 5000 −90° para que la intake quede al frente del
    simulador (5000 tiene dos intakes laterales: solo despliega la del frente). 604 no publicó
    el rodillo de su intake: se dibuja un cilindro entre los brazos. Chasis, altura, extensión
    y ancho de la intake medidos sobre el CAD armado; los shooters fijos tiran hacia donde dice
    el código (1678 y 6328 hacia atrás, 190 hacia la derecha) desde su posición en el robot.
    El hopper de 971 sobresale 11 in al frente sobre los BUMPERS (colisionador incluido).
    Rendimiento de sus tech binders / Robot Study Dashboard (estimado si no se publicó).
15. **FUEL contra el perímetro**: el barandal (3 cm) y la ALLIANCE WALL tienen un respaldo
    invisible de 0.3–0.6 m (fuera de las aberturas del CORRAL y de la CHUTE), `shoveFuel` nunca
    saca un FUEL hacia afuera del campo (se escurre a lo largo de la pared) y un FUEL metido en
    la pared por debajo de su borde superior regresa a la cara interior. Antes un robot que
    aprisionaba FUEL contra la pared lo sacaba del campo y le marcaban G405.
16. **FUEL que sale del campo** (G405, nota): FIELD STAFF lo regresa "aproximadamente por donde
    salió": 2–4 s después rueda despacio desde 0.3 m dentro de la pared (se corre si hay un
    robot encima). G405 solo se cobra si el robot lo sacó a propósito: lo lanzó y salió todavía
    en vuelo.

## Rendimiento medido (Fase 6)
- Escritorio (Intel Arc integrado, Alta/Ultra): 60 FPS, ~3–9 ms de simulación con 6 robots.
- Celular emulado (CPU 4×, 844×390 @2×, Media): 30–50 FPS típicos; caídas breves a ~25 cuando
  cientos de FUEL se mueven a la vez. La calidad Auto baja de nivel si el promedio < 42 FPS.
- Claves: draw calls 596 → ~225 (Media), FUEL dormido tras 0.4 s quieto, margen predictivo de
  Rapier 5 mm, 2 iteraciones de solver en Baja/Media, memo del solver balístico.
