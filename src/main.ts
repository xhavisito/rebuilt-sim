/**
 * Punto de entrada: pantalla de carga con progreso → Rapier (WASM) → App.
 */
import './ui/styles.css';
import { App } from './app/App';
import { initRapier } from './physics/PhysicsWorld';
import { t } from './ui/i18n';

const bar = document.getElementById('loading-bar') as HTMLElement;
const text = document.getElementById('loading-text') as HTMLElement;
const progress = (p: number, msg: string) => {
  bar.style.width = `${Math.round(p * 100)}%`;
  text.textContent = msg;
};

async function boot(): Promise<void> {
  progress(0.15, t('loadingPhysics'));
  await initRapier();
  progress(0.55, t('loadingField'));
  await new Promise((r) => setTimeout(r, 0));
  const app = new App(document.getElementById('app')!, document.getElementById('ui')!);
  (window as unknown as { app: App }).app = app;
  progress(0.9, t('loadingField'));
  const params = new URLSearchParams(location.search);
  const q = params.get('quality');
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') {
    app.settings.quality = q;
    app.applyQuality();
  }
  if (params.get('fps') === '1') app.settings.showFps = true;
  const mode = params.get('mode');
  if (mode === 'match') app.startMatch(params.get('spectate') === '1');
  else if (mode === 'practice') app.startPractice();
  else app.quitToMenu();
  const speed = Number(params.get('speed'));
  if (app.session && speed > 0) app.session.timeScale = speed;
  const cam = params.get('cam');
  if (cam) app.session?.rigs[0]?.setMode(cam as never);
  app.start();
  progress(1, t('loadingReady'));
  const loading = document.getElementById('loading')!;
  loading.style.opacity = '0';
  setTimeout(() => loading.remove(), 450);
}

boot().catch((e) => {
  console.error(e);
  text.textContent = `Error: ${(e as Error).message}`;
});
