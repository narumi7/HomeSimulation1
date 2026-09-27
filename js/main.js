import * as THREE from 'three';
import { analyzePlan, detectOpenings, gridBounds, EMPTY, WALL, WINDOW, DOOR, ENTRANCE, STAIRS } from './planAnalyzer.js';
import { buildHouse } from './houseBuilder.js';
import { Viewer } from './viewer.js';
import { Minimap } from './minimap.js';
import { detectRooms, autoFurnish, buildFurniture, isPlacementOk, findFreeSpot, footprint, CATALOG } from './furniture.js';
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
// 家具のリスト [{floor, model, label, w, d, h?, cx, cz, rot}]（位置はワールド座標 m）
let furniture = [];
let selected = null;

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
  detectRooms(house);
  buildFurniture(house, furniture, clip);
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
  furniture = [];
  selected = null;
  updateSelectedPanel();
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
      const readyIndex = floors.filter((f) => f.plan).indexOf(floors[i]);
      if (readyIndex >= 0) {
        furniture = furniture.filter((it) => it.floor !== readyIndex).map((it) => (it.floor > readyIndex ? { ...it, floor: it.floor - 1 } : it));
      }
      selected = null;
      updateSelectedPanel();
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
/** 家具だけ作り直す（家全体は作り直さない） */
function refreshFurniture() {
  if (!viewer.house) return;
  buildFurniture(viewer.house, furniture, clip);
  viewer.minimap.setHouse(viewer.house);
  viewer.select(selected, selected === null || isPlacementOk(viewer.house, furniture, selected));
  updateSelectedPanel();
}

function selectFurniture(index) {
  selected = index;
  viewer.select(index, index === null || isPlacementOk(viewer.house, furniture, index));
  updateSelectedPanel();
}

function updateSelectedPanel() {
  const item = selected === null ? null : furniture[selected];
  $('selectedPanel').hidden = !item;
  if (!item) return;
  $('selName').textContent = `選択中：${item.label}（${floors.filter((f) => f.plan)[item.floor]?.name || ''}）`;
  $('selW').value = Math.round(item.w * 100);
  $('selD').value = Math.round(item.d * 100);
  $('selWarn').hidden = isPlacementOk(viewer.house, furniture, selected);
}

$('autoFurnishBtn').addEventListener('click', () => {
  if (!viewer.house) return toast('先に間取り図を読み込んでください。');
  furniture = autoFurnish(viewer.house);
  selected = null;
  refreshFurniture();
  toast(`部屋の広さや形に合わせて家具を ${furniture.length} 点配置しました。ドラッグで動かせます。`);
});
$('clearFurnitureBtn').addEventListener('click', () => {
  furniture = [];
  selected = null;
  refreshFurniture();
});

// 追加する家具の一覧
$('catalog').innerHTML = CATALOG.map((c, i) => `<option value="${i}">${escapeHtml(c.label)}</option>`).join('');
function syncCatalog() {
  const c = CATALOG[$('catalog').value];
  $('addW').value = Math.round(c.w * 100);
  $('addD').value = Math.round(c.d * 100);
  $('addH').value = Math.round((c.h || 0.8) * 100);
  $('addHWrap').style.visibility = c.model === 'custom' ? 'visible' : 'hidden';
}
$('catalog').addEventListener('change', syncCatalog);
syncCatalog();

$('addFurnitureBtn').addEventListener('click', () => {
  const house = viewer.house;
  if (!house) return toast('先に間取り図を読み込んでください。');
  const c = CATALOG[$('catalog').value];
  const cm = (id, def) => Math.max(0.1, (parseFloat($(id).value) || def * 100) / 100);
  const item = {
    floor: viewer.floor, model: c.model, label: c.label,
    w: cm('addW', c.w), d: cm('addD', c.d), cx: 0, cz: 0, rot: 0,
  };
  if (c.model === 'custom') {
    item.h = cm('addH', 0.8);
    item.label = `手持ちの家具 ${Math.round(item.w * 100)}×${Math.round(item.d * 100)}cm`;
  }
  // 今見ている場所の近くから、置ける場所を探す
  const p = viewer.mode === 'walk' ? viewer.camera.position : viewer.orbit.target;
  if (!findFreeSpot(house, furniture, item, p.x, p.z)) {
    return toast(`この階には ${Math.round(item.w * 100)}×${Math.round(item.d * 100)}cm の家具を置ける場所が見つかりませんでした。`);
  }
  furniture.push(item);
  selected = furniture.length - 1;
  if (viewer.mode === 'exterior') {
    document.querySelector('#viewMode [data-mode=interior]').click();
  }
  refreshFurniture();
  toast(`${item.label}を追加しました。ドラッグで好きな場所へ動かせます。`);
});

// 3Dビューでの選択・移動
viewer.onSelectFurniture = (index) => selectFurniture(index);
viewer.onDragFurniture = (index, x, z) => {
  const test = furniture.map((f, i) => (i === index ? { ...f, cx: x, cz: z } : f));
  return isPlacementOk(viewer.house, test, index);
};
viewer.onMoveFurniture = (index, x, z) => {
  Object.assign(furniture[index], { cx: x, cz: z });
  refreshFurniture();
  if (!isPlacementOk(viewer.house, furniture, index)) toast('壁・ドア・ほかの家具と重なっています。');
};

