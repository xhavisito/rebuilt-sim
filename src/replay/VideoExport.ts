/**
 * Video de un clip: cada frame se copia el canvas 3D a un canvas 2D (máx. 1280 px de ancho) con
 * un marcador encima (el HUD es DOM y no sale en el canvas) y MediaRecorder lo graba junto con el
 * audio del juego. MP4 si el navegador lo graba; si no, WebM.
 */
export interface VideoOverlay {
  red: number;
  blue: number;
  timer: string;
  phase: string;
  teams: { red: number[]; blue: number[] };
  /** Texto chico abajo a la derecha. */
  label: string;
}

const MIMES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export function videoSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function' && MIMES.some((m) => MediaRecorder.isTypeSupported(m));
}

export class ClipVideo {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  readonly mime: string;

  constructor(
    private src: HTMLCanvasElement,
    audio: MediaStream | null,
  ) {
    const w = Math.min(1280, src.width) & ~1;
    this.canvas.width = w;
    this.canvas.height = Math.round((w * src.height) / Math.max(1, src.width)) & ~1;
    this.ctx = this.canvas.getContext('2d')!;
    this.mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
    const stream = this.canvas.captureStream(30);
    for (const tr of audio?.getAudioTracks() ?? []) stream.addTrack(tr);
    this.rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 6_000_000 });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
  }

  get ext(): 'mp4' | 'webm' {
    return this.mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  }

  start(): void {
    this.rec.start(500);
  }

  /** Justo después de dibujar la escena (el canvas WebGL aún tiene la imagen). */
  draw(ov: VideoOverlay): void {
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.drawImage(this.src, 0, 0, W, H);
    // marcador estilo transmisión, arriba al centro
    const u = W / 1280;
    const font = (px: number, w = 700) => `${w} ${Math.round(px * u)}px "Chakra Petch", "Inter Variable", system-ui, sans-serif`;
    const bw = 150 * u;
    const mw = 130 * u;
    const h = 58 * u;
    const x0 = W / 2 - bw - mw / 2;
    const y0 = 18 * u;
    c.save();
    c.shadowColor = 'rgba(0,0,0,.45)';
    c.shadowBlur = 14 * u;
    c.fillStyle = '#c62f2a';
    c.fillRect(x0, y0, bw, h);
    c.fillStyle = '#1f5fd1';
    c.fillRect(x0 + bw + mw, y0, bw, h);
    c.fillStyle = 'rgba(12,13,17,.92)';
    c.fillRect(x0 + bw, y0, mw, h);
    c.restore();
    c.fillStyle = '#fff';
    c.textBaseline = 'middle';
    c.textAlign = 'center';
    c.font = font(34);
    c.fillText(String(ov.red), x0 + bw * 0.72, y0 + h / 2 + 1 * u);
    c.fillText(String(ov.blue), x0 + bw + mw + bw * 0.28, y0 + h / 2 + 1 * u);
    c.font = font(26);
    c.fillText(ov.timer, W / 2, y0 + h * 0.4);
    c.font = font(11, 600);
    c.fillStyle = 'rgba(255,255,255,.75)';
    c.fillText(ov.phase, W / 2, y0 + h * 0.8);
    c.font = font(12, 600);
    c.textAlign = 'left';
    c.fillStyle = 'rgba(255,255,255,.85)';
    c.fillText(ov.teams.red.join(' · '), x0 + 10 * u, y0 + h / 2);
    c.textAlign = 'right';
    c.fillText(ov.teams.blue.join(' · '), x0 + 2 * bw + mw - 10 * u, y0 + h / 2);
    c.font = font(13, 600);
    c.fillStyle = 'rgba(255,255,255,.6)';
    c.fillText(ov.label, W - 16 * u, H - 16 * u);
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      this.rec.onstop = () => resolve(new Blob(this.chunks, { type: this.mime.split(';')[0] }));
      this.rec.stop();
    });
  }
}

/** Comparte el archivo (hoja de compartir del sistema) o, si no se puede, lo descarga. */
export async function shareOrDownload(blob: Blob, name: string, title: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  download(blob, name);
  return 'downloaded';
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
