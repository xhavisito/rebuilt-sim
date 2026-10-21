// Modelos 3D de robots 2026 publicados por los equipos en sus repos de código (assets de
// AdvantageScope). Todos con licencia que permite redistribuir con atribución (ver
// public/robots/LICENSES.md).
//  - `drop`: regex (nombre de la pieza o de un ensamble que la contiene) de piezas a quitar,
//    sobre todo los BUMPERS propios: el simulador dibuja los suyos en el color de alianza.
//  - `bumperGeom`: además quita las piezas bajas (< 0.2 m) que quedan fuera del chasis
//    `frameIn` (largo en X, ancho en Y del CAD, pulgadas): BUMPERS sin nombre útil.
//  - `budget`: triángulos máximos del modelo completo (el simplificador busca el error).
//  - `local`: sin repo público; el equipo mandó el CAD (no se versiona). fetch-sources.mjs copia
//    el config.json escrito a mano (scripts/robots/local/<equipo>/) y el model.glb va a mano.
//  - `parts`: regex de los subensambles que se mueven → componentes c0, c1… (sin model_N.glb).
// Frente del hopper de 3478 (lo empuja la intake al salir): pared del frente, paredes laterales
// internas que se deslizan en las placas fijas, el separador de arriba y las guías ("monedas")
const HOPPER_3478 = '^LB26-02-306-frente|^(Mirror)?LB26-02-308-pared lateral|^LB26-02-307-spacer sup hopper-1$|^(Mirror)?LB26-02-31[78]-Moneda|^3_8in Nut Strips 11inLargo';

export const SOURCES = [
  { team: 1678, repo: 'frc1678/C2026-Public', path: 'assets/Robot_Beta', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], bumperGeom: true },
  { team: 6328, repo: 'Mechanical-Advantage/RobotCode2026Public', path: 'ascope_assets/Robot_Darwin', license: 'MIT', frameIn: [28, 27], bumperGeom: true },
  { team: 604, repo: 'frc604/2026-public', path: 'FRC-2026/advantagescope_assets/Robot_2026-FRC604', license: 'BSD-3-Clause', frameIn: [27, 27] },
  { team: 971, repo: 'frc971/971-second-robot-2026', path: 'ascope_assets/Robot_First', license: 'BSD-3-Clause (WPILib)', frameIn: [26.5, 29], drop: 'bumper|^foam #' },
  { team: 341, repo: 'Team341/FRC2026-Public', path: 'assets/Robot_Beta2026', license: 'MIT', frameIn: [27, 27], drop: 'bumper' },
  { team: 190, repo: 'Team-190/2k26-Robot-Code', path: 'advantagescope_assets/Robot_Doomspiral', license: 'MIT', frameIn: [22, 30.5] },
  { team: 5000, repo: 'hammerheads5000/2026Rebuilt', path: 'AdvantageScope/Robot_2026', license: 'MIT', frameIn: [28.5, 26], drop: '^Bumpers:1$|^Body19|^Body1 \\(1\\):1$' },
  { team: 4915, repo: 'Spartronics4915/2026-Rebuilt', path: 'assets/Robot_Artemis', license: 'MIT', frameIn: [26.5, 28.5], drop: 'bumper', bumperGeom: true },
  // SolidWorks → Guardar como .glb (Extended Reality), mandado por el equipo; sin BUMPERS
  { team: 3478, local: 'CAD de SolidWorks enviado por el equipo (LB26-00_Bocho_Houston)', license: 'Con permiso del equipo 3478', frameIn: [26.7, 28.2], parts: ['Intake VHouston', '^LB26-04-01_shooter$', 'SpindexerHouston', HOPPER_3478] },
];
