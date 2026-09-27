// グリッド化した間取りから3Dの家を組み立てる
import * as THREE from 'three';
import { EMPTY, WALL, WINDOW, DOOR, ENTRANCE, computeOutside, gridBounds, mergeRects } from './planAnalyzer.js';

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
  const H = s.wallHeight;
  let level = s.baseHeight;
  let topBox = null;
  let topY = 0;
  const bounds = new THREE.Box3();

  floors.forEach((fl, idx) => {
    const { cols, rows, grid } = fl.plan;
    const m = fl.metersPerCell;
    const bb = gridBounds(grid, cols, rows);
    if (!bb) { levels.push(level); colliders.push(null); return; }

    const cx = (bb.x0 + bb.x1 + 1) / 2;
    const cz = (bb.y0 + bb.y1 + 1) / 2;
    const X = (x) => (x - cx) * m + fl.offsetX;
    const Z = (y) => (y - cz) * m + fl.offsetZ;
    const outside = computeOutside(grid, cols, rows, Math.max(1, Math.round(0.5 / m)));
    const at = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows) ? EMPTY : grid[y * cols + x];
    const isOut = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows) ? true : !!outside[y * cols + x];

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

    // 床・天井（建物の内側と壁の下）
    const inside = (i) => !outside[i];
    const slabRects = mergeRects(cols, rows, inside);
    const outerFace = (r) => (name) => {
      const cells = sideCells(r, name);
      return cells.some(([x, y]) => isOut(x, y)) ? M.WALL_EXT : -1;
    };
    for (const r of slabRects) {
      const [x0, x1] = rx(r), [z0, z1] = rz(r);
      if (idx === 0) {
        // 基礎
        b.box(x0, x1, 0, level, z0, z1, (n) => n === 'py' ? M.FLOOR : n === 'ny' ? -1 : (outerFace(r)(n) >= 0 ? M.FOUNDATION : -1));
      } else {
        // 上の階の床（下の階の天井の上に少し浮かせて重ねる）
        b.box(x0, x1, level - 0.06, level + 0.01, z0, z1, (n) => n === 'py' ? M.FLOOR : n === 'ny' ? M.CEIL : outerFace(r)(n));
      }
      // 天井スラブ：下面は天井、上面は（上に何もなければ）屋上
      b.box(x0, x1, level + H, level + H + SLAB, z0, z1, (n) => n === 'ny' ? M.CEIL : n === 'py' ? M.ROOF : outerFace(r)(n));
    }

    const mesh = b.toMesh(mats.building);
    if (mesh) group.add(mesh);
    const glass = glassB.toMesh(Array(MAT_COUNT).fill(mats.glass));
    if (glass) { glass.castShadow = false; group.add(glass); }
    root.add(group);

    levels.push(level);
    colliders.push({
      level,
      isBlocked(wx, wz) {
        const x = Math.floor((wx - fl.offsetX) / m + cx);
        const y = Math.floor((wz - fl.offsetZ) / m + cz);
        const t = at(x, y);
        return t === WALL || t === WINDOW || t === ENTRANCE;
      },
      isInside(wx, wz) {
        const x = Math.floor((wx - fl.offsetX) / m + cx);
        const y = Math.floor((wz - fl.offsetZ) / m + cz);
        return !isOut(x, y);
      },
    });

    const fb = new THREE.Box3(
      new THREE.Vector3(X(bb.x0), 0, Z(bb.y0)),
      new THREE.Vector3(X(bb.x1 + 1), level + H + SLAB, Z(bb.y1 + 1)),
    );
    bounds.union(fb);
    topBox = fb;
    topY = level + H + SLAB;
    level += H + SLAB;
  });

  if (topBox && s.roofType !== 'none') {
    const roof = buildRoof(topBox, topY, s, mats.building);
    if (roof) { roof.name = 'roof'; root.add(roof); bounds.union(new THREE.Box3().setFromObject(roof)); }
  }

  return { group: root, levels, colliders, bounds, wallHeight: H };
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
