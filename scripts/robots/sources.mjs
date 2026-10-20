// Modelos 3D de robots 2026 publicados por los equipos en sus repos de código (assets de
// AdvantageScope). Todos con licencia que permite redistribuir con atribución (ver
// public/robots/LICENSES.md). `drop`: regex de piezas a quitar (p. ej. BUMPERS propios, que
// el simulador dibuja en el color de alianza).
export const SOURCES = [
  { team: 1678, repo: 'frc1678/C2026-Public', path: 'assets/Robot_Beta', license: 'BSD-3-Clause (WPILib)' },
  { team: 6328, repo: 'Mechanical-Advantage/RobotCode2026Public', path: 'ascope_assets/Robot_Darwin', license: 'MIT' },
  { team: 604, repo: 'frc604/2026-public', path: 'FRC-2026/advantagescope_assets/Robot_2026-FRC604', license: 'BSD-3-Clause' },
  { team: 971, repo: 'frc971/971-second-robot-2026', path: 'ascope_assets/Robot_First', license: 'BSD-3-Clause (WPILib)', drop: '^Bumper \\(|^Foam #' },
  { team: 341, repo: 'Team341/FRC2026-Public', path: 'assets/Robot_Beta2026', license: 'MIT', drop: 'Bumper (Wood|Noodles)' },
  { team: 190, repo: 'Team-190/2k26-Robot-Code', path: 'advantagescope_assets/Robot_Doomspiral', license: 'MIT' },
  { team: 5000, repo: 'hammerheads5000/2026Rebuilt', path: 'AdvantageScope/Robot_2026', license: 'MIT', drop: '^Body19|^Body1 \\(1\\):1$' },
  { team: 4915, repo: 'Spartronics4915/2026-Rebuilt', path: 'assets/Robot_Artemis', license: 'MIT' },
];
