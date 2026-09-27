// グリッド化した間取りから3Dの家を組み立てる
import * as THREE from 'three';
import { EMPTY, WALL, WINDOW, DOOR, ENTRANCE, STAIRS, computeOutside, gridBounds, mergeRects } from './planAnalyzer.js';

// マテリアル番号
export const M = {
  WALL_EXT: 0,
  WALL_INT: 1,
  FLOOR: 2,
  CEIL: 3,
  ROOF: 4,
  FOUNDATION: 5,
  FRAME: 6,
  DOOR: 7,
};
const MAT_COUNT = 8;

const SLAB = 0.25;

/** 三角形を材質ごとに溜めていくビルダー */
class MeshBuilder {
  constructor() {
    this.pos = Array.from({ length: MAT_COUNT }, () => []);
    this.nrm = Array.from({ length: MAT_COUNT }, () => []);
    this.uv = Array.from({ length: MAT_COUNT }, () => []);
  }

  tri(m, a, b, c) {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const n = ab.cross(ac);
    if (n.lengthSq() < 1e-12) return;
    n.normalize();
    for (const p of [a, b, c]) {
      this.pos[m].push(p.x, p.y, p.z);
      this.nrm[m].push(n.x, n.y, n.z);
      const [u, v] = planarUV(p, n);
      this.uv[m].push(u, v);
    }
  }

  /** a→b→c→d の順に並んだ四角形 */
  quad(m, a, b, c, d) {
    this.tri(m, a, b, c);
    this.tri(m, a, c, d);
  }

