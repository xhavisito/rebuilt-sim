/**
 * WebGL2 + EffectComposer con presets de calidad.
 * (WebGPURenderer no se usa: ver decisión en docs/PLAN.md.)
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export const QUALITY_ORDER: Quality[] = ['low', 'medium', 'high', 'ultra'];

export interface QualityPreset {
  /** Escala de resolución respecto a devicePixelRatio (con tope). */
  maxPixelRatio: number;
  renderScale: number;
  shadows: boolean;
  shadowMapSize: number;
  fuelShadows: boolean;
  bloom: boolean;
  ao: boolean;
  aa: 'none' | 'fxaa' | 'msaa';
  /** Densidad del público (0–1). */
  crowd: number;
  /** Paso de física (Hz). */
  physicsHz: number;
  /** Detalle de la esfera de FUEL (IcosahedronGeometry detail). */
  fuelDetail: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { maxPixelRatio: 1, renderScale: 0.7, shadows: false, shadowMapSize: 512, fuelShadows: false, bloom: false, ao: false, aa: 'none', crowd: 0, physicsHz: 60, fuelDetail: 1 },
  medium: { maxPixelRatio: 1.5, renderScale: 0.85, shadows: true, shadowMapSize: 1024, fuelShadows: false, bloom: true, ao: false, aa: 'fxaa', crowd: 0.35, physicsHz: 60, fuelDetail: 1 },
  high: { maxPixelRatio: 2, renderScale: 1, shadows: true, shadowMapSize: 2048, fuelShadows: true, bloom: true, ao: false, aa: 'msaa', crowd: 0.7, physicsHz: 120, fuelDetail: 2 },
  ultra: { maxPixelRatio: 2, renderScale: 1, shadows: true, shadowMapSize: 4096, fuelShadows: true, bloom: true, ao: true, aa: 'msaa', crowd: 1, physicsHz: 120, fuelDetail: 2 },
};

export interface Viewport {
  camera: THREE.PerspectiveCamera;
  /** Rectángulo normalizado (0–1) con origen abajo-izquierda. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  quality: Quality = 'medium';
  preset: QualityPreset = QUALITY.medium;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private aoPass: GTAOPass | null = null;
  private width = 1;
  private height = 1;
  /** Callbacks cuando cambia la calidad (p. ej. sombras de FUEL). */
  onQualityChange: Array<(p: QualityPreset) => void> = [];

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.id = 'gl';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0a0d14);
    this.scene.fog = new THREE.Fog(0x0a0d14, 40, 90);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a2a30, 0.35);
    this.scene.add(this.hemi);
    // Luz principal de la arena (focos del techo), con sombras.
    this.sun = new THREE.DirectionalLight(0xfff6ea, 1.9);
    this.sun.position.set(-3, 16, 5);
    this.sun.target.position.set(0, 0, 0);
    const sc = this.sun.shadow.camera;
    sc.left = -9.5;
    sc.right = 9.5;
    sc.top = 5.5;
    sc.bottom = -5.5;
    sc.near = 2;
    sc.far = 30;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    // Relleno lateral suave
    const fill = new THREE.DirectionalLight(0xcfd8ff, 0.35);
    fill.position.set(6, 8, -10);
    this.scene.add(fill);
    this.resize();
  }

  private defaultCam = new THREE.PerspectiveCamera();

  setQuality(q: Quality, camera: THREE.Camera = this.defaultCam): void {
    this.quality = q;
    const p = (this.preset = QUALITY[q]);
    this.renderer.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    if (p.shadows) {
      this.sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.buildComposer(camera);
    this.resize();
    for (const cb of this.onQualityChange) cb(p);
  }

  private buildComposer(camera: THREE.Camera): void {
    this.composer?.dispose();
    this.composer = null;
    this.aoPass = null;
    const p = this.preset;
    if (!p.bloom && p.aa === 'none' && !p.ao) return; // render directo (más barato)
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: p.aa === 'msaa' ? 4 : 0,
    });
    const c = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, camera);
    c.addPass(this.renderPass);
    if (p.ao) {
      this.aoPass = new GTAOPass(this.scene, camera as THREE.PerspectiveCamera, 1, 1);
      this.aoPass.blendIntensity = 0.8;
      c.addPass(this.aoPass);
    }
    if (p.bloom) {
      const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.55, 1.15);
      c.addPass(bloom);
    }
    c.addPass(new OutputPass());
    if (p.aa === 'fxaa') c.addPass(new FXAAPass());
    this.composer = c;
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    const pr = Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio) * this.preset.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, true);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(w, h);
  }

  get aspect(): number {
    return this.width / this.height;
  }

  render(views: Viewport[]): void {
    const r = this.renderer;
    r.info.reset();
    if (views.length === 1 && this.composer && this.renderPass) {
      const cam = views[0].camera;
      cam.aspect = this.width / this.height;
      cam.updateProjectionMatrix();
      this.renderPass.camera = cam;
      if (this.aoPass) this.aoPass.camera = cam;
      this.composer.render();
      return;
    }
    // Pantalla dividida (o calidad baja): render directo por viewport con scissor.
    r.setScissorTest(views.length > 1);
    for (const v of views) {
      const x = Math.floor(v.x * this.width);
      const y = Math.floor(v.y * this.height);
      const w = Math.ceil(v.w * this.width);
      const h = Math.ceil(v.h * this.height);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      v.camera.aspect = w / h;
      v.camera.updateProjectionMatrix();
      r.render(this.scene, v.camera);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
  }

  get info(): THREE.WebGLInfo {
    return this.renderer.info;
  }
}