function rotateSelected() {
  const item = furniture[selected];
  if (!item) return;
  item.rot = (item.rot + Math.PI / 2) % (Math.PI * 2);
  refreshFurniture();
}
function deleteSelected() {
  if (selected === null) return;
  furniture.splice(selected, 1);
  selected = null;
  refreshFurniture();
}
$('rotateBtn').addEventListener('click', rotateSelected);
$('deleteBtn').addEventListener('click', deleteSelected);
$('deselectBtn').addEventListener('click', () => selectFurniture(null));
for (const [id, key] of [['selW', 'w'], ['selD', 'd']]) {
  $(id).addEventListener('change', () => {
    const item = furniture[selected];
    const v = parseFloat($(id).value);
    if (!item || !(v > 0)) return;
    item[key] = v / 100;
    refreshFurniture();
  });
}
window.addEventListener('keydown', (e) => {
  if (selected === null || viewer.mode === 'walk' || e.target.closest?.('input, select, textarea')) return;
  if (e.key === 'r' || e.key === 'R') rotateSelected();
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
  else if (e.key === 'Escape') selectFurniture(null);
});

// ---------- 日当たり ----------
function applySun() {
  const hour = parseFloat($('sunHour').value);
  const h = Math.floor(hour), m = Math.round((hour - h) * 60);
  $('sunHourVal').textContent = `${h}:${String(m).padStart(2, '0')}`;
  viewer.setSun({
    upBearing: parseFloat($('upBearing').value),
    declination: parseFloat($('season').value),
    hour,
  });
}
for (const id of ['upBearing', 'season']) $(id).addEventListener('change', applySun);
$('sunHour').addEventListener('input', applySun);
let sunTimer = 0;
$('sunPlayBtn').addEventListener('click', () => {
  if (sunTimer) {
    clearInterval(sunTimer);
    sunTimer = 0;
    $('sunPlayBtn').textContent = '▶ 1日の日当たりを再生';
    return;
  }
  $('sunPlayBtn').textContent = '■ 停止';
  let hour = 5;
  sunTimer = setInterval(() => {
    hour += 0.1;
    if (hour > 19) hour = 5;
    $('sunHour').value = hour;
    applySun();
  }, 60);
});
applySun();

// ---------- プロジェクトの保存・読み込み ----------
function imageToDataURL(img, type = 'image/png', max = 1600) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const sc = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * sc);
  c.height = Math.round(h * sc);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(type, 0.85);
}
function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function loadImageURL(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = url;
  });
}

const SETTING_IDS = ['wallHeight', 'sillHeight', 'headHeight', 'baseHeight', 'roofType', 'roofPitch', 'eaves', 'ridgeDir',
  'wallColor', 'roofColor', 'floorColor', 'upBearing', 'season', 'sunHour'];

$('saveBtn').addEventListener('click', () => {
  if (!floors.length) return toast('保存する間取りがありません。');
  const project = {
    app: 'HomeSimulation1',
    version: 1,
    settings: Object.fromEntries(SETTING_IDS.map((id) => [id, $(id).value])),
    photo: photo.img ? imageToDataURL(photo.img, 'image/jpeg', 800) : null,
    floors: floors.map((f) => {
      // 画像は解析したときと同じ大きさで保存し、読み込み時に同じグリッドを再現できるようにする
      const image = f.plan ? f.plan.canvas : f.image;
      return {
        name: f.name, image: imageToDataURL(image, 'image/png', 99999),
        threshold: f.threshold, thickness: f.thickness,
        widthM: f.widthM, bboxCells: f.bboxCells, offsetX: f.offsetX, offsetZ: f.offsetZ,
        plan: f.plan ? { cols: f.plan.cols, rows: f.plan.rows, grid: bytesToBase64(f.plan.grid), roomHints: f.plan.roomHints } : null,
      };
    }),
    furniture,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(project)], { type: 'application/json' }));
  download(url, 'my-house.json');
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('プロジェクトを保存しました。「保存したプロジェクトを開く」で続きから作業できます。');
});

$('openInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const project = JSON.parse(await file.text());
    if (project.app !== 'HomeSimulation1') throw new Error('このアプリで保存したファイルではありません');
    for (const [id, v] of Object.entries(project.settings || {})) if ($(id)) $(id).value = v;
    floors.length = 0;
    for (const sf of project.floors) {
      const img = await loadImageURL(sf.image);
      const f = {
        id: nextId++, name: sf.name, image: img, thumb: sf.image,
        threshold: sf.threshold, thickness: sf.thickness, widthM: sf.widthM,
        offsetX: sf.offsetX, offsetZ: sf.offsetZ, presetWidth: sf.widthM,
      };
      if (sf.plan) {
        const plan = analyzePlan(img, { threshold: f.threshold, thickness: f.thickness });
        if (plan.cols === sf.plan.cols && plan.rows === sf.plan.rows) {
          plan.grid.set(base64ToBytes(sf.plan.grid));
          plan.roomHints = sf.plan.roomHints || [];
          f.plan = plan;
          f.bboxCells = sf.bboxCells;
        } else {
          analyzeFloor(f, { keepWidth: true });
        }
      }
      floors.push(f);
    }
    furniture = project.furniture || [];
    selected = null;
    if (project.photo) {
      $('photoWrap').hidden = false;
      photo.setImage(await loadImageURL(project.photo));
    }
    $('useTexture').checked = false;
    updateMaterials();
    editIndex = 0;
    renderFloorList();
    rebuild();
    applySun();
    viewer.setMode(viewer.mode);
    updateSelectedPanel();
    toast('プロジェクトを開きました。');
  } catch (err) {
    toast(`開けませんでした：${err.message}`);
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
window.__app = { floors, viewer, rebuild, loadSample, DOOR, get furniture() { return furniture; }, footprint };