  /** 箱。face(name) が材質番号（-1 で省略）を返す */
  box(x0, x1, y0, y1, z0, z1, face) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const f = (name, pts) => { const m = face(name); if (m >= 0) this.quad(m, ...pts); };
    f('nz', [V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0)]);
    f('pz', [V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1)]);
    f('nx', [V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0)]);
    f('px', [V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1)]);
    f('py', [V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0)]);
    f('ny', [V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1)]);
  }

  toMesh(materials) {
    const geo = new THREE.BufferGeometry();
    const P = [], N = [], U = [];
    let start = 0;
    for (let m = 0; m < MAT_COUNT; m++) {
      const count = this.pos[m].length / 3;
      if (!count) continue;
      P.push(this.pos[m]);
      N.push(this.nrm[m]);
      U.push(this.uv[m]);
      geo.addGroup(start, count, m);
      start += count;
    }
    if (!start) return null;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(flat(P), 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(flat(N), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(flat(U), 2));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

function flat(list) {
  let n = 0;
  for (const a of list) n += a.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const a of list) { out.set(a, o); o += a.length; }
  return out;
}

/** 面の向きに合わせてメートル単位のUVを付ける */
function planarUV(p, n) {
  if (Math.abs(n.y) > 0.95) return [p.x, p.z];
  const h = Math.hypot(n.x, n.z);
  const hx = n.x / h, hz = n.z / h;
  const u = p.x * -hz + p.z * hx;
  if (Math.abs(n.y) < 0.05) return [u, p.y];
  return [u, p.x * hx + p.z * hz];
}

/**
 * @param {Array} floors  各階のデータ [{plan:{cols,rows,grid}, metersPerCell, offsetX, offsetZ}]
 * @param {object} s  設定（wallHeight, sillHeight, headHeight, baseHeight, roofType, roofPitch, eaves, ridgeDir）
 * @param {object} mats  マテリアル { building: 建物用の配列, glass: ガラス用 }
 */
export function buildHouse(floors, s, mats) {
  const root = new THREE.Group();
  const levels = [];
  const colliders = [];
  const stairs = [];
  const H = s.wallHeight;
  const RISE = H + SLAB; // 1階分の高さ（床から上の階の床まで）
  let topBox = null;
  let topY = 0;
  const bounds = new THREE.Box3();

  // 先に各階の座標変換と外部判定を用意しておく（階段の向きや吹き抜けの判定で上下の階を参照するため）
  const infos = floors.map((fl, idx) => {
    const level = s.baseHeight + idx * RISE;
    const { cols, rows, grid } = fl.plan;
    const m = fl.metersPerCell;
    const bb = gridBounds(grid, cols, rows);
    if (!bb) return { level, empty: true };
    const cx = (bb.x0 + bb.x1 + 1) / 2;
    const cz = (bb.y0 + bb.y1 + 1) / 2;
    const outside = computeOutside(grid, cols, rows, Math.max(1, Math.round(0.5 / m)));
    const at = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows) ? EMPTY : grid[y * cols + x];
    const isOut = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows) ? true : !!outside[y * cols + x];
    const toCell = (wx, wz) => [Math.floor((wx - fl.offsetX) / m + cx), Math.floor((wz - fl.offsetZ) / m + cz)];
    return {
      level, cols, rows, grid, m, bb, outside, at, isOut, toCell,
      X: (x) => (x - cx) * m + fl.offsetX,
      Z: (y) => (y - cz) * m + fl.offsetZ,
      // 人が立てる場所か（建物の内側で、壁・窓などがない）
      walkable(wx, wz) {
        const [x, y] = toCell(wx, wz);
        const t = at(x, y);
        return !isOut(x, y) && (t === EMPTY || t === DOOR || t === STAIRS);
      },
    };
  });

  // 階段：上の階がある階だけ。上の階で床につながる側を「上り口の反対＝上端」にする
  const stairsByFloor = infos.map(() => []);
  infos.forEach((info, idx) => {
    const upper = infos[idx + 1];
    if (info.empty || !upper || upper.empty) return;
    for (const r of mergeRects(info.cols, info.rows, (i) => info.grid[i] === STAIRS)) {
      const x0 = info.X(r.x), x1 = info.X(r.x + r.w), z0 = info.Z(r.y), z1 = info.Z(r.y + r.h);
      const axis = (x1 - x0) >= (z1 - z0) ? 'x' : 'z';
      const probe = (sign) => {
        // 端のすぐ外側の数点で、上の階・下の階が歩けるかを数える
        let up = 0, low = 0;
        for (let k = 0.2; k < 1; k += 0.2) {
          const px = axis === 'x' ? (sign > 0 ? x1 + 0.15 : x0 - 0.15) : x0 + (x1 - x0) * k;
          const pz = axis === 'z' ? (sign > 0 ? z1 + 0.15 : z0 - 0.15) : z0 + (z1 - z0) * k;
          if (upper.walkable(px, pz)) up++;
          if (info.walkable(px, pz)) low++;
        }
        return up * 2 - low;
      };
      const dir = probe(1) >= probe(-1) ? 1 : -1;
      const st = { floor: idx, x0, x1, z0, z1, axis, dir, level: info.level, rise: RISE };
      stairs.push(st);
      stairsByFloor[idx].push(st);
    }
  });

  floors.forEach((fl, idx) => {
    const info = infos[idx];
    const level = info.level;
    if (info.empty) { levels.push(level); colliders.push(null); return; }
    const { cols, rows, grid, outside, at, isOut, X, Z } = info;
    const hasUpper = idx + 1 < infos.length && !infos[idx + 1].empty;
    const below = idx > 0 ? stairsByFloor[idx - 1] : [];

    const group = new THREE.Group();
    group.name = `floor-${idx}`;
    group.userData.floorIndex = idx;
    const b = new MeshBuilder();
    const glassB = new MeshBuilder();

    // 面の外側にあるセルを調べて「外壁／内壁／省略」を決める
    const sideCells = (r, name) => {
      const cells = [];
      if (name === 'nz') for (let x = r.x; x < r.x + r.w; x++) cells.push([x, r.y - 1]);
      if (name === 'pz') for (let x = r.x; x < r.x + r.w; x++) cells.push([x, r.y + r.h]);
      if (name === 'nx') for (let y = r.y; y < r.y + r.h; y++) cells.push([r.x - 1, y]);
      if (name === 'px') for (let y = r.y; y < r.y + r.h; y++) cells.push([r.x + r.w, y]);
      return cells;
    };
    const wallFace = (r, capMat) => (name) => {
      if (name === 'py') return capMat;
      if (name === 'ny') return -1;
      const cells = sideCells(r, name);
      if (cells.every(([x, y]) => at(x, y) === WALL)) return -1;
      const out = cells.filter(([x, y]) => isOut(x, y)).length;
      return out * 2 >= cells.length ? M.WALL_EXT : M.WALL_INT;
    };
    const rx = (r) => [X(r.x), X(r.x + r.w)];
    const rz = (r) => [Z(r.y), Z(r.y + r.h)];

    // 壁
    for (const r of mergeRects(cols, rows, (i) => grid[i] === WALL)) {
      b.box(...rx(r), level, level + H, ...rz(r), wallFace(r, M.WALL_INT));
    }
    // 窓：腰壁＋垂れ壁＋ガラス＋枠
    for (const r of mergeRects(cols, rows, (i) => grid[i] === WINDOW)) {
      const [x0, x1] = rx(r), [z0, z1] = rz(r);
      b.box(x0, x1, level, level + s.sillHeight, z0, z1, wallFace(r, M.FRAME));
      b.box(x0, x1, level + s.headHeight, level + H, z0, z1, wallFace(r, M.WALL_INT));
      addGlass(b, glassB, x0, x1, z0, z1, level + s.sillHeight, level + s.headHeight);
    }
    // ドア・玄関：垂れ壁（玄関は扉も）
    for (const type of [DOOR, ENTRANCE]) {
      for (const r of mergeRects(cols, rows, (i) => grid[i] === type)) {
        const [x0, x1] = rx(r), [z0, z1] = rz(r);
        b.box(x0, x1, level + s.headHeight, level + H, z0, z1, wallFace(r, M.WALL_INT));
        if (type === ENTRANCE) addDoorLeaf(b, x0, x1, z0, z1, level, level + s.headHeight);
      }
    }
    // 階段の段板
    for (const st of stairsByFloor[idx]) addStairSteps(b, st);

    // 床・天井（建物の内側と壁の下）
    const cellCenter = (i) => [X((i % cols) + 0.5), Z(((i / cols) | 0) + 0.5)];
    // 下の階の階段の真上は床を抜く（吹き抜け）
    const overStairs = (i) => {
      if (!below.length) return false;
      const [wx, wz] = cellCenter(i);
      return below.some((st) => wx > st.x0 && wx < st.x1 && wz > st.z0 && wz < st.z1);
    };
    const outerFace = (r) => (name) => {
      const cells = sideCells(r, name);
      return cells.some(([x, y]) => isOut(x, y)) ? M.WALL_EXT : -1;
    };
    for (const r of mergeRects(cols, rows, (i) => !outside[i] && !overStairs(i))) {
      const [x0, x1] = rx(r), [z0, z1] = rz(r);
      if (idx === 0) {
        // 基礎
        b.box(x0, x1, 0, level, z0, z1, (n) => n === 'py' ? M.FLOOR : n === 'ny' ? -1 : (outerFace(r)(n) >= 0 ? M.FOUNDATION : -1));
      } else {
        // 上の階の床（下の階の天井の上に少し浮かせて重ねる）
        b.box(x0, x1, level - 0.06, level + 0.01, z0, z1, (n) => n === 'py' ? M.FLOOR : n === 'ny' ? M.CEIL : outerFace(r)(n));
      }
    }
    // 天井スラブ：下面は天井、上面は（上に何もなければ）屋上。階段の上は抜く
    for (const r of mergeRects(cols, rows, (i) => !outside[i] && !(hasUpper && grid[i] === STAIRS))) {
      const [x0, x1] = rx(r), [z0, z1] = rz(r);
      b.box(x0, x1, level + H, level + H + SLAB, z0, z1, (n) => n === 'ny' ? M.CEIL : n === 'py' ? M.ROOF : outerFace(r)(n));
    }
    // 吹き抜けのまわりの手すり
    for (const st of below) addVoidRail(b, st, level, info);

    const mesh = b.toMesh(mats.building);
    if (mesh) group.add(mesh);
    const glass = glassB.toMesh(Array(MAT_COUNT).fill(mats.glass));
    if (glass) { glass.castShadow = false; group.add(glass); }
    root.add(group);

    levels.push(level);
    colliders.push({
      level,
      isBlocked(wx, wz) {
        const t = at(...info.toCell(wx, wz));
        return t === WALL || t === WINDOW || t === ENTRANCE;
      },
      isInside(wx, wz) {
        return !isOut(...info.toCell(wx, wz));
      },
    });

    const fb = new THREE.Box3(
      new THREE.Vector3(X(info.bb.x0), 0, Z(info.bb.y0)),
      new THREE.Vector3(X(info.bb.x1 + 1), level + RISE, Z(info.bb.y1 + 1)),
    );
    bounds.union(fb);
    topBox = fb;
    topY = level + RISE;
  });

  if (topBox && s.roofType !== 'none') {
    const roof = buildRoof(topBox, topY, s, mats.building);
    if (roof) { roof.name = 'roof'; root.add(roof); bounds.union(new THREE.Box3().setFromObject(roof)); }
  }

  return { group: root, levels, colliders, stairs, bounds, wallHeight: H };
}

