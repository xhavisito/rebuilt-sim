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
  game/StartPositions.ts   posiciones de salida (sin validar G303, a pedido)
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
  auto/                    AutoRoutine.ts (tipos, rutinas default), AutoExecutor.ts, Trajectory.ts (rutas suaves)
  referee/Referee.ts       detección de violaciones
  audio/Audio.ts           Web Audio: cues del FMS, efectos, música, voz (SpeechSynthesis)
  ui/                      i18n.ts, styles.css, Menu, Hud, Results, Settings, AutoDesigner, RobotEditor, Tournament,
                           SpectatorBar (cámaras, robot a seguir, línea de tiempo y clips)
  net/                     modo en línea (host autoritativo, clientes y espectadores, WebRTC)
  replay/
    Recording.ts           grabación (snapshots de net/protocol + cuadros clave), archivo .rbreplay, clips, momentos
    ReplayPlayer.ts        SessionTap (graba la sesión) y ReplayPlayer (SessionReplica que la reproduce)
    store.ts               IndexedDB: últimas 8 + las conservadas
    VideoExport.ts         clip a MP4/WebM con marcador (MediaRecorder)
  game/Director.ts         director de cámaras del espectador (lógica pura)
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
- **IA en capas**: `RobotAI` (estados y criterio propio: llenarse antes del active, cargas grandes
  por viaje, tácticas en los SHIFTS inactivos) ← `AllianceBrain` (scouting y roles por momento) ←
  `Strategy` (plan de la alianza) ← `DriveCoach` (órdenes en el match). `AiMemory` aprende por
  prueba y error (UCB1 por diseño de robot y situación, peligros del campo, ritmo real) y lo guarda
  en localStorage; arranca de `src/ai/playbook.json`, generado con matches de entrenamiento
  (`?train=1`, matches de solo IA; la memoria exportada se resume por robot y en `*`).
- **Dificultad de la IA** (`ai/difficulty.ts`): además de velocidad, reacción y puntería, cada
  nivel define cómo defiende (`ai/Defense.ts`: a quién marca, anticipación, esperar en el
  BUMP/TRENCH por el que cruza el rival, margen de PIN G418, velocidad de contacto para no
  embestir G416, dejar la defensa a tiempo) y si esquiva defensores al tirar. Fácil no aprende,
  no reparte roles y no defiende por su cuenta. Se puede fijar por alianza (`?difficultyRed=`,
  `?difficultyBlue=`); `npm run ai-bench` compara niveles con los mismos robots en las dos
  alianzas (`?mirror=1`).
- **AUTO a prueba de choques**: el navegador detecta falta de progreso (mínimo local atracción /
  repulsión), el ejecutor tiene vigilante por waypoint y, al terminar, juego libre sin cruzar la
  CENTER LINE (pared virtual, G403).
