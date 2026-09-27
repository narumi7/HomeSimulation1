// three.js のシーン・カメラ・操作（外観／内観／ウォークスルー）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { grassTexture } from './textures.js';
import { stairProgress } from './houseBuilder.js';

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

    this.hemi = new THREE.HemisphereLight('#ffffff', '#b8b0a0', 1.6);
    this.scene.add(this.hemi);
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
    this.ambient = new THREE.AmbientLight('#ffffff', 0.35);
    this.scene.add(this.ambient);
    // 太陽の向き（setSun で変える）。初期値は南東寄りの昼
    this.sunDir = new THREE.Vector3(0.45, 0.8, 0.4).normalize();

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
    this.selected = null;
    this.selectionBox = null;
    this.drag = null;
    this.setupFurnitureDrag();

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
      this.house.group.traverse((o) => {
        o.geometry?.dispose();
        if (o.isSprite) { o.material.map.dispose(); o.material.dispose(); }
      });
    }
    this.house = house;
    this.scene.add(house.group);
    this.minimap?.setHouse(house);

    const b = house.bounds;
    const size = b.getSize(new THREE.Vector3());
    const center = b.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.z, 6);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -r;
    sc.right = sc.top = r;
    sc.far = r * 8;
    sc.updateProjectionMatrix();
    this.placeSun();
    this.addRoomLabels(house);
    if (this.selected !== null) this.select(this.selected);

    if (this.floor >= house.levels.length) this.floor = 0;
    if (first) this.setMode(this.mode, true);
    else this.applyVisibility();
  }

  setMode(mode, resetCamera = true) {
    this.mode = mode;
    this.orbit.enabled = mode !== 'walk';
    this.camera.fov = mode === 'walk' ? 70 : 50;
    this.minimap?.show(mode === 'walk');
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
    // 家具の選択枠は「内観（上から）」のときだけ
    if (this.selectionBox) this.selectionBox.visible = this.mode === 'interior';
    // 部屋名と広さは「内観」で選んでいる階だけ
    group.traverse((o) => {
      if (o.name === 'room-labels') o.visible = this.mode === 'interior' && o.userData.floorIndex === this.floor;
    });
  }

  // ---- 部屋名・広さのラベル ----
  addRoomLabels(house) {
    for (const info of house.floors) {
      if (info.empty || !info.rooms) continue;
      const labels = new THREE.Group();
      labels.name = 'room-labels';
      labels.userData.floorIndex = info.index;
      for (const r of info.rooms) {
        if (!r.label || r.area < 1.2) continue;
        const sprite = makeLabelSprite(r.label, `${(r.area / 1.62).toFixed(1)}帖（${r.area.toFixed(1)}㎡）`);
        sprite.position.set(r.center[0], info.level + 0.9, r.center[1]);
        labels.add(sprite);
      }
      house.group.getObjectByName(`floor-${info.index}`)?.add(labels);
    }
  }

  // ---- 日当たり ----
  /**
   * 太陽の位置を設定する
   * @param {{upBearing:number, declination:number, hour:number, latitude?:number}} o
   *   upBearing: 間取り図の上が向いている方角（北=0, 東=90, 南=180, 西=270）
   *   declination: 太陽の赤緯（夏至 23.4 / 春分 0 / 冬至 -23.4）、hour: 時刻（太陽時）
   */
  setSun({ upBearing, declination, hour, latitude = 35.7 }) {
    const rad = Math.PI / 180;
    const phi = latitude * rad, dec = declination * rad, H = (hour - 12) * 15 * rad;
    const sinH = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
    const elev = Math.asin(sinH);
    // 南を 0 として西回りを正とした方位角 → 北から時計回りの方位角
    const azSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
    const bearing = Math.PI + azSouth;
    const t = bearing - upBearing * rad; // 間取り図の上から時計回りの角度
    this.sunDir.set(Math.cos(elev) * Math.sin(t), Math.sin(elev), -Math.cos(elev) * Math.cos(t));
    this.sunElevation = elev;
    this.northAngle = -upBearing * rad;
    this.minimap?.setNorth(this.northAngle);

    // 高さに応じて明るさと色を変える（夜は暗く、朝夕は赤く）
    const day = Math.max(0, Math.min(1, Math.sin(elev) * 3));
    this.sun.intensity = elev > 0 ? 0.4 + 2.2 * Math.min(1, Math.sin(elev) * 2) : 0;
    this.sun.color.set('#ffb070').lerp(new THREE.Color('#fff6e8'), Math.min(1, Math.sin(Math.max(elev, 0)) * 2.5));
    this.hemi.intensity = 0.35 + 1.25 * day;
    this.ambient.intensity = 0.15 + 0.2 * day;
    const sky = new THREE.Color('#1d2640').lerp(new THREE.Color('#e9b98f'), Math.min(1, day * 2)).lerp(new THREE.Color('#bcd8ef'), day);
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    this.placeSun();
  }

  placeSun() {
    const b = this.house?.bounds;
    const center = b ? b.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const r = b ? Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 6) : 20;
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(this.sunDir, r * 3);
  }

  // ---- 家具の選択・移動 ----
  setupFurnitureDrag() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const aim = (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
    };
    const shown = (o) => {
      for (let p = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    };
    // OrbitControls より先に受け取り、家具をつかんだときは回転させない
    this.container.addEventListener('pointerdown', (e) => {
      if (this.mode === 'walk' || !this.house || e.target !== el || e.button > 0) return;
      aim(e);
      const targets = [];
      this.house.group.traverse((o) => { if (o.isMesh && o.userData.furnitureIndex !== undefined && shown(o)) targets.push(o); });
      const hit = ray.intersectObjects(targets, false)[0];
      if (!hit) return;
      e.stopPropagation();
      const index = hit.object.userData.furnitureIndex;
      this.select(index);
      this.onSelectFurniture?.(index);
      const obj = this.furnitureObject(index);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -obj.position.y);
      const p = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (!p) return;
      this.drag = { index, obj, plane, dx: obj.position.x - p.x, dz: obj.position.z - p.z, moved: false };
      el.setPointerCapture(e.pointerId);
    }, true);
    el.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      aim(e);
      const p = ray.ray.intersectPlane(this.drag.plane, new THREE.Vector3());
      if (!p) return;
      const snap = (v) => Math.round(v / 0.05) * 0.05; // 5cm 刻み
      const { obj } = this.drag;
      obj.position.x = snap(p.x + this.drag.dx);
      obj.position.z = snap(p.z + this.drag.dz);
      this.drag.moved = true;
      const ok = this.onDragFurniture?.(this.drag.index, obj.position.x, obj.position.z) ?? true;
      this.updateSelectionBox(ok);
    });
    const end = () => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      if (d.moved) this.onMoveFurniture?.(d.index, d.obj.position.x, d.obj.position.z);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  furnitureObject(index) {
    let found = null;
    this.house?.group.traverse((o) => {
      if (!found && o.parent?.name === 'furniture' && o.userData.furnitureIndex === index) found = o;
    });
    return found;
  }

  /** 家具を選択（null で解除）。選択中は枠を表示する */
  select(index, ok = true) {
    this.selected = index;
    if (this.selectionBox) {
      this.scene.remove(this.selectionBox);
      this.selectionBox.geometry.dispose();
      this.selectionBox = null;
    }
    const obj = index === null ? null : this.furnitureObject(index);
    if (!obj) return;
    this.selectionBox = new THREE.BoxHelper(obj);
    this.selectionBox.material.depthTest = false;
    this.selectionBox.renderOrder = 10;
    this.selectionBox.visible = this.mode === 'interior';
    this.scene.add(this.selectionBox);
    this.updateSelectionBox(ok);
  }

  updateSelectionBox(ok = true) {
    if (!this.selectionBox) return;
    this.selectionBox.update();
    this.selectionBox.material.color.set(ok ? '#1fa85a' : '#e03b2f');
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
          if (!col.isInside(x, z) || this.blocked(x, z) || this.stairAt(x, z, this.floor) || this.stairAt(x, z, this.floor - 1)) continue;
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
    this.groundY = level;
    this.walk.yaw = best.yaw;
    this.walk.pitch = -0.05;
  }

  blocked(x, z, floor = this.floor) {
    const col = this.house?.colliders[floor];
    if (!col) return false;
    const r = 0.2;
    if (col.isBlocked(x - r, z - r) || col.isBlocked(x + r, z - r) || col.isBlocked(x - r, z + r) || col.isBlocked(x + r, z + r)) return true;
    // 家具にもぶつかる
    const obs = this.house.obstacles?.[floor] || [];
    return obs.some((o) => x > o.x0 - r && x < o.x1 + r && z > o.z0 - r && z < o.z1 + r);
  }

  /** ミニマップでタップした場所へ移動（今いる階の、歩ける場所だけ） */
  teleport(x, z) {
    if (this.mode !== 'walk' || !this.house) return false;
    const col = this.house.colliders[this.floor];
    if (!col || !col.isInside(x, z) || this.blocked(x, z) || this.stairAt(x, z, this.floor) || this.stairAt(x, z, this.floor - 1)) return false;
    const level = this.house.levels[this.floor];
    this.camera.position.set(x, level + EYE, z);
    this.groundY = level;
    return true;
  }

  /** 指定した階から上る階段のうち、(x, z) を含むもの */
  stairAt(x, z, floor) {
    return this.house?.stairs.find((st) => st.floor === floor && stairProgress(st, x, z) !== null) || null;
  }

  /**
   * (nx, nz) へ1歩進めるか判定し、進めるなら立っている高さと階を更新する。
   * 階段にいる間は「階段の下の階」を現在の階として扱う。
   */
  tryStep(nx, nz) {
    const f = this.floor;
    const p = this.camera.position;
    const levels = this.house.levels;
    const cur = this.stairAt(p.x, p.z, f);
    const next = this.stairAt(nx, nz, f);

    if (next) {
      const t = stairProgress(next, nx, nz);
      if (!cur && t > 0.35) return false; // 段の途中へ横から入らない
      // 上端付近は上の階の壁で当たり判定する
      if (this.blocked(nx, nz, t > 0.8 && levels[f + 1] !== undefined ? f + 1 : f)) return false;
      this.groundY = next.level + next.rise * t;
      return true;
    }
    if (cur) {
      // 階段から降りる：上端から出たら上の階へ
      const t0 = stairProgress(cur, p.x, p.z);
      const nf = t0 > 0.8 && levels[f + 1] !== undefined ? f + 1 : f;
      if (this.blocked(nx, nz, nf)) return false;
      this.changeFloor(nf);
      this.groundY = levels[nf];
      return true;
    }
    // 上の階から吹き抜け（下の階の階段）へ入る：上り口からだけ入れる
    const down = this.stairAt(nx, nz, f - 1);
    if (down) {
      const t = stairProgress(down, nx, nz);
      if (t < 0.85) return false; // 手すり
      this.changeFloor(f - 1);
      this.groundY = down.level + down.rise * t;
      return true;
    }
    if (this.blocked(nx, nz, f)) return false;
    this.groundY = levels[f];
    return true;
  }

  changeFloor(f) {
    if (f === this.floor) return;
    this.floor = f;
    this.onFloorChange?.(f);
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
    if (dx && this.tryStep(p.x + dx, p.z)) p.x += dx;
    if (dz && this.tryStep(p.x, p.z + dz)) p.z += dz;
    if (this.groundY === undefined) this.groundY = this.house.levels[this.floor];
    // 段差でガクッとしないよう、目線の高さをなめらかに追従させる
    const targetY = this.groundY + EYE;
    p.y += (targetY - p.y) * Math.min(1, dt * 12);
    this.camera.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.mode === 'walk' && this.house) {
      this.updateWalk(dt);
      const p = this.camera.position;
      this.minimap?.draw(this.floor, p.x, p.z, this.walk.yaw, this.camera.fov);
    }
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

/** 部屋名と広さを描いたラベル（常に手前に表示） */
function makeLabelSprite(title, sub) {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 112;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255, 255, 255, 0.88)';
  g.beginPath();
  g.roundRect(4, 4, 312, 104, 18);
  g.fill();
  g.fillStyle = '#2b2a28';
  g.textAlign = 'center';
  g.font = 'bold 42px sans-serif';
  g.fillText(title, 160, 48, 300);
  g.font = 'bold 30px sans-serif';
  g.fillStyle = '#8a4a1f';
  g.fillText(sub, 160, 92, 300);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // 画面上で常に同じ大きさに見えるようにする（カメラとの距離で小さくならない）
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  sprite.scale.set(0.15, 0.0525, 1);
  sprite.renderOrder = 5;
  return sprite;
}
