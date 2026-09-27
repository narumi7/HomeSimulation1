import * as THREE from 'three';
import { analyzePlan, detectOpenings, gridBounds, EMPTY, WALL, WINDOW, DOOR, ENTRANCE, STAIRS } from './planAnalyzer.js';
import { buildHouse } from './houseBuilder.js';
import { Viewer } from './viewer.js';
import { Minimap } from './minimap.js';
import { furnishHouse } from './furniture.js';
import { PhotoPanel } from './photo.js';
import { samplePlans, sampleExterior } from './sample.js';
import { sidingTexture, roofTexture, floorTexture, photoTexture } from './textures.js';

const $ = (id) => document.getElementById(id);

// ---------- 状態 ----------
const floors = [];
let nextId = 1;
let editIndex = 0;
let dirty = false;

// ---------- 3D ----------
const viewer = new Viewer($('viewer'));
viewer.bindPad($('walkPad'));
// ミニマップ：タップした場所へ移動できる
viewer.minimap = new Minimap($('minimap'), (x, z) => {
  if (!viewer.teleport(x, z)) toast('そこへは移動できません（壁・家具・別の階など）');
});
let furnished = false;

const clip = { clippingPlanes: [viewer.clipPlane], clipShadows: true, side: THREE.DoubleSide };
const siding = sidingTexture();
const roofTex = roofTexture();
const floorTex = floorTexture();
let wallPhotoTex = null;

const mats = {
  building: [
    new THREE.MeshStandardMaterial({ ...clip, map: siding, roughness: 0.85 }),               // 外壁
    new THREE.MeshStandardMaterial({ ...clip, color: '#f3f0ea', roughness: 0.95 }),          // 内壁
    new THREE.MeshStandardMaterial({ ...clip, map: floorTex, roughness: 0.6 }),               // 床
    new THREE.MeshStandardMaterial({ ...clip, color: '#fbfaf7', roughness: 1 }),              // 天井
    new THREE.MeshStandardMaterial({ ...clip, map: roofTex, roughness: 0.7 }),                // 屋根
    new THREE.MeshStandardMaterial({ ...clip, color: '#a7a6a2', roughness: 1 }),              // 基礎
    new THREE.MeshStandardMaterial({ ...clip, color: '#4b4b48', roughness: 0.5 }),            // 枠・鼻隠し
    new THREE.MeshStandardMaterial({ ...clip, color: '#6b4a31', roughness: 0.6 }),            // 玄関ドア
  ],
  glass: new THREE.MeshStandardMaterial({
    ...clip, color: '#a9d2ee', transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2, depthWrite: false,
  }),
};

function updateMaterials() {
  const [ext, , floor, , roof] = mats.building;
  const useTex = $('useTexture').checked && wallPhotoTex;
  ext.map = useTex ? wallPhotoTex : siding;
  ext.color.set(useTex ? '#ffffff' : $('wallColor').value);
  ext.needsUpdate = true;
  roof.color.set($('roofColor').value);
  floor.color.set($('floorColor').value);
}
updateMaterials();

function settings() {
  const num = (id) => parseFloat($(id).value) || 0;
  return {
    wallHeight: Math.max(1.8, num('wallHeight')),
    sillHeight: num('sillHeight'),
    headHeight: num('headHeight'),
    baseHeight: num('baseHeight'),
    roofType: $('roofType').value,
    roofPitch: num('roofPitch'),
    eaves: num('eaves'),
    ridgeDir: $('ridgeDir').value,
  };
}

function rebuild() {
  dirty = false;
  const ready = floors.filter((f) => f.plan);
  $('emptyMsg').hidden = ready.length > 0;
  if (!ready.length) return;
  const s = settings();
  s.headHeight = Math.min(s.headHeight, s.wallHeight - 0.05);
  s.sillHeight = Math.min(s.sillHeight, s.headHeight - 0.1);
  const house = buildHouse(ready.map((f) => ({
    plan: f.plan,
    name: f.name,
    metersPerCell: f.widthM / f.bboxCells,
    offsetX: f.offsetX,
    offsetZ: f.offsetZ,
  })), s, mats);
  if (furnished) furnishHouse(house, clip);
  viewer.setHouse(house);
  refreshFloorSelects();
}

let rebuildTimer = 0;
function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, 150);
}

// ---------- 間取り図の読み込みと解析 ----------
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = url;
  });
}