- **Autónomo programable tipo PathPlanner** (`auto/Trajectory.ts`, puro): rutas suaves con Bézier
  cúbicas por tramo (manijas automáticas Catmull-Rom al pasar y en esquina en las paradas, o las
  del usuario), rumbo holonómico por waypoint y perfil de velocidad (vel. máx., aceleración y
  aceleración lateral por tracción, giro máximo, más lento sobre el BUMP). El robot se detiene solo
  en waypoints con acción o "detenerse"; los demás son de paso (sus cambios de INTAKE son "event
  markers"). En el match cada tramo se genera desde la pose real del robot y se sigue con
  velocidad de referencia + corrección P; si se atrasa, la referencia espera. El diseñador usa el
  mismo perfil (vista previa con línea de tiempo, choques con HUB/TRENCH/pared/TOWER, G403) e
  importa/exporta JSON (`sanitizeRoutine`). Las rutinas viejas (punto a punto) siguen con el
  navegador.
- **Estratega del torneo** (`Strategist.ts`, puro): pros y contras, predicción, roles, AUTO sin
  choques, si conviene ganar el AUTO (ventana final de 55 s), END GAME / TRAVERSAL y RP. El
  dashboard aplica el plan como estrategia `coach-plan` (se rehace para cada match).
- **Estadísticas y ranking global sin servidor**: cada match terminado (no práctica ni
  entrenamiento) se acumula en localStorage (`rebuilt-sim.stats.v1`): por jugador, por robot que usó
  y por diseño de robot (todos los del campo). Rating Elo (inicio 1200; rival = IA por dificultad
  950/1150/1350/1550 o 1200 si es una persona; K 48 los primeros 10 matches, luego 24). El ranking
  global es un mensaje "retained" por jugador en `rebuilt-sim/v1/rank/<id>` del broker MQTT público
  (opcional, requiere nombre de piloto): informal, se puede falsear o borrar; todo se valida y acota.

- **Repeticiones = el modo en línea grabado**: se guarda lo mismo que el host manda a sus
  clientes (estado binario a 30 Hz con el FUEL en delta, estado lento en JSON cuando cambia,
  eventos de sonido/efectos) y se reproduce con el mismo `SnapshotApplier` del cliente. No se
  re-simula (Rapier no es determinista entre navegadores y la IA usa `Math.random`): así la
  repetición es exacta y saltar a cualquier punto cuesta a lo más 2 s de decodificación (cuadro
  clave cada 2 s). Se graba a paso fijo (`GameSession.onStep`), no por frame: no depende de los
  FPS. Un match completo pesa ~1–2 MB con gzip (`CompressionStream`).
- **Espectador en línea**: entra con `hello.spectate` (protocolo 2), no ocupa lugar de jugador
  (hasta 8) y puede entrar a medio match: el host le manda un cuadro con todo el FUEL antes de
  incluirlo en los envíos en delta.
- **Video de clips**: el canvas WebGL se copia cada frame a un canvas 2D (≤1280 px) con un
  marcador dibujado encima (el HUD es DOM) y MediaRecorder graba ese canvas más una copia de la
  mezcla de audio. MP4 donde el navegador lo graba (Chrome/Safari); si no, WebM.

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
   ~25 % de la altura), rodado sobre alfombra −1.0 m/s² (C_rr ≈ 0.1), Cd = 0.47,
   ρ = 1.2 kg/m³; Magnus suave (coef. 0.5·S). Fricción del FUEL 0.15 (Rapier promedia):
   FUEL–FUEL 0.15, FUEL–alfombra ≈ 0.48, FUEL–BUMPER ≈ 0.28. Con 0.7 entre pelotas, la que
   llegaba girando "aplastaba" contra la alfombra a la que golpeaba y esta apenas salía (se
   veían como piedras); ahora un choque de frente le pasa ~70 % de la velocidad, como entre dos
   pelotas de espuma de la misma masa. Salida del HUB a 2.0–3.4 m/s: rueda 2.5–6 m (fig. 5-8:
   hasta ~5 m). Tracción μ ≈ 1.0–1.3 según diseño.
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
    Empujar FUEL frena poco: −1 % de velocidad por FUEL pegado al BUMPER, a lo más −15 % (antes
    −40 %: 0.2 kg de espuma casi no frenan a un robot de 55 kg).
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
    La velocidad libre del drivetrain (`maxSpeed`) sale del código de cada equipo
    (`kSpeedAt12Volts` de TunerConstants o su equivalente, citado en robots.ts); 1757, 8214,
    9410, 2363 y 3478 no la publican y conservan la estimada. 3847 (Spectrum) y 1425 (Error Code
    Xero) se armaron con su simulación publicada (RobotSim / MapleSimUtil, Mechanism3d): carriles,
    cadencia, altura y posición del tiro, rango del hood y extensión de la intake. `clear` en
    sources.mjs dibuja translúcido el policarbonato que el CAD trae opaco (hopper de 3847).
15. **FUEL contra el perímetro**: el barandal (3 cm) y la ALLIANCE WALL tienen un respaldo
    invisible de 0.3–0.6 m (fuera de las aberturas del CORRAL y de la CHUTE), `shoveFuel` nunca
    saca un FUEL hacia afuera del campo (se escurre a lo largo de la pared) y un FUEL metido en
    la pared por debajo de su borde superior regresa a la cara interior. Antes un robot que
    aprisionaba FUEL contra la pared lo sacaba del campo y le marcaban G405.
16. **FUEL que sale del campo** (G405, nota): FIELD STAFF lo regresa "aproximadamente por donde
    salió": 2–4 s después rueda despacio desde 0.3 m dentro de la pared (se corre si hay un
    robot encima). G405 solo se cobra si el robot lo sacó a propósito: lo lanzó y salió todavía
    en vuelo.
17. **Dumpers**: un shooter de varios FUEL de ancho (`shooter.lanes`) no suelta filas
    perfectas: en cada ráfaga llegan al flywheel de 1 a `lanes` FUEL (al azar, los que alcance a
    empujar el indexer), en lugares al azar a lo ancho del shooter sin encimarse y escalonados
    hasta 70 ms; la siguiente ráfaga espera n / `rate` ± 25 % (la cadencia media sigue siendo
    `rate`). Dos turrets (971, `laneSpacingIn` 16.5 in): una, la otra o ambas. Del CAD: 1678 y
    6328 tienen hood/flywheel de lado a lado (4 de ancho); 190, 604, 341, 4915 y 5000 tiran de
    un solo chorro.
