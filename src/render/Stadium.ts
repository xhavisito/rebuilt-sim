/**
 * Ambiente de arena: gradas escalonadas, público instanciado (baja poligonización, se mueve
 * en el vertex shader), estructuras de iluminación, mesa de anotación y pantalla gigante.
 * La densidad del público depende de la calidad gráfica.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as F from '../config/field';
import { Rng } from '../core/rng';

const MAX_CROWD = 2600;

export class Stadium {
  readonly group = new THREE.Group();
  private crowd: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private crowdShaders: Array<{ uniforms: Record<string, THREE.IUniform> }> = [];
  private excite = 0;
  private screenCanvas: HTMLCanvasElement;
  private screenTex: THREE.CanvasTexture;
  private lastScreen = '';

  constructor() {
    this.group.name = 'stadium';
    const rng = new Rng(11);
    // ---- Gradas: filas escalonadas en los lados largos y detrás de las ALLIANCE AREAS
    const tierGeos: THREE.BufferGeometry[] = [];
    const seats: Array<{ x: number; y: number; z: number; ry: number }> = [];
    const rows = 12;
    const addStand = (cx: number, cz: number, len: number, ry: number, start: number) => {
      for (let r = 0; r < rows; r++) {
        const d = start + r * 0.85;
        const h = 0.45 + r * 0.42;
        const g = new THREE.BoxGeometry(len, h, 0.85);
        g.translate(0, h / 2, d + 0.42);
        g.rotateY(ry);
        g.translate(cx, 0, cz);
        tierGeos.push(g);
        for (let s = -len / 2 + 0.35; s < len / 2 - 0.35; s += 0.55) {
          if (rng.next() < 0.12) continue;
          const local = new THREE.Vector3(s + rng.range(-0.08, 0.08), h, d + 0.45).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
          seats.push({ x: cx + local.x, y: local.y, z: cz + local.z, ry: ry + Math.PI });
        }
      }
    };
    addStand(0, 0, 30, 0, F.HALF_W + 3.0); // lado +Z
    addStand(0, 0, 30, Math.PI, F.HALF_W + 4.5); // lado −Z (detrás de la mesa/pantalla)
    addStand(0, 0, 11, Math.PI / 2, F.HALF_L + 5.2); // detrás de la alianza roja
    addStand(0, 0, 11, -Math.PI / 2, F.HALF_L + 5.2); // detrás de la alianza azul
    const stands = new THREE.Mesh(mergeGeometries(tierGeos)!, new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.9 }));
    stands.receiveShadow = false;
    this.group.add(stands);

    // ---- Público: torso + cabeza, una sola InstancedMesh con fase por instancia
    // Torso (playera de color) y cabeza (tono de piel) en dos InstancedMesh con la misma matriz
    const personGeo = new THREE.BoxGeometry(0.36, 0.5, 0.22).translate(0, 0.25, 0);
    const headGeo = new THREE.SphereGeometry(0.11, 6, 4).translate(0, 0.62, 0);
    rng.shuffle(seats);
    const n = Math.min(MAX_CROWD, seats.length);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) phase[i] = rng.next() * Math.PI * 2;
    personGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    headGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const headMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    const shaders: Array<{ uniforms: Record<string, THREE.IUniform> }> = [];
    const bob = (sh: { uniforms: Record<string, THREE.IUniform>; vertexShader: string }) => {
      sh.uniforms.uTime = { value: 0 };
      sh.uniforms.uExcite = { value: 0 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uExcite;\nattribute float aPhase;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed.y += (0.03 + 0.12 * uExcite) * max(0.0, sin(uTime * (2.0 + 4.0 * uExcite) + aPhase));',
        );
      shaders.push(sh);
    };
    mat.onBeforeCompile = bob;
    headMat.onBeforeCompile = bob;
    this.crowdShaders = shaders;
    this.crowd = new THREE.InstancedMesh(personGeo, mat, n);
    this.heads = new THREE.InstancedMesh(headGeo, headMat, n);
    const skins = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0xffdbac, 0x5c3a1e];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const palette = [0xd32f2f, 0x1e66d0, 0xf2c400, 0xffffff, 0x2e7d32, 0x6a1b9a, 0xef6c00, 0x37474f, 0x00897b];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const s = seats[i];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.ry);
      const sc = rng.range(0.9, 1.1);
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(sc, sc, sc));
      this.crowd.setMatrixAt(i, m);
      this.heads.setMatrixAt(i, m);
      c.setHex(palette[Math.floor(rng.next() * palette.length)]).multiplyScalar(rng.range(0.45, 0.85));
      this.crowd.setColorAt(i, c);
      c.setHex(skins[Math.floor(rng.next() * skins.length)]);
      this.heads.setColorAt(i, c);
    }
    this.crowd.frustumCulled = false;
    this.heads.frustumCulled = false;
    this.group.add(this.crowd, this.heads);

    // ---- Estructuras de luces sobre el campo (barras emisivas: el bloom les da brillo)
    const truss = new THREE.MeshStandardMaterial({ color: 0x15181f, metalness: 0.6, roughness: 0.5 });
    const lamp = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff4e0, emissiveIntensity: 6 });
    const trussGeos: THREE.BufferGeometry[] = [];
    const lampGeos: THREE.BufferGeometry[] = [];
    for (const x of [-6, -2, 2, 6]) {
      trussGeos.push(new THREE.BoxGeometry(0.3, 0.3, F.FIELD_WIDTH + 8).translate(x, 11, 0));
      for (const z of [-3.5, -1.2, 1.2, 3.5]) lampGeos.push(new THREE.BoxGeometry(0.55, 0.12, 0.55).translate(x, 10.8, z));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(trussGeos)!, truss));
    this.group.add(new THREE.Mesh(mergeGeometries(lampGeos)!, lamp));

    // ---- Mesa de anotación (lado −Z) y pantalla gigante
    const table = new THREE.Mesh(new THREE.BoxGeometry(5, 0.9, 0.8), new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.7 }));
    table.position.set(0, 0.45, -(F.HALF_W + 1.6));
    this.group.add(table);
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = 512;
    this.screenCanvas.height = 192;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
    screen.position.set(0, 8.5, -(F.HALF_W + 9.5));
    this.group.add(screen);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(8.4, 3.4, 0.3), truss);
    frame.position.set(0, 8.5, -(F.HALF_W + 9.68));
    this.group.add(frame);
    this.setScreen('REBUILT', '', '');
  }

  /** Densidad del público según la calidad (0–1). */
  setDensity(d: number): void {
    this.crowd.count = this.heads.count = Math.round(this.crowd.instanceMatrix.count * d);
    this.crowd.visible = this.heads.visible = d > 0;
  }

  /** El público se emociona (al anotar, al terminar el match…). */
  cheer(amount = 1): void {
    this.excite = Math.min(1, this.excite + amount);
  }

  update(dt: number, time: number): void {
    this.excite = Math.max(0, this.excite - dt * 0.35);
    for (const sh of this.crowdShaders) {
      sh.uniforms.uTime.value = time;
      sh.uniforms.uExcite.value = this.excite;
    }
  }

  /** Pantalla gigante: marcador rojo – timer – azul. */
  setScreen(center: string, red: string, blue: string): void {
    const key = `${center}|${red}|${blue}`;
    if (key === this.lastScreen) return;
    this.lastScreen = key;
    const g = this.screenCanvas.getContext('2d')!;
    const W = this.screenCanvas.width;
    const H = this.screenCanvas.height;
    g.fillStyle = '#05070c';
    g.fillRect(0, 0, W, H);
    if (red || blue) {
      g.fillStyle = '#b71c1c';
      g.fillRect(0, 0, W * 0.32, H);
      g.fillStyle = '#0d47a1';
      g.fillRect(W * 0.68, 0, W * 0.32, H);
    }
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${red || blue ? 96 : 84}px Arial, sans-serif`;
    if (red || blue) {
      g.fillText(red, W * 0.16, H / 2);
      g.fillText(blue, W * 0.84, H / 2);
      g.font = '900 72px Arial, sans-serif';
    }
    g.fillStyle = '#f2c400';
    g.fillText(center, W / 2, H / 2);
    this.screenTex.needsUpdate = true;
  }
}