function analyzeFloor(f, { keepWidth = false } = {}) {
  const plan = analyzePlan(f.image, { threshold: f.threshold, thickness: f.thickness });
  const bb = gridBounds(plan.grid, plan.cols, plan.rows);
  if (!bb) {
    f.plan = null;
    toast(`${f.name}：壁が見つかりませんでした。「間取りを調整」で線の濃さを変えてみてください。`);
    return;
  }
  f.bboxCells = bb.x1 - bb.x0 + 1;
  if (!keepWidth || !f.widthM) {
    // 壁の厚みを約17cmと仮定して建物の横幅を推定（あとから入力で直せる）
    const est = (f.bboxCells * plan.cellPx) / plan.thickness * 0.17;
    f.widthM = Math.round((f.presetWidth || Math.max(4, Math.min(40, est))) * 100) / 100;
  }
  detectOpenings(plan, f.widthM / f.bboxCells);

  // サンプルでは玄関と階段の位置があらかじめ分かっているので、その場所を塗っておく
  const sc = plan.width / (f.image.naturalWidth || f.image.width);
  const markCells = (rects, type, canOverwrite) => {
    for (const [x0, y0, x1, y1] of rects || []) {
      for (let y = Math.floor(y0 * sc / plan.cellPx); y <= Math.floor(y1 * sc / plan.cellPx); y++) {
        for (let x = Math.floor(x0 * sc / plan.cellPx); x <= Math.floor(x1 * sc / plan.cellPx); x++) {
          const i = y * plan.cols + x;
          if (x >= 0 && y >= 0 && x < plan.cols && y < plan.rows && canOverwrite.includes(plan.grid[i])) plan.grid[i] = type;
        }
      }
    }
  };
  markCells(f.entrances, ENTRANCE, [WINDOW, EMPTY]);
  markCells(f.stairs, STAIRS, [EMPTY]);
  plan.roomHints = (f.rooms || []).map(([name, x, y]) => ({
    name,
    cell: [Math.floor(x * sc / plan.cellPx), Math.floor(y * sc / plan.cellPx)],
  }));
  f.plan = plan;
}

async function addFloorImages(items) {
  for (const it of items) {
    const f = {
      id: nextId++,
      name: it.name || `${floors.length + 1}階`,
      image: it.image,
      thumb: it.thumb,
      threshold: 130,
      thickness: 0,
      offsetX: 0,
      offsetZ: 0,
      presetWidth: it.widthM || 0,
      entrances: it.entrances || null,
      stairs: it.stairs || null,
      rooms: it.rooms || null,
    };
    analyzeFloor(f);
    floors.push(f);
  }
  renderFloorList();
  rebuild();
  if (viewer.mode !== 'walk') viewer.setMode(viewer.mode);
}

$('planInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  try {
    const items = [];
    for (const file of files) {
      const img = await loadImage(file);
      items.push({ image: img, thumb: img.src });
    }
    await addFloorImages(items);
    toast('間取り図を読み込みました。建物の横幅（m）を実際の寸法に合わせてください。');
  } catch (err) {
    toast(err.message);
  }
});

async function loadSample() {
  floors.length = 0;
  const plans = samplePlans();
  await addFloorImages(plans.map((p) => ({ name: p.name, image: p.canvas, thumb: p.canvas.toDataURL(), widthM: p.widthM, entrances: p.entrances, stairs: p.stairs, rooms: p.rooms })));
  setPhoto(sampleExterior());
  toast('サンプルの家を表示しました。「ウォークスルー」で中を歩けます。');
}
$('sampleBtn').addEventListener('click', loadSample);
$('sampleBtn2').addEventListener('click', loadSample);

// ---------- 階リスト ----------
function renderFloorList() {
  const list = $('floorList');
  list.innerHTML = '';
  floors.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'floor-item';
    item.innerHTML = `
      <div class="head"><strong></strong><button class="del" title="削除">×</button></div>
      <img alt="">
      <div class="fields">
        <label>建物の横幅 (m)<input type="number" step="0.1" min="1" data-k="widthM"></label>
        <label>階の名前<input type="text" data-k="name"></label>
        <label>左右にずらす (m)<input type="number" step="0.1" data-k="offsetX"></label>
        <label>前後にずらす (m)<input type="number" step="0.1" data-k="offsetZ"></label>
      </div>`;
    item.querySelector('strong').textContent = f.plan ? f.name : `${f.name}（壁が未検出）`;
    item.querySelector('img').src = f.thumb;
    for (const input of item.querySelectorAll('input')) {
      const k = input.dataset.k;
      input.value = f[k];
      input.addEventListener('change', () => {
        if (k === 'name') f.name = input.value || f.name;
        else f[k] = parseFloat(input.value) || 0;
        if (k === 'widthM' && f.widthM <= 0) f.widthM = 1;
        if (k === 'name') { item.querySelector('strong').textContent = f.name; refreshFloorSelects(); }
        else scheduleRebuild();
      });
    }
    item.querySelector('.del').addEventListener('click', () => {
      floors.splice(i, 1);
      if (editIndex >= floors.length) editIndex = Math.max(0, floors.length - 1);
      renderFloorList();
      rebuild();
      drawEditor();
    });
    list.append(item);
  });
  refreshFloorSelects();
}

