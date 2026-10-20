/**
 * Vitrina 3D del robot para los menús: tornamesa con anillo de luz, iluminación de estudio
 * y rotación lenta. Usa su propio WebGLRenderer pequeño (canvas transparente) que se monta
 * dentro del contenedor del menú; solo dibuja mientras está visible.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { RobotSpec } from '../config/robots';
import type { Alliance } from '../core/types';
import { RobotView } from './RobotView';

export class Showroom {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private turntable = new THREE.Group();
  private robot: RobotView | null = null;
  private ring: THREE.Mesh;
  private angle = -0.6;
  private time = 0;
  private key = '';
  private host: HTMLElement | null = null;
  /** Distancia de cámara (más lejos en el panel chico de configuración). */
  private distance = 3.2;
  private dragging = false;
  private lastX = 0;
  private spin = 0.35;
  /** Renderer chico para miniaturas de la galería (se crea al primer uso). */
  private thumbRenderer: THREE.WebGLRenderer | null = null;
  private thumbs = new Map<string, string>();

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'showroom';
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    // Luces de estudio: principal cálida, contraluz frío y relleno
    const key = new THREE.SpotLight(0xfff2dc, 22, 12, Math.PI / 5, 0.5, 1.2);
    key.position.set(2.2, 3.4, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x9cc4ff, 1.6);
    rim.position.set(-2.5, 1.8, -2.5);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(0xdde6ff, 0x101012, 0.5));

    // Piso de la tornamesa (recibe sombra) y anillo amarillo
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.92, 64), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.915, 0.94, 96),
      new THREE.MeshBasicMaterial({ color: 0xf5c518, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.002;
    this.scene.add(floor, this.ring, this.turntable);

    // Arrastrar para girar el robot
    this.canvas.style.touchAction = 'none';
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.angle += (e.clientX - this.lastX) * 0.01;
      this.lastX = e.clientX;
    });
    const up = () => (this.dragging = false);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  /** Monta el canvas dentro de `host` (se re-dimensiona a su tamaño). */
  mount(host: HTMLElement, distance = 3.2): void {
    this.host = host;
    this.distance = distance;
    host.appendChild(this.canvas);
    this.resize();
  }

  unmount(): void {
    this.canvas.remove();
    this.host = null;
  }

  get visible(): boolean {
    return !!this.host && this.host.isConnected;
  }

  setRobot(spec: RobotSpec, alliance: Alliance): void {
    const k = JSON.stringify(spec) + alliance;
    if (k === this.key) return;
    this.key = k;
    if (this.robot) {
      this.turntable.remove(this.robot.group);
      this.robot.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
    }
    this.robot = new RobotView(spec, alliance);
    this.robot.marker.visible = false;
    this.robot.update(
      { intakeDeploy: 0.6, turretYaw: 0.4, hoodAngle: 1.0, climbHeight: 0, hopper: Math.min(spec.hopperCapacity, 14), enabled: true, wheelYaw: 0, wheelSpin: 0, intakeSpin: 0, flywheelSpin: 0 },
      0,
    );
    this.turntable.add(this.robot.group);
    // Pequeño "salto" de entrada al cambiar de robot
    this.turntable.scale.setScalar(0.85);
  }

  /**
   * Miniatura (data URL) del robot en la tornamesa, con ángulo fijo de 3/4. Se cachea.
   */
  async snapshot(spec: RobotSpec, alliance: Alliance, w = 360, h = 240): Promise<string> {
    const k = JSON.stringify(spec) + alliance + w + 'x' + h;
    const hit = this.thumbs.get(k);
    if (hit) return hit;
    const view = new RobotView(spec, alliance);
    await view.ready;
    if (!this.thumbRenderer) {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      r.setClearColor(0x000000, 0);
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 0.9;
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFShadowMap;
      this.thumbRenderer = r;
    }
    const r = this.thumbRenderer;
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    view.marker.visible = false;
    view.update(
      { intakeDeploy: 1, turretYaw: 0.5, hoodAngle: 1.0, climbHeight: 0, hopper: Math.min(spec.hopperCapacity, 30), enabled: true, wheelYaw: 0, wheelSpin: 0, intakeSpin: 0, flywheelSpin: 0 },
      0,
    );
    const saved = this.turntable.children.slice();
    for (const c of saved) this.turntable.remove(c);
    this.turntable.add(view.group);
    const rot = this.turntable.rotation.y;
    const sc = this.turntable.scale.x;
    this.turntable.rotation.y = -0.65;
    this.turntable.scale.setScalar(1);
    const cam = new THREE.PerspectiveCamera(30, w / h, 0.1, 50);
    const d = 1.85;
    cam.position.set(d * 0.74, d * 0.52, d * 0.74);
    cam.lookAt(0, 0.2, 0);
    r.render(this.scene, cam);
    const url = r.domElement.toDataURL('image/webp', 0.86);
    this.turntable.remove(view.group);
    view.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
    for (const c of saved) this.turntable.add(c);
    this.turntable.rotation.y = rot;
    this.turntable.scale.setScalar(sc);
    this.thumbs.set(k, url);
    return url;
  }

  private resize(): void {
    if (!this.host) return;
    const w = Math.max(10, this.host.clientWidth);
    const h = Math.max(10, this.host.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number): void {
    if (!this.visible) return;
    const w = this.host!.clientWidth;
    const h = this.host!.clientHeight;
    if (Math.abs(this.canvas.width - w * this.renderer.getPixelRatio()) > 2 || Math.abs(this.canvas.height - h * this.renderer.getPixelRatio()) > 2) this.resize();
    this.time += dt;
    if (!this.dragging) this.angle += dt * this.spin;
    this.turntable.rotation.y = this.angle;
    const s = this.turntable.scale.x;
    if (s < 1) this.turntable.scale.setScalar(Math.min(1, s + dt * 0.9));
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.15 * Math.sin(this.time * 2);
    if (this.robot)
      this.robot.update(
        { intakeDeploy: 0.6, turretYaw: 0.4 * Math.sin(this.time * 0.7), hoodAngle: 1.0, climbHeight: 0, hopper: Math.min(this.robot.spec.hopperCapacity, 14), enabled: true, wheelYaw: 0, wheelSpin: this.time * 2, intakeSpin: this.time * 6, flywheelSpin: this.time * 20 },
        this.time,
      );
    // Encuadre: el robot + la tornamesa caben siempre (más lejos si el panel es angosto)
    const d = this.distance * Math.max(1, 1.25 / Math.max(0.6, this.camera.aspect));
    this.camera.position.set(d * 0.74, d * 0.46, d * 0.74);
    this.camera.lookAt(0, 0.12, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
