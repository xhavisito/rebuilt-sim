# Escenarios e2e (Playwright)

Verificaciones de extremo a extremo en el navegador real (requieren `npm run build`).
Cada script levanta `vite preview` en un puerto propio, ejecuta el escenario e imprime
el estado relevante (y capturas en `shots/`).

| Script | Qué verifica |
|---|---|
| `touch.mjs` | Joysticks táctiles multitouch mueven y giran el robot |
| `match-flow.mjs` | AUTO → TRANSITION (persecución blanca) → SHIFT 1 según quién anotó más |
| `mechanisms.mjs` | Intake, tiro con auto-aim, disparo en movimiento, CHUTE y CORRAL |
| `human-player.mjs` | Lanzamientos del HUMAN PLAYER al HUB e intake desde el DEPOT |
| `rules.mjs` | Climb L1 en AUTO, G403, PIN (G418), G420 + LEVEL 3, pantalla de resultados |
| `offline.mjs` | PWA: tras la primera visita, el menú y un match funcionan sin red |
| `modes.mjs` | Torneo (jugar → resultados → continuar) y multijugador local con 2 dispositivos |
| `tournament.mjs` | Torneo de 32 equipos: selección de 8 alianzas (eres capitán), bracket de doble eliminación y Final al mejor de 3 hasta el campeón |
| `auto-path.mjs` | Autónomo programable: importa una ruta suave, arrastra/deshace en el lienzo, vista previa y el robot sigue la ruta en AUTO |
| `robot-editor.mjs` | Taller: importar un CAD propio (GLB), ajustar ejes/escala/piezas móviles, guardarlo (vuelve tras recargar), jugar un match con él y exportar / importar el robot |
| `online.mjs` | En línea con 2 pestañas (WebRTC real, señalización local): sala pública en la lista, lobby, match, controles remotos, marcador y la IA toma al que se va |
| `gamepad.mjs` | Control simulado: pantalla de Control navegable con el D-pad, reasignar (intercambio), manejar con el stick y vibración al tirar (gatillo) y al recoger FUEL |

Uso: `npm run e2e` (todos) o `node scripts/scenarios/rules.mjs`.