function refreshFloorSelects() {
  const ready = floors.filter((f) => f.plan);
  const vf = $('viewFloor');
  const cur = viewer.floor;
  vf.innerHTML = ready.map((f, i) => `<option value="${i}">${escapeHtml(f.name)}</option>`).join('');
  vf.value = String(Math.min(cur, Math.max(0, ready.length - 1)));
  const ef = $('editFloor');
  ef.innerHTML = floors.map((f, i) => `<option value="${i}">${escapeHtml(f.name)}</option>`).join('');
  ef.value = String(editIndex);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 建物の設定 ----------
for (const id of ['wallHeight', 'sillHeight', 'headHeight', 'baseHeight', 'roofType', 'roofPitch', 'eaves', 'ridgeDir']) {
  $(id).addEventListener('change', scheduleRebuild);
}

// ---------- 外観写真 ----------
const photo = new PhotoPanel($('photoCanvas'), {
  onColor(kind, hex) {
    $(kind === 'roof' ? 'roofColor' : 'wallColor').value = hex;
    if (kind === 'wall') $('useTexture').checked = false;
    updateMaterials();
  },
  onTexture(canvas) {
    wallPhotoTex?.dispose();
    wallPhotoTex = photoTexture(canvas);
    const tileW = 2; // 切り取った範囲を約2m幅として貼る
    wallPhotoTex.repeat.set(1 / tileW, 1 / (tileW * canvas.height / canvas.width));
    $('useTexture').disabled = false;
    $('useTexture').checked = true;
    updateMaterials();
    toast('外壁に写真の模様を貼りました。');
  },
});

function setPhoto(img) {
  $('photoWrap').hidden = false;
  photo.setImage(img);
  const c = photo.autoColors();
  if (c) {
    $('wallColor').value = c.wall;
    $('roofColor').value = c.roof;
  }
  $('useTexture').checked = false;
  updateMaterials();
}

$('photoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    setPhoto(await loadImage(file));
    toast('写真から外壁と屋根の色を読み取りました。違う場合は写真をクリックして選び直せます。');
  } catch (err) {
    toast(err.message);
  }
});

segmented($('pickMode'), 'mode', (m) => { photo.mode = m; });
for (const id of ['wallColor', 'roofColor', 'floorColor']) $(id).addEventListener('input', updateMaterials);
$('useTexture').addEventListener('change', updateMaterials);

// ---------- 表示モード ----------
segmented($('viewMode'), 'mode', (m) => {
  viewer.setMode(m);
  $('walkHelp').hidden = m !== 'walk';
  $('walkPad').hidden = m !== 'walk';
});
$('viewFloor').addEventListener('change', (e) => viewer.setFloor(parseInt(e.target.value, 10)));
// ウォークスルーで階段を上り下りしたら、階の表示も切り替える
viewer.onFloorChange = (f) => { $('viewFloor').value = String(f); };
$('cutHeight').addEventListener('input', (e) => viewer.setCut(e.target.value / 100));

// ---------- 家具 ----------
$('furnishBtn').addEventListener('click', () => {
  if (!floors.some((f) => f.plan)) return toast('先に間取り図を読み込んでください。');
  furnished = !furnished;
  $('furnishBtn').textContent = furnished ? '家具を片付ける' : '家具を配置';
  $('furnishBtn').classList.toggle('active', furnished);
  rebuild();
  if (furnished) {
    const n = viewer.house.obstacles.reduce((a, o) => a + o.length, 0);
    toast(`部屋の広さや形に合わせて家具を ${n} 点配置しました。`);
  }
});

// ---------- タブ ----------
segmented(document.querySelector('.tabs'), 'tab', (t) => {
  $('viewTab').hidden = t !== 'view';
  $('editTab').hidden = t !== 'edit';
  if (t === 'view' && dirty) rebuild();
  if (t === 'edit') drawEditor();
});

