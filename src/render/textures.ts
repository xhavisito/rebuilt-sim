/** Texturas procedurales (canvas) — sin archivos externos. */
import * as THREE from 'three';
import { Rng } from '../core/rng';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Alfombra gris de pelo bajo con moteado. */
export function carpetTexture(): { map: THREE.Texture; bump: THREE.Texture } {
  const n = 256;
  const [c, g] = canvas(n, n);
  const [cb, gb] = canvas(n, n);
  const rng = new Rng(7);
  g.fillStyle = '#5a5d62';
  g.fillRect(0, 0, n, n);
  gb.fillStyle = '#808080';
  gb.fillRect(0, 0, n, n);
  const img = g.getImageData(0, 0, n, n);
  const bimg = gb.getImageData(0, 0, n, n);
  for (let i = 0; i < n * n; i++) {
    const v = rng.gauss() * 9 + (rng.next() < 0.02 ? -25 : 0);
    img.data[i * 4] += v;
    img.data[i * 4 + 1] += v;
    img.data[i * 4 + 2] += v + 1;
    const b = 128 + rng.gauss() * 40;
    bimg.data[i * 4] = bimg.data[i * 4 + 1] = bimg.data[i * 4 + 2] = b;
  }
  g.putImageData(img, 0, 0);
  gb.putImageData(bimg, 0, 0);
  return { map: tex(c, 40), bump: tex(cb, 160, false) };
}

/** Relieve "orange peel" del HDPE de los BUMPS. */
export function orangePeelBump(): THREE.Texture {
  const n = 128;
  const [c, g] = canvas(n, n);
  const rng = new Rng(3);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, n, n);
  for (let k = 0; k < 900; k++) {
    const x = rng.next() * n;
    const y = rng.next() * n;
    const r = rng.range(1.5, 4);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  return tex(c, 6, false);
}

/** Diamond plate (base de la DRIVER STATION). */
export function diamondPlate(): { map: THREE.Texture; bump: THREE.Texture } {
  const n = 128;
  const [c, g] = canvas(n, n);
  const [cb, gb] = canvas(n, n);
  g.fillStyle = '#9aa0a6';
  g.fillRect(0, 0, n, n);
  gb.fillStyle = '#000';
  gb.fillRect(0, 0, n, n);
  const draw = (ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, col: string) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const rot = (x + y) % 2 ? Math.PI / 4 : -Math.PI / 4;
      draw(g, x * 32 + 16, y * 32 + 16, rot, '#b9bec4');
      draw(gb, x * 32 + 16, y * 32 + 16, rot, '#fff');
    }
  return { map: tex(c, 4), bump: tex(cb, 4, false) };
}

/** Red del HUB: malla con transparencia. */
export function netTexture(): THREE.Texture {
  const n = 64;
  const [c, g] = canvas(n, n);
  g.clearRect(0, 0, n, n);
  g.strokeStyle = 'rgba(20,20,22,0.95)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(n, n);
  g.moveTo(n, 0);
  g.lineTo(0, n);
  g.stroke();
  const t = tex(c, 1);
  t.repeat.set(24, 10);
  return t;
}

/** Textura de texto (números de equipo, letreros). */
export function textTexture(
  text: string,
  opts: { w?: number; h?: number; bg?: string; fg?: string; font?: string } = {},
): THREE.CanvasTexture {
  const w = opts.w ?? 256;
  const h = opts.h ?? 96;
  const [c, g] = canvas(w, h);
  g.fillStyle = opts.bg ?? '#000';
  g.fillRect(0, 0, w, h);
  g.fillStyle = opts.fg ?? '#fff';
  g.font = opts.font ?? `bold ${Math.floor(h * 0.72)}px "Arial Black", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + h * 0.04);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Fondo de estadio: gradiente para el cielo/techo. */
export function domeTexture(): THREE.Texture {
  const [c, g] = canvas(16, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#05070c');
  grd.addColorStop(0.55, '#0e1420');
  grd.addColorStop(1, '#1a2233');
  g.fillStyle = grd;
  g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
