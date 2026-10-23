/** Colores de los mapas del campo en canvas (planeador, diseñador de AUTO, plan de juego), iguales
 *  al mapa SVG de la configuración del match: plano oscuro con contornos de color y rellenos tenues. */
export const FIELD_PAL = {
  bg: '#0b0d11',
  floor: '#0f1014',
  edge: 'rgba(255,255,255,.25)',
  grid: 'rgba(150,175,220,.07)',
  center: 'rgba(255,255,255,.55)',
  blue: '#2f7df6',
  red: '#e5413a',
  fuel: '#ffc72c',
  tower: '#8a93a3',
  label: 'rgba(233,236,241,.8)',
};

/** Letra de las etiquetas dibujadas en canvas (la misma de los títulos). */
export const CANVAS_FONT = "'Chakra Petch', 'Bahnschrift', sans-serif";

/** `#rrggbb` con opacidad `a` (0–1). */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Rectángulo con relleno y contorno opcionales (en píxeles). */
export function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string | null, stroke: string | null = null, lw = 1): void {
  if (fill) {
    g.fillStyle = fill;
    g.fillRect(x, y, w, h);
  }
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw);
  }
}