/** 階段上の位置 (0=下端, 1=上端)。階段の外なら null */
export function stairProgress(st, x, z) {
  if (x < st.x0 || x > st.x1 || z < st.z0 || z > st.z1) return null;
  const t = st.axis === 'x' ? (x - st.x0) / (st.x1 - st.x0) : (z - st.z0) / (st.z1 - st.z0);
  return st.dir > 0 ? t : 1 - t;
}

/** 段板を並べる（1段の高さ約19cm） */
function addStairSteps(b, st) {
  const n = Math.max(4, Math.round(st.rise / 0.19));
  const face = (name) => name === 'py' ? M.FLOOR : name === 'ny' ? -1 : M.WALL_INT;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const top = st.level + st.rise * t1;
    // 段の下は空けて、ささら桁風に厚み 25cm の板にする
    const bottom = Math.max(st.level, top - 0.25 - st.rise / n);
    if (st.axis === 'x') {
      const [a, c] = st.dir > 0 ? [st.x0 + (st.x1 - st.x0) * t0, st.x0 + (st.x1 - st.x0) * t1]
        : [st.x1 - (st.x1 - st.x0) * t1, st.x1 - (st.x1 - st.x0) * t0];
      b.box(a, c, bottom, top, st.z0, st.z1, face);
    } else {
      const [a, c] = st.dir > 0 ? [st.z0 + (st.z1 - st.z0) * t0, st.z0 + (st.z1 - st.z0) * t1]
        : [st.z1 - (st.z1 - st.z0) * t1, st.z1 - (st.z1 - st.z0) * t0];
      b.box(st.x0, st.x1, bottom, top, a, c, face);
    }
  }
}