18. **FUEL visible en el hopper** (todos los robots con CAD): cajas (o un anillo alrededor del
    rotor de 5000) en el hueco real del hopper de cada CAD, montadas en el componente si este se
    mueve. Se llenan de abajo hacia arriba; si el hopper real guarda más FUEL del que cabe a la
    vista, lo dibujado es proporcional al llenado. Donde la intake guardada ocupa parte del
    hopper (1678, 6328, 190, 4915), el FUEL guardado la mantiene abierta lo necesario. En 604 (sin
    paredes en el CAD) el FUEL va sobre el chasis alrededor de la torre del serializer.
19. **Intake y hopper desplegados son sólidos** (R105: hasta 12 in fuera del perímetro): con la
    intake abajo, una caja de la altura de los BUMPERS a 10 in cubre la intake y otra el hopper
    que se extiende (1678 y 6328, `deployedHopperIn` medido en el CAD). Chocan con el campo
    (TRENCH, paredes, HUB, TOWER) y con los otros robots, pero no con la alfombra ni con las
    rampas del BUMP (grupo de colisión aparte: el robot real las libra) ni con el FUEL (eso lo
    hacen el rodillo y `shoveFuel`). El árbitro las cuenta como contacto del robot.
20. **TRENCH**: el brazo de 22.25 in se apoya en el barandal (§5.6); no hay poste que invada el
    paso de 50.34 in (antes había uno de 6 cm con el que se chocaba al pasar pegado al barandal).
21. **Robots de la IA**: solo robots reales (Fácil en orden fijo, las demás al azar). Una alianza
    de solo IA (fuera de Fácil) pone a defender, en sus SHIFTS inactivos, al robot con el hopper
    más chico. Los diseños propios se hacen en el editor (con una plantilla sin CAD).
22. **Cámara a bordo**: el robot propio no se dibuja en esa vista (la cámara quedaba dentro de su
    hopper y sus paredes de policarbonato tapaban todo).
23. **IA y la TOWER de AUTO**: un robot que quedó colgado en L1 al terminar AUTO (sus 15 puntos
    ya se evaluaron a las 0:00, §6.5-C) baja al empezar TELEOP, sigue jugando y vuelve a subir en
    END GAME. Si la IA misma decidió subir, no baja.
24. **IA atorada**: si quiere moverse y no avanza por 1 s, se aleja en la dirección contraria a lo
    que toca (normal de los contactos de BUMPERS, superestructura e intake con el campo y los
    robots), un poco de lado y sin girar (al girar, la intake desplegada vuelve a trabarse), y
    deja por 8 s la pelota que perseguía. No persigue FUEL pegado a las paredes (0.17 m del
    barandal, 0.3 m de la ALLIANCE WALL) ni a 1.05 m de su TOWER, cruza el TRENCH alineada con el
    campo y cruza el BUMP a ≤ 2.6 m/s.
25. **Robots que no se voltean**: el robot real tiene el centro de masa muy bajo y aterriza plano;
    la caja simulada podía caer de lado al pasar el BUMP girando o al chocar. Más allá de 20° de
    inclinación (la rampa es de 15°: no se toca) se frena el cabeceo/alabeo y un par lo endereza.

26. **Auditoría con matches IA vs IA** (los 9 robots CAD, telemetría de atascos, inclinación y
    tiempo sin disparar): los shooters fijos apuntan con zona muerta de 0.03 rad, menor que su
    tolerancia de tiro (±6°: lo que corrigen al tirar); con la de 0.1 rad contra 0.09 de
    tolerancia se quedaban quietos sin girar ni disparar (1678 hasta 53 s). Bajo el TRENCH un
    robot chueco ya no gira ni avanza hacia él (girar ahí lo acuñaba: 5000 a 127°), sale derecho
    y vuelve a entrar alineado. Atrás de una TOWER (entre UPRIGHTS y pared; el hueco entre
    UPRIGHTS es más angosto que un robot) sale de lado, y no va por FUEL ahí ni en la esquina
    junto a la TOWER.
27. **Todos los robots 2026 con asset público** (29 en total): además de los de AdvantageScope con
    componentes, los que se publicaron de una sola pieza se articulan separando por nombre el
    subensamble que se mueve (`parts` en sources.mjs: 2363, 2412, 2826). 9584 es una sola malla
    sin nombres: queda estático (`static` en su rig, exento de la prueba de la intake). Sin EPA
    verificable para la mayoría, el nivel (rate/precisión) se estima por diseño para tener
    variedad, de alto (180, 2713, 1757) a bajo (9584, 339, 10021). Rigs revisados con
    `scripts/robots/preview.html` (`fuel=1` dibuja los lugares del hopper).
