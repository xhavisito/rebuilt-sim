/**
 * Punto de entrada: pantalla de carga con progreso → Rapier (WASM) → App.
 */
import './ui/styles.css';
import { App } from './app/App';
import { isDifficulty } from './ai/difficulty';
import { initRapier } from './physics/PhysicsWorld';
import { t } from './ui/i18n';
import { registerServiceWorker } from './pwa/register';

const bar = document.getElementById('loading-bar') as HTMLElement;
const text = document.getElementById('loading-text') as HTMLElement;
const progress = (p: number, msg: string) => {
  bar.style.width = `${Math.round(p * 100)}%`;
  text.textContent = msg;
};

async function boot(): Promise<void> {
  progress(0.15, t('loadingPhysics'));
  // Las texturas de números (BUMPERS) usan la fuente display: cárgala antes de dibujarlas
  await Promise.all([initRapier(), document.fonts?.load('400 64px Anton').catch(() => undefined)]);
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
  const diff = params.get('difficulty');
  if (isDifficulty(diff)) app.settings.match.difficulty = diff;
  // Dificultad por alianza (banco de pruebas IA vs IA: `npm run ai-bench`)
  for (const a of ['red', 'blue'] as const) {
    const d = params.get(a === 'red' ? 'difficultyRed' : 'difficultyBlue');
    if (isDifficulty(d)) app.difficultyOf[a] = d;
  }
  const mode = params.get('mode');
  if (mode === 'match') app.startMatch(params.get('spectate') === '1');
  else if (mode === 'practice') app.startPractice();
  else app.quitToMenu();
  // Enlace de invitación a una sala en línea (?join=CÓDIGO)
  const join = params.get('join');
  if (join && !mode) app.screens.online(join);
  const speed = Number(params.get('speed'));
  if (app.session && speed > 0) app.session.timeScale = speed;
  const cam = params.get('cam');
  if (cam) app.session?.rigs[0]?.setMode(cam as never);
  app.start();
  registerServiceWorker(() => app.toast(t('offlineReady'), 'good'));
  progress(1, t('loadingReady'));
  const loading = document.getElementById('loading')!;
  loading.style.opacity = '0';
  setTimeout(() => loading.remove(), 450);
}

boot().catch((e) => {
  console.error(e);
  text.textContent = `Error: ${(e as Error).message}`;
});
