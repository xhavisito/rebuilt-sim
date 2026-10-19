/**
 * AprilTags 36h11 reales (IDs 1–32) generados como textura.
 * Códigos y orden de bits tomados de AprilRobotics/apriltag (tag36h11.c, licencia BSD-2).
 */
import * as THREE from 'three';

// codedata[0..32] de tag36h11 (como cadenas hex para no perder precisión de 36 bits)
const CODES = [
  'd7e00984b', 'dda664ca7', 'dc4a1c821', 'e17b470e9', 'ef91d01b1', 'f429cdd73', '05da29225', '1106cba43',
  '223bed79d', '21f51213c', '33eb19ca6', '3f76eb0f8', '469a97414', '45dcfe0b0', '4a6465f72', '51801db96',
  '5eb946b4e', '68a7cc2ec', '6f0ba2652', '78765559d', '87b83d129', '86cc4a5c5', '8b64df90f', '9c577b611',
  'a3810f2f5', 'af4d75b83', 'b59a03fef', 'bb1096f85', 'd1b92fc76', 'd0dd509d2', 'e2cfda160', '2ff497c63',
  '47240671b',
];
const BIT_X = [1, 2, 3, 4, 5, 2, 3, 4, 3, 6, 6, 6, 6, 6, 5, 5, 5, 4, 6, 5, 4, 3, 2, 5, 4, 3, 4, 1, 1, 1, 1, 1, 2, 2, 2, 3];
const BIT_Y = [1, 1, 1, 1, 1, 2, 2, 2, 3, 1, 2, 3, 4, 5, 2, 3, 4, 3, 6, 6, 6, 6, 6, 5, 5, 5, 4, 6, 5, 4, 3, 2, 5, 4, 3, 4];

/** Matriz 10×10 (true = blanco) del tag `id`. */
export function tagMatrix(id: number): boolean[][] {
  const code = BigInt('0x' + CODES[id]);
  const m: boolean[][] = Array.from({ length: 10 }, (_, y) =>
    Array.from({ length: 10 }, (_, x) => x === 0 || y === 0 || x === 9 || y === 9),
  );
  for (let i = 0; i < 36; i++) {
    const bit = (code >> BigInt(35 - i)) & 1n;
    m[BIT_Y[i] + 1][BIT_X[i] + 1] = bit === 1n;
  }
  return m;
}

const cache = new Map<number, THREE.Texture>();

/** Textura del panel de policarbonato de 10.5 in con el tag de 8.125 in y su etiqueta. */
export function aprilTagTexture(id: number): THREE.Texture {
  const hit = cache.get(id);
  if (hit) return hit;
  const px = 12;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  const m = tagMatrix(id);
  const off = (size - 10 * px) / 2;
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 10; x++) {
      if (!m[y][x]) {
        g.fillStyle = '#000';
        g.fillRect(off + x * px, off + y * px, px, px);
      }
    }
  g.fillStyle = '#333';
  g.font = 'bold 7px Arial';
  g.fillText(String(id), 2, size - 2);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(id, t);
  return t;
}
