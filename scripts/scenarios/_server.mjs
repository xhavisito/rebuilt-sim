// Servidor `vite preview` para los escenarios (se lanza con node para poder cerrarlo bien).
import { spawn } from 'node:child_process';

export async function startServer(port, outDir = 'dist') {
  const proc = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--outDir', outDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Cierra el servidor aunque el escenario falle
  process.on('exit', () => proc.kill());
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`vite preview no arrancó en ${port}`)), 20000);
    const onData = (d) => {
      const s = String(d);
      if (/in use|EADDRINUSE/i.test(s)) reject(new Error(s));
      else if (s.includes(String(port))) {
        clearTimeout(to);
        resolve();
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
  });
  return { url: `http://localhost:${port}`, close: () => proc.kill() };
}