28. **Playoffs del torneo** (§10.6 y siguientes; el manual no está en el repo, verificar con TU22):
    8 alianzas de 3 con 24+ equipos (si no, 4), selección en serpentina 1→N, N→1; en la ronda 1
    un capitán puede invitar a un capitán de menor seed (las de abajo suben y entra el siguiente
    del ranking, aunque haya rechazado antes). Bracket de doble eliminación de FRC (13 matches con
    8 alianzas, 5 con 4) y Final al mejor de 3. El seed más alto de cada cruce del bracket va de
    rojo como en el diagrama oficial. **Empates**: se desempata con el orden de la Tabla 10-1
    (puntos sin faltas, FUEL de AUTO, puntos de TOWER); si persiste, el match se repite
    (`M5-R1`). Sin robots de respaldo (backup) ni timeouts entre matches.
29. **CAD propio en el taller**: el GLB / glTF autocontenido se guarda en IndexedDB
    (`src/render/customCad.ts`; localStorage no alcanza) y se lee al arrancar, antes de armar
    robots. Es solo visual: la física usa la ficha. Se adivina la unidad (m/cm/mm/in) por el
    tamaño del marco y el eje Z si el modelo sale "acostado"; el usuario ajusta escala, eje,
    frente, corrimiento y qué nodos son turret (gira) e intake (se desliza `extensionIn`). Sin
    Draco (no se incluye el decodificador). Si el archivo no está en el dispositivo (otro equipo,
    robot llegado por la red) se dibuja el diseño del simulador. Los archivos que ningún robot
    guardado usa se borran al arrancar. El robot se exporta como `.rebuilt-robot.json` (ficha +
    GLB en base64, `src/config/robotFile.ts`).
30. **Galería de robots de la comunidad**: GitHub Pages es estático, así que los robots publicados
    van a un proyecto gratuito de Supabase (tabla `robots` + bucket público `robots`; permisos en
    `docs/comunidad.sql`, pasos en `docs/comunidad.md`). Cliente mínimo con fetch
    (`src/net/robotHub.ts`), activo solo si se compila con `VITE_SUPABASE_URL/ANON_KEY`. Las fichas
    se validan al leer como un archivo importado (`sanitizeSpec`); el CAD solo se baja del bucket
    público de la galería (`hubCadUrlAllowed`). En línea, el host y los clientes bajan el CAD de
    los robots de la galería antes de empezar (hasta 5 s; si no, diseño del simulador). Borrar
    exige el token guardado al publicar; con 3 reportes el robot deja de listarse.

31. **YELLOW CARDS en el torneo** (§6.6.1): se acumulan de un match de Qualifications al siguiente
    (`Tournament.yellows`; el robot llega con la tarjeta y la siguiente YELLOW es RED). Supuesto, el
    manual no está en el repo (verificar con TU22 §6.6/§11): no pasan a los Playoffs, y en Playoffs la
    tarjeta sigue siendo por robot (RED → la alianza queda en 0).
32. **Avisos del árbitro**: además del aviso (regla, qué pasó, severidad y a quién van los puntos),
    una bandera sobre el robot que cometió la falta (3 s; tarjetas 4 s) y los puntos por faltas en el
    marcador de cada alianza. Se leen del `Match`, así que salen igual en línea y en repeticiones.
33. **Manejo** (`RobotPhysics.drive`): al acelerar, el par del motor cae con la velocidad (a tope
    queda ~45 % de la aceleración: llega a la máxima en ~0.6 s); frenar o cambiar de dirección solo
    lo limita la tracción (μ·g, a lo más 1.3 × `maxAccel`).

## Rendimiento medido (Fase 6)
- Escritorio (Intel Arc integrado, Alta/Ultra): 60 FPS, ~3–9 ms de simulación con 6 robots.
- Celular emulado (CPU 4×, 844×390 @2×, Media): 30–50 FPS típicos; caídas breves a ~25 cuando
  cientos de FUEL se mueven a la vez. La calidad Auto baja de nivel si el promedio < 42 FPS.
- Claves: draw calls 596 → ~225 (Media), FUEL dormido tras 0.4 s quieto, margen predictivo de
  Rapier 5 mm, 2 iteraciones de solver en Baja/Media, memo del solver balístico.
