// three.js のシーン・カメラ・操作（外観／内観／ウォークスルー）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { grassTexture } from './textures.js';

const EYE = 1.5;

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#bcd8ef');
    this.scene.fog = new THREE.Fog('#bcd8ef', 80, 220);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
    this.camera.position.set(14, 10, 18);

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b8b0a0', 1.6));
    const sun = new THREE.DirectionalLight('#fff6e8', 2.2);
    sun.position.set(15, 25, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -25;
    sc.right = sc.top = 25;
    sc.near = 1;
    sc.far = 80;
    this.sun = sun;
    this.scene.add(sun, sun.target);
    // 室内が暗くなりすぎないように
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.35));

    const grass = grassTexture();
    grass.repeat.set(60, 60);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.minDistance = 1;
    this.orbit.maxDistance = 120;

    this.house = null;
    this.mode = 'exterior';
    this.floor = 0;
    this.cutRatio = 1;

    this.walk = { yaw: 0, pitch: 0, keys: new Set(), pad: new Set(), dragging: false, lx: 0, ly: 0 };
    this.setupWalkInput();

    this.clock = new THREE.Clock();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 生成した家を差し替える（カメラは維持） */
  setHouse(house) {
    const first = !this.house;
    if (this.house) {
      this.scene.remove(this.house.group);
      this.house.group.traverse((o) => o.geometry?.dispose());
    }
    this.house = house;
    this.scene.add(house.group);

    const b = house.bounds;
    const size = b.getSize(new THREE.Vector3());
    const center = b.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.z, 6);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -r;
    sc.right = sc.top = r;
    sc.updateProjectionMatrix();
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).add(new THREE.Vector3(r * 0.7, r * 1.4, r * 0.6));

    if (this.floor >= house.levels.length) this.floor = 0;
    if (first) this.setMode(this.mode, true);
    else this.applyVisibility();
  }

  setMode(mode, resetCamera = true) {
    this.mode = mode;
    this.orbit.enabled = mode !== 'walk';
    this.camera.fov = mode === 'walk' ? 70 : 50;
    this.camera.updateProjectionMatrix();
    if (!this.house) return;
    const b = this.house.bounds;
    const center = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z, 6);
    if (resetCamera) {
      if (mode === 'exterior') {
        this.orbit.target.set(center.x, size.y * 0.4, center.z);
        this.camera.position.set(center.x + r * 0.9, r * 0.6 + 2, center.z + r * 1.3);
      } else if (mode === 'interior') {
        const y = this.house.levels[this.floor];
        this.orbit.target.set(center.x, y, center.z);
        this.camera.position.set(center.x + r * 0.15, y + r * 1.3 + 4, center.z + r * 0.55);
      } else if (mode === 'walk') {
        this.startWalk();
      }
      this.orbit.update();
    }
    this.applyVisibility();
  }

  setFloor(i) {
    this.floor = i;
    if (this.mode === 'walk') this.startWalk();
    else if (this.mode === 'interior') this.setMode('interior');
    else this.applyVisibility();
  }

  /** 0〜1：1で切断なし */
  setCut(ratio) {
    this.cutRatio = ratio;
    this.applyVisibility();
  }

  applyVisibility() {
    if (!this.house) return;
    const { group, levels, wallHeight } = this.house;
    const roof = group.getObjectByName('roof');
    let cutY = 1000;
    if (this.mode === 'interior') {
      // 選んだ階の腰から上を切り取り、上の階は隠す
      const base = levels[this.floor];
      cutY = base + 0.3 + (wallHeight - 0.3) * Math.min(this.cutRatio, 0.99) * 0.75;
    } else if (this.mode === 'exterior' && this.cutRatio < 1) {
      const top = this.house.bounds.max.y;
      cutY = top * this.cutRatio;
    }
    this.clipPlane.constant = cutY;
    for (const child of group.children) {
      if (child.name === 'roof') continue;
      const i = child.userData.floorIndex;
      child.visible = this.mode === 'exterior' || this.mode === 'walk' || i <= this.floor;
    }
    if (roof) roof.visible = this.mode !== 'interior';
  }

  // ---- ウォークスルー ----
  setupWalkInput() {
    const el = this.renderer.domElement;
    const w = this.walk;
    el.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'walk') return;
      w.dragging = true; w.lx = e.clientX; w.ly = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (this.mode !== 'walk' || !w.dragging) return;
      w.yaw -= (e.clientX - w.lx) * 0.005;
      w.pitch -= (e.clientY - w.ly) * 0.005;
      w.pitch = Math.max(-1.3, Math.min(1.3, w.pitch));
      w.lx = e.clientX; w.ly = e.clientY;
    });
    const end = () => { w.dragging = false; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    window.addEventListener('keydown', (e) => {
      if (this.mode !== 'walk' || e.target.closest?.('input, select, textarea')) return;
      w.keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => w.keys.delete(e.code));
    window.addEventListener('blur', () => w.keys.clear());
  }

  bindPad(pad) {
    for (const btn of pad.querySelectorAll('button')) {
      const dir = btn.dataset.dir;
      const on = (e) => { e.preventDefault(); this.walk.pad.add(dir); };
      const off = () => this.walk.pad.delete(dir);
      btn.addEventListener('pointerdown', on);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointerleave', off);
      btn.addEventListener('pointercancel', off);
    }
  }

  startWalk() {
    if (!this.house) return;
    const col = this.house.colliders[this.floor];
    const level = this.house.levels[this.floor];
    const b = this.house.bounds;
    const center = b.getCenter(new THREE.Vector3());
    let best = { x: center.x, z: center.z, yaw: 0, score: -1 };
    if (col) {
      // 室内でいちばん広く見渡せる場所と向きを探す
      const ray = (x, z, dx, dz) => {
        let d = 0;
        while (d < 12 && !this.blocked(x + dx * d, z + dz * d) && col.isInside(x + dx * d, z + dz * d)) d += 0.2;
        return d;
      };
      for (let x = b.min.x; x <= b.max.x; x += 0.4) {
        for (let z = b.min.z; z <= b.max.z; z += 0.4) {
          if (!col.isInside(x, z) || this.blocked(x, z)) continue;
          let minD = Infinity, sum = 0, vx = 0, vz = 0;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const d = ray(x, z, -Math.sin(a), -Math.cos(a));
            minD = Math.min(minD, d);
            sum += d;
            vx += -Math.sin(a) * d * d;
            vz += -Math.cos(a) * d * d;
          }
          const score = minD * 2 + sum / 8;
          // 見通しのよい方向（遠くまで開けている側）を向く
          if (score > best.score) best = { x, z, yaw: Math.atan2(-vx, -vz), score };
        }
      }
    }
    this.camera.position.set(best.x, level + EYE, best.z);
    this.walk.yaw = best.yaw;
    this.walk.pitch = -0.05;
  }

  blocked(x, z) {
    const col = this.house?.colliders[this.floor];
    if (!col) return false;
    const r = 0.2;
    return col.isBlocked(x - r, z - r) || col.isBlocked(x + r, z - r) || col.isBlocked(x - r, z + r) || col.isBlocked(x + r, z + r);
  }

  updateWalk(dt) {
    const w = this.walk;
    const k = (c) => w.keys.has(c);
    let f = 0, s = 0;
    if (k('KeyW') || k('ArrowUp') || w.pad.has('fwd')) f += 1;
    if (k('KeyS') || k('ArrowDown') || w.pad.has('back')) f -= 1;
    if (k('KeyD') || w.pad.has('right')) s += 1;
    if (k('KeyA') || w.pad.has('left')) s -= 1;
    if (k('ArrowLeft')) w.yaw += dt * 1.8;
    if (k('ArrowRight')) w.yaw -= dt * 1.8;
    const speed = (k('ShiftLeft') || k('ShiftRight') ? 3.2 : 1.5) * dt;
    const fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw);
    const dx = (fx * f + -fz * s) * speed;
    const dz = (fz * f + fx * s) * speed;
    const p = this.camera.position;
    if (!this.blocked(p.x + dx, p.z)) p.x += dx;
    if (!this.blocked(p.x, p.z + dz)) p.z += dz;
    p.y = this.house.levels[this.floor] + EYE;
    this.camera.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.mode === 'walk' && this.house) this.updateWalk(dt);
    else this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  exportGLB() {
    return new Promise((resolve, reject) => {
      new GLTFExporter().parse(this.house.group, resolve, reject, { binary: true });
    });
  }
}