// ---------- 間取りエディタ ----------
const editCanvas = $('editCanvas');
const ectx = editCanvas.getContext('2d');
let tool = WALL;
const COLORS = {
  [WALL]: 'rgba(220, 50, 40, 0.55)',
  [WINDOW]: 'rgba(40, 120, 230, 0.7)',
  [DOOR]: 'rgba(40, 170, 80, 0.7)',
  [ENTRANCE]: 'rgba(240, 150, 20, 0.85)',
  [STAIRS]: 'rgba(150, 70, 200, 0.6)',
};

function currentFloor() { return floors[editIndex]; }

function syncEditControls() {
  const f = currentFloor();
  if (!f) return;
  $('threshold').value = f.threshold;
  $('thickness').value = f.thickness;
  $('thicknessVal').textContent = f.thickness ? `${f.thickness}px` : `自動${f.plan ? `(${f.plan.thickness}px)` : ''}`;
}

function drawEditor() {
  const f = currentFloor();
  syncEditControls();
  if (!f) { editCanvas.width = editCanvas.height = 1; return; }
  const src = f.plan?.canvas || f.image;
  const w = f.plan ? f.plan.width : (src.naturalWidth || src.width);
  const h = f.plan ? f.plan.height : (src.naturalHeight || src.height);
  editCanvas.width = w;
  editCanvas.height = h;
  const maxW = editCanvas.parentElement.clientWidth - 24;
  editCanvas.style.width = `${Math.min(w, Math.max(200, maxW))}px`;
  ectx.fillStyle = '#fff';
  ectx.fillRect(0, 0, w, h);
  if ($('showPlan').checked) {
    ectx.globalAlpha = 0.6;
    ectx.drawImage(src, 0, 0, w, h);
    ectx.globalAlpha = 1;
  }
  if (!f.plan) return;
  const { cols, rows, grid, cellPx } = f.plan;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const t = grid[y * cols + x];
      if (!t) continue;
      ectx.fillStyle = COLORS[t];
      ectx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
    }
  }
}

let painting = false;
function paintAt(e) {
  const f = currentFloor();
  if (!f?.plan) return;
  const r = editCanvas.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * editCanvas.width;
  const py = ((e.clientY - r.top) / r.height) * editCanvas.height;
  const { cols, rows, grid, cellPx } = f.plan;
  const size = parseInt($('brushSize').value, 10);
  const cx = Math.floor(px / cellPx - (size - 1) / 2);
  const cy = Math.floor(py / cellPx - (size - 1) / 2);
  for (let y = cy; y < cy + size; y++) {
    for (let x = cx; x < cx + size; x++) {
      if (x >= 0 && y >= 0 && x < cols && y < rows) grid[y * cols + x] = tool;
    }
  }
  dirty = true;
  drawEditor();
}
editCanvas.addEventListener('pointerdown', (e) => { painting = true; editCanvas.setPointerCapture(e.pointerId); paintAt(e); });
editCanvas.addEventListener('pointermove', (e) => { if (painting) paintAt(e); });
editCanvas.addEventListener('pointerup', () => { painting = false; });
editCanvas.addEventListener('pointercancel', () => { painting = false; });

segmented($('editTool'), 'tool', (t) => { tool = parseInt(t, 10); });
$('editFloor').addEventListener('change', (e) => { editIndex = parseInt(e.target.value, 10); drawEditor(); });
$('showPlan').addEventListener('change', drawEditor);
$('thickness').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10);
  $('thicknessVal').textContent = v ? `${v}px` : '自動';
});
$('reanalyzeBtn').addEventListener('click', () => {
  const f = currentFloor();
  if (!f) return;
  f.threshold = parseInt($('threshold').value, 10);
  f.thickness = parseInt($('thickness').value, 10);
  analyzeFloor(f, { keepWidth: true });
  renderFloorList();
  drawEditor();
  dirty = true;
});

// ---------- 書き出し ----------
function download(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}
$('exportBtn').addEventListener('click', async () => {
  if (!viewer.house) return toast('先に間取り図を読み込んでください。');
  const buf = await viewer.exportGLB();
  const url = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
  download(url, 'house.glb');
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});
$('shotBtn').addEventListener('click', () => {
  if (!viewer.house) return toast('先に間取り図を読み込んでください。');
  download(viewer.screenshot(), 'house.png');
});

// ---------- 共通 ----------
function segmented(root, key, onChange) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !root.contains(btn) || btn.dataset[key] === undefined) return;
    for (const b of root.querySelectorAll('button')) b.classList.toggle('active', b === btn);
    onChange(btn.dataset[key]);
  });
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// デバッグ・テスト用
window.__app = { floors, viewer, rebuild, loadSample, DOOR };