/** 吹き抜けの縁（上り口を除く、床に面した辺）に手すりを付ける */
function addVoidRail(b, st, level, upper) {
  const edges = [
    { axis: 'x', at: st.z0, from: st.x0, to: st.x1, out: -1, top: st.axis === 'z' && st.dir < 0 },
    { axis: 'x', at: st.z1, from: st.x0, to: st.x1, out: 1, top: st.axis === 'z' && st.dir > 0 },
    { axis: 'z', at: st.x0, from: st.z0, to: st.z1, out: -1, top: st.axis === 'x' && st.dir < 0 },
    { axis: 'z', at: st.x1, from: st.z0, to: st.z1, out: 1, top: st.axis === 'x' && st.dir > 0 },
  ];
  const all = () => M.FRAME;
  const h = 0.9, t = 0.04;
  for (const e of edges) {
    if (e.top) continue;
    const mid = (e.from + e.to) / 2;
    const px = e.axis === 'x' ? mid : e.at + e.out * 0.15;
    const pz = e.axis === 'x' ? e.at + e.out * 0.15 : mid;
    if (!upper.walkable(px, pz)) continue;
    const box = (a0, a1, y0, y1) => e.axis === 'x'
      ? b.box(a0, a1, y0, y1, e.at - t, e.at + t, all)
      : b.box(e.at - t, e.at + t, y0, y1, a0, a1, all);
    box(e.from, e.to, level + h - 0.05, level + h);
    const count = Math.max(2, Math.round((e.to - e.from) / 0.5) + 1);
    for (let i = 0; i < count; i++) {
      const c = e.from + (e.to - e.from) * (i / (count - 1));
      box(Math.max(e.from, c - t / 2), Math.min(e.to, c + t / 2), level, level + h);
    }
  }
}

