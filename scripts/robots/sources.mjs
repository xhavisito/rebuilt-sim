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
//  - `lfs`: los GLB están en Git LFS · `zip`: el asset viene en ese .zip dentro de `path`.
//  - `lift`: metros que se sube el modelo (el asset de 9584 queda bajo el piso).
//  - `parts`: regex de los subensambles que se mueven → componentes c0, c1… (sin model_N.glb;
//    si el asset ya trae componentes, van después de ellos: 6357 → c1 la intake).
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
  { team: 2601, repo: 'steelhawks/Rebuilt2026', path: 'Robot_Kirin', license: 'MIT', frameIn: [27, 27], bumperGeom: true },
  { team: 401, repo: 'team401/2026-Robot-Code', path: 'advantagekit_config/Robot_401_2026', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], drop: '^Bumpers <|bumper board|bumper padding' },
  { team: 4201, repo: '4201VitruvianBots/Rebuilt2026', path: 'resources/Robot_Threepeater_v1', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], bumperGeom: true },
  { team: 6357, repo: 'frc6357/robot-code-2026', path: 'advantagescope/assets/Robot_2026bot', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], bumperGeom: true, parts: ['^four slaps'] },
  { team: 6657, repo: 'FRC6657/Rebuilt', path: 'AdvantageScopeAssets/Robot_Arbor26', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], drop: '^Bumper$' },
  { team: 2363, repo: 'TripleHelixProgramming/Rebuilt', path: 'ascope-assets/Robot_Rho', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], bumperGeom: true, parts: ['^NAUO(21|22|28|33|34|35|36|38|39|41)$'] },
  { team: 8324, repo: 'MECO-Robotics/2026-Rebuilt', path: 'sim/Robot_Remy', license: 'GPL-3.0', frameIn: [27, 27], drop: '^Bumper (Right|Front|Left)' },
  { team: 180, repo: 'frc180/2026-public', path: 'assets', zip: 'Robot_Batman.zip', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], drop: '^bumpers$' },
  { team: 8214, repo: 'nirobotics/ni-8214-2026-public', path: '.ascope/Robot_OFFSEASON2026', lfs: true, license: 'MIT', frameIn: [27, 27], bumperGeom: true },
  { team: 9410, repo: 'aydenterranella/2026-ROBOT-SIM-TESTING', path: 'advantagescope/Robot_9410_2026', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], drop: 'bumper', bumperGeom: true },
  { team: 7130, repo: 'cheng990119-sys/2026-Rebuilt-Robot-Code', path: 'ascope_assets/Robot_BataBot', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], drop: 'bumper', bumperGeom: true },
  { team: 2412, repo: 'robototes/REBUILT2026', path: 'AdvantageScope/Robot_2026CornerTurret', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], drop: 'bumper', bumperGeom: true, parts: ['^Turret <1>$', '^Intake Head <1>$'] },
  { team: 2826, repo: 'wave-2826/Rebuilt2026', path: 'misc/advantageScope/customAssets/Robot_WaveRobotics', license: 'GPL-3.0', frameIn: [27, 27], drop: 'bumper', bumperGeom: true, parts: ['^(Intake L <1>|Intake R <2>|Hopper <1>)$'] },
  { team: 2713, repo: 'FRC2713/Robot2026', path: 'advantagescope/assets/Robot_frc2713-2026', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], drop: 'bumper', bumperGeom: true },
  { team: 9584, repo: 'frc971/9584-wcp-code-2026', path: 'ascope_assets/Robot_9584', license: 'MIT', frameIn: [27, 27], drop: 'bumper', bumperGeom: true, lift: 0.1 },
  { team: 7419, repo: 'frc-7419/Rebuilt2026', path: 'assets/Robot_7419', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], drop: 'bumper', bumperGeom: true },
  { team: 339, repo: 'FIRST-Team-339/Rebuilt', path: 'ascope_assets/Robot_Kilroy26', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], drop: 'bumper', bumperGeom: true },
  { team: 1757, repo: '1757WestwoodRobotics/2026-Rebuilt', path: 'advantagescopeassets/Robot_Orion', license: 'MIT', frameIn: [27, 27], drop: 'bumper', bumperGeom: true },
  { team: 10021, repo: 'guerin-robotics/Rebuilt2026', path: 'Advantage Scope Assets/Robot_Omega', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], drop: 'bumper', bumperGeom: true },
  { team: 5024, repo: 'frc5024/Rebuilt', path: 'userAssets/Robot_Rebuilt', license: 'BSD-3-Clause (WPILib)', frameIn: [27, 27], drop: 'bumper', bumperGeom: true },
];
