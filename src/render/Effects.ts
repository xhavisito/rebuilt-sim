/**
 * Partículas en GPU (un solo THREE.Points con shader): ráfagas al anotar en el HUB,
 * estela sutil de los tiros, chispas/polvo en los choques. Pool fijo, sin asignaciones.
 */
import * as THREE from 'three';

export interface EmitOptions {
  color: THREE.ColorRepresentation;
  speed?: number;
  spread?: number;
  up?: number;
  life?: number;
  size?: number;
  gravity?: number;
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    float a = vAlpha * smoothstep(0.25, 0.0, d);
    gl_FragColor = vec4(vColor * 1.6, a);
  }`;

export class Effects {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private baseSize: Float32Array;
  private next = 0;
  private tmp = new THREE.Color();
  private material: THREE.ShaderMaterial;
  enabled = true;

  constructor(capacity = 1600) {
    this.n = capacity;
    this.pos = new Float32Array(capacity * 3).fill(-100);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity).fill(1);
    this.grav = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'effects';
  }

  /** Ajusta el tamaño de los puntos a la altura del viewport (px). */
  setViewportHeight(h: number): void {
    this.material.uniforms.uScale.value = h * 0.55;
  }

  emit(x: number, y: number, z: number, count: number, o: EmitOptions): void {
    if (!this.enabled) return;
    this.tmp.set(o.color);
    const sp = o.speed ?? 2;
    const spread = o.spread ?? 1;
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(2 * Math.random() - 1);
      const s = sp * (0.4 + 0.6 * Math.random());
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = Math.sin(b) * Math.cos(a) * s * spread;
      this.vel[i * 3 + 1] = Math.abs(Math.cos(b)) * s + (o.up ?? 0);
      this.vel[i * 3 + 2] = Math.sin(b) * Math.sin(a) * s * spread;
      this.col[i * 3] = this.tmp.r;
      this.col[i * 3 + 1] = this.tmp.g;
      this.col[i * 3 + 2] = this.tmp.b;
      this.maxLife[i] = (o.life ?? 0.8) * (0.7 + 0.6 * Math.random());
      this.life[i] = this.maxLife[i];
      this.baseSize[i] = (o.size ?? 0.06) * (0.6 + 0.8 * Math.random());
      this.grav[i] = o.gravity ?? 6;
    }
  }

  /** Una partícula quieta y tenue (estela de un tiro). */
  trail(x: number, y: number, z: number): void {
    if (!this.enabled) return;
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = this.vel[i * 3 + 1] = this.vel[i * 3 + 2] = 0;
    this.col[i * 3] = 1;
    this.col[i * 3 + 1] = 0.85;
    this.col[i * 3 + 2] = 0.35;
    this.maxLife[i] = this.life[i] = 0.28;
    this.baseSize[i] = 0.07;
    this.grav[i] = 0;
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          any = true;
        }
        continue;
      }
      any = true;
      this.life[i] -= dt;
      const o = i * 3;
      this.vel[o + 1] -= this.grav[i] * dt;
      this.vel[o] *= 1 - 1.5 * dt;
      this.vel[o + 2] *= 1 - 1.5 * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] = Math.max(0.01, this.pos[o + 1] + this.vel[o + 1] * dt);
      this.pos[o + 2] += this.vel[o + 2] * dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = f * 0.9;
      this.size[i] = this.baseSize[i] * (0.5 + 0.5 * f);
    }
    if (!any) return;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}