function addGlass(b, glassB, x0, x1, z0, z1, y0, y1) {
  const alongX = (x1 - x0) >= (z1 - z0);
  const fw = 0.05; // 枠の太さ
  const t = 0.04;
  if (alongX) {
    const zc = (z0 + z1) / 2;
    glassB.box(x0, x1, y0, y1, zc - 0.005, zc + 0.005, (n) => (n === 'nz' || n === 'pz') ? 0 : -1);
    const all = () => M.FRAME;
    b.box(x0, x1, y1 - fw, y1, zc - t, zc + t, all);
    b.box(x0, x1, y0, y0 + fw, zc - t, zc + t, all);
    b.box(x0, x0 + fw, y0, y1, zc - t, zc + t, all);
    b.box(x1 - fw, x1, y0, y1, zc - t, zc + t, all);
    const xm = (x0 + x1) / 2;
    if (x1 - x0 > 1.2) b.box(xm - fw / 2, xm + fw / 2, y0, y1, zc - t, zc + t, all);
  } else {
    const xc = (x0 + x1) / 2;
    glassB.box(xc - 0.005, xc + 0.005, y0, y1, z0, z1, (n) => (n === 'nx' || n === 'px') ? 0 : -1);
    const all = () => M.FRAME;
    b.box(xc - t, xc + t, y1 - fw, y1, z0, z1, all);
    b.box(xc - t, xc + t, y0, y0 + fw, z0, z1, all);
    b.box(xc - t, xc + t, y0, y1, z0, z0 + fw, all);
    b.box(xc - t, xc + t, y0, y1, z1 - fw, z1, all);
    const zm = (z0 + z1) / 2;
    if (z1 - z0 > 1.2) b.box(xc - t, xc + t, y0, y1, zm - fw / 2, zm + fw / 2, all);
  }
}

function addDoorLeaf(b, x0, x1, z0, z1, y0, y1) {
  const t = 0.03;
  const all = () => M.DOOR;
  if ((x1 - x0) >= (z1 - z0)) {
    const zc = (z0 + z1) / 2;
    b.box(x0, x1, y0, y1, zc - t, zc + t, all);
  } else {
    const xc = (x0 + x1) / 2;
    b.box(xc - t, xc + t, y0, y1, z0, z1, all);
  }
}

/** 最上階の外形（長方形）に屋根をかける */
function buildRoof(box, baseY, s, materials) {
  const b = new MeshBuilder();
  const e = s.eaves;
  const k = s.roofPitch / 10; // 寸勾配 → 傾き
  const sx = box.max.x - box.min.x;
  const sz = box.max.z - box.min.z;
  let alongX = s.ridgeDir === 'x' ? true : s.ridgeDir === 'z' ? false : sx >= sz;

  // ローカル座標 (u: 棟の方向, w: 棟と直交) → ワールド
  const u0 = alongX ? box.min.x : box.min.z, u1 = alongX ? box.max.x : box.max.z;
  const w0 = alongX ? box.min.z : box.min.x, w1 = alongX ? box.max.z : box.max.x;
  const V = (u, y, w) => alongX ? new THREE.Vector3(u, y, w) : new THREE.Vector3(w, y, u);
  const wc = (w0 + w1) / 2;
  const half = (w1 - w0) / 2;

  if (s.roofType === 'flat') {
    const x0 = box.min.x - 0.1, x1 = box.max.x + 0.1, z0 = box.min.z - 0.1, z1 = box.max.z + 0.1;
    b.box(x0, x1, baseY, baseY + 0.12, z0, z1, (n) => n === 'py' ? M.ROOF : n === 'ny' ? M.CEIL : M.FRAME);
    // パラペット
    const p = 0.12, ph = 0.5;
    const pf = (n) => n === 'ny' ? -1 : M.WALL_EXT;
    b.box(x0, x1, baseY, baseY + ph, z0, z0 + p, pf);
    b.box(x0, x1, baseY, baseY + ph, z1 - p, z1, pf);
    b.box(x0, x0 + p, baseY, baseY + ph, z0, z1, pf);
    b.box(x1 - p, x1, baseY, baseY + ph, z0, z1, pf);
  } else if (s.roofType === 'gable') {
    const yR = baseY + half * k;
    const yE = baseY - e * k;
    const ua = u0 - e, ub = u1 + e;
    b.quad(M.ROOF, V(ua, yE, w0 - e), V(ub, yE, w0 - e), V(ub, yR, wc), V(ua, yR, wc));
    b.quad(M.ROOF, V(ub, yE, w1 + e), V(ua, yE, w1 + e), V(ua, yR, wc), V(ub, yR, wc));
    b.tri(M.WALL_EXT, V(u0, baseY, w1), V(u0, baseY, w0), V(u0, yR, wc));
    b.tri(M.WALL_EXT, V(u1, baseY, w0), V(u1, baseY, w1), V(u1, yR, wc));
    addFascia(b, [V(ua, yE, w0 - e), V(ub, yE, w0 - e)], [V(ub, yE, w1 + e), V(ua, yE, w1 + e)]);
  } else if (s.roofType === 'hip') {
    const d = half + e;
    const yE = baseY - e * k;
    const yR = yE + d * k;
    const ua = u0 - e, ub = u1 + e;
    let ra = ua + d, rb = ub - d;
    if (ra > rb) ra = rb = (ua + ub) / 2;
    const A = V(ua, yE, w0 - e), B = V(ub, yE, w0 - e), C = V(ub, yE, w1 + e), D = V(ua, yE, w1 + e);
    const R1 = V(ra, yR, wc), R2 = V(rb, yR, wc);
    b.quad(M.ROOF, A, B, R2, R1);
    b.quad(M.ROOF, C, D, R1, R2);
    b.tri(M.ROOF, D, A, R1);
    b.tri(M.ROOF, B, C, R2);
    addFascia(b, [A, B], [B, C], [C, D], [D, A]);
  } else if (s.roofType === 'shed') {
    const yLow = baseY - e * k;
    const yHigh = baseY + (w1 - w0 + e) * k;
    const yWallHigh = baseY + (w1 - w0) * k;
    const ua = u0 - e, ub = u1 + e;
    // w0 側が高く、w1 側へ下がる
    b.quad(M.ROOF, V(ub, yLow, w1 + e), V(ua, yLow, w1 + e), V(ua, yHigh, w0 - e), V(ub, yHigh, w0 - e));
    b.quad(M.WALL_EXT, V(u1, baseY, w0), V(u0, baseY, w0), V(u0, yWallHigh, w0), V(u1, yWallHigh, w0));
    b.tri(M.WALL_EXT, V(u0, baseY, w1), V(u0, baseY, w0), V(u0, yWallHigh, w0));
    b.tri(M.WALL_EXT, V(u1, baseY, w0), V(u1, baseY, w1), V(u1, yWallHigh, w0));
    addFascia(b, [V(ua, yLow, w1 + e), V(ub, yLow, w1 + e)], [V(ua, yHigh, w0 - e), V(ub, yHigh, w0 - e)]);
  }
  return b.toMesh(materials);
}

/** 軒先に細い鼻隠しを付けて屋根の薄さを隠す */
function addFascia(b, ...edges) {
  const h = 0.15;
  for (const [p, q] of edges) {
    const p2 = p.clone(); p2.y -= h;
    const q2 = q.clone(); q2.y -= h;
    b.quad(M.FRAME, p2, q2, q, p);
  }
}
