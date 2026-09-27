// 間取りから部屋を見つけて、部屋の種類に合った家具を自動で配置する
import * as THREE from 'three';
import { EMPTY, WALL, DOOR, ENTRANCE, STAIRS } from './planAnalyzer.js';

// ---------- マテリアル ----------
function makeMaterials(clip) {
  const m = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...clip, ...extra });
  return {
    wood: m('#a8794f'),
    darkWood: m('#5b4030'),
    lightWood: m('#d2b48c'),
    white: m('#f3f2ee'),
    fabric: m('#7d8b9b'),
    cushion: m('#c9b79c'),
    bedding: m('#f4f1ea'),
    blanket: m('#8fa9c4'),
    black: m('#26272a', { roughness: 0.4 }),
    metal: m('#b9bdc2', { roughness: 0.35, metalness: 0.4 }),
    counter: m('#e4e1db', { roughness: 0.5 }),
    zabuton: m('#a8433c'),
    green: m('#4f7d3a'),
    pot: m('#b8663a'),
    water: m('#8cc4e0', { roughness: 0.1 }),
    porcelain: m('#fbfbfa', { roughness: 0.3 }),
    mirror: m('#cfdde6', { roughness: 0.05, metalness: 0.6 }),
  };
}

// ---------- 家具のモデル（手前が +z、幅は x、奥行きは z、床が y=0） ----------
function box(g, mat, x0, x1, y0, y1, z0, z1) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

function legs(g, mat, w, d, h, t = 0.05, inset = 0.04) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w / 2 - inset - t / 2), z = sz * (d / 2 - inset - t / 2);
    box(g, mat, x - t / 2, x + t / 2, 0, h, z - t / 2, z + t / 2);
  }
}

function chair(g, M, x, z, facing) {
  // facing: 1 なら +z 向き（背もたれが -z 側）
  const c = new THREE.Group();
  legs(c, M.darkWood, 0.42, 0.42, 0.43, 0.035);
  box(c, M.wood, -0.21, 0.21, 0.43, 0.47, -0.21, 0.21);
  box(c, M.wood, -0.21, 0.21, 0.47, 0.85, -0.21, -0.17);
  c.position.set(x, 0, z);
  if (facing < 0) c.rotation.y = Math.PI;
  g.add(c);
}

const MODELS = {
  bed(M, w, d) {
    const g = new THREE.Group();
    box(g, M.darkWood, -w / 2, w / 2, 0.08, 0.3, -d / 2, d / 2);
    box(g, M.bedding, -w / 2 + 0.03, w / 2 - 0.03, 0.3, 0.5, -d / 2 + 0.05, d / 2 - 0.02);
    box(g, M.darkWood, -w / 2, w / 2, 0, 0.95, -d / 2, -d / 2 + 0.06);
    box(g, M.blanket, -w / 2 + 0.01, w / 2 - 0.01, 0.48, 0.53, -d / 2 + 0.7, d / 2);
    const pw = w > 1.2 ? (w - 0.3) / 2 : w - 0.3;
    for (let i = 0; i < (w > 1.2 ? 2 : 1); i++) {
      const x0 = -w / 2 + 0.15 + i * (pw + 0.0);
      box(g, M.bedding, x0, x0 + pw - 0.05, 0.5, 0.62, -d / 2 + 0.12, -d / 2 + 0.5);
    }
    return g;
  },
  sofa(M, w, d) {
    const g = new THREE.Group();
    box(g, M.fabric, -w / 2, w / 2, 0.08, 0.42, -d / 2, d / 2);
    box(g, M.fabric, -w / 2, w / 2, 0.42, 0.82, -d / 2, -d / 2 + 0.2);
    box(g, M.fabric, -w / 2, -w / 2 + 0.16, 0.42, 0.62, -d / 2, d / 2);
    box(g, M.fabric, w / 2 - 0.16, w / 2, 0.42, 0.62, -d / 2, d / 2);
    const n = 3, cw = (w - 0.32) / n;
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + 0.16 + i * cw;
      box(g, M.cushion, x0 + 0.01, x0 + cw - 0.01, 0.42, 0.5, -d / 2 + 0.2, d / 2 - 0.02);
    }
    return g;
  },
  coffeeTable(M, w, d) {
    const g = new THREE.Group();
    legs(g, M.darkWood, w, d, 0.36, 0.04);
    box(g, M.lightWood, -w / 2, w / 2, 0.36, 0.4, -d / 2, d / 2);
    return g;
  },
  tvBoard(M, w, d) {
    const g = new THREE.Group();
    box(g, M.darkWood, -w / 2, w / 2, 0.03, 0.42, -d / 2, d / 2);
    const tw = Math.min(1.3, w - 0.2);
    box(g, M.black, -0.12, 0.12, 0.42, 0.45, -0.1, 0.1);
    box(g, M.black, -0.03, 0.03, 0.45, 0.55, -0.03, 0.03);
    box(g, M.black, -tw / 2, tw / 2, 0.55, 0.55 + tw * 0.56, -0.03, 0.02);
    return g;
  },
  dining(M, w, d) {
    // w: テーブルの幅、d: 椅子込みの奥行き
    const g = new THREE.Group();
    const td = d - 1.0;
    legs(g, M.darkWood, w, td, 0.7, 0.05);
    box(g, M.wood, -w / 2, w / 2, 0.7, 0.74, -td / 2, td / 2);
    for (const x of [-w / 4, w / 4]) {
      chair(g, M, x, -td / 2 - 0.22, 1);
      chair(g, M, x, td / 2 + 0.22, -1);
    }
    return g;
  },
  kitchen(M, w, d) {
    const g = new THREE.Group();
    box(g, M.white, -w / 2, w / 2, 0, 0.82, -d / 2, d / 2);
    box(g, M.counter, -w / 2, w / 2, 0.82, 0.86, -d / 2, d / 2 + 0.02);
    box(g, M.metal, -w / 2 + 0.3, -w / 2 + 1.0, 0.86, 0.87, -d / 2 + 0.12, d / 2 - 0.1);
    for (const x of [w / 2 - 0.65, w / 2 - 0.35]) {
      box(g, M.black, x - 0.11, x + 0.11, 0.86, 0.875, -0.12, 0.1);
    }
    // 吊戸棚
    box(g, M.white, -w / 2, w / 2, 1.5, 2.2, -d / 2, -d / 2 + 0.35);
    return g;
  },
  fridge(M, w, d) {
    const g = new THREE.Group();
    box(g, M.porcelain, -w / 2, w / 2, 0, 1.8, -d / 2, d / 2);
    box(g, M.metal, w / 2 - 0.08, w / 2 - 0.05, 0.9, 1.4, d / 2, d / 2 + 0.03);
    box(g, M.counter, -w / 2, w / 2, 1.1, 1.11, d / 2 - 0.001, d / 2 + 0.002);
    return g;
  },
  wardrobe(M, w, d) {
    const g = new THREE.Group();
    box(g, M.lightWood, -w / 2, w / 2, 0, 1.9, -d / 2, d / 2);
    box(g, M.darkWood, -0.01, 0.01, 0.05, 1.85, d / 2, d / 2 + 0.005);
    for (const x of [-0.08, 0.08]) box(g, M.metal, x - 0.01, x + 0.01, 0.9, 1.2, d / 2, d / 2 + 0.03);
    return g;
  },
  desk(M, w, d) {
    // 奥行き d は椅子込み
    const g = new THREE.Group();
    const dd = 0.55;
    const z0 = -d / 2;
    const top = new THREE.Group();
    legs(top, M.metal, w, dd, 0.7, 0.04);
    box(top, M.lightWood, -w / 2, w / 2, 0.7, 0.73, -dd / 2, dd / 2);
    top.position.z = z0 + dd / 2;
    g.add(top);
    chair(g, M, 0, z0 + dd + 0.15, -1);
    return g;
  },
  lowTable(M, w, d) {
    // 座卓と座布団（奥行き d は座布団込み）
    const g = new THREE.Group();
    const td = d - 1.1;
    legs(g, M.darkWood, w, td, 0.31, 0.06, 0.05);
    box(g, M.darkWood, -w / 2, w / 2, 0.31, 0.35, -td / 2, td / 2);
    for (const x of [-w / 4, w / 4]) {
      for (const z of [-td / 2 - 0.3, td / 2 + 0.3]) box(g, M.zabuton, x - 0.27, x + 0.27, 0, 0.07, z - 0.27, z + 0.27);
    }
    return g;
  },
  tansu(M, w, d) {
    const g = new THREE.Group();
    box(g, M.darkWood, -w / 2, w / 2, 0, 1.05, -d / 2, d / 2);
    for (let i = 1; i < 5; i++) box(g, M.black, -w / 2 + 0.03, w / 2 - 0.03, i * 0.21 - 0.005, i * 0.21 + 0.005, d / 2, d / 2 + 0.005);
    return g;
  },
  shoeCabinet(M, w, d) {
    const g = new THREE.Group();
    box(g, M.lightWood, -w / 2, w / 2, 0.1, 0.9, -d / 2, d / 2);
    box(g, M.darkWood, -0.005, 0.005, 0.12, 0.88, d / 2, d / 2 + 0.005);
    return g;
  },
  vanity(M, w, d) {
    const g = new THREE.Group();
    box(g, M.white, -w / 2, w / 2, 0, 0.8, -d / 2, d / 2);
    box(g, M.porcelain, -w / 2, w / 2, 0.8, 0.85, -d / 2, d / 2);
    box(g, M.water, -w / 2 + 0.12, w / 2 - 0.12, 0.85, 0.851, -d / 2 + 0.15, d / 2 - 0.08);
    box(g, M.mirror, -w / 2 + 0.05, w / 2 - 0.05, 1.0, 1.75, -d / 2, -d / 2 + 0.03);
    return g;
  },
  washer(M, w, d) {
    const g = new THREE.Group();
    box(g, M.porcelain, -w / 2, w / 2, 0, 0.95, -d / 2, d / 2);
    const door = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 24), M.black);
    door.rotation.x = Math.PI / 2;
    door.position.set(0, 0.5, d / 2 + 0.01);
    g.add(door);
    return g;
  },
  bathtub(M, w, d) {
    const g = new THREE.Group();
    box(g, M.porcelain, -w / 2, w / 2, 0, 0.55, -d / 2, d / 2);
    box(g, M.water, -w / 2 + 0.08, w / 2 - 0.08, 0.45, 0.551, -d / 2 + 0.08, d / 2 - 0.08);
    return g;
  },
  toilet(M, w, d) {
    const g = new THREE.Group();
    box(g, M.porcelain, -w / 2, w / 2, 0.35, 0.8, -d / 2, -d / 2 + 0.2);
    box(g, M.porcelain, -0.18, 0.18, 0, 0.4, -d / 2 + 0.15, d / 2);
    box(g, M.white, -0.19, 0.19, 0.4, 0.43, -d / 2 + 0.2, d / 2 + 0.01);
    return g;
  },
  shelf(M, w, d) {
    const g = new THREE.Group();
    box(g, M.lightWood, -w / 2, -w / 2 + 0.03, 0, 1.8, -d / 2, d / 2);
    box(g, M.lightWood, w / 2 - 0.03, w / 2, 0, 1.8, -d / 2, d / 2);
    box(g, M.lightWood, -w / 2, w / 2, 0, 1.8, -d / 2, -d / 2 + 0.02);
    for (let i = 0; i <= 4; i++) box(g, M.lightWood, -w / 2, w / 2, i * 0.44, i * 0.44 + 0.03, -d / 2, d / 2);
    return g;
  },
  plant(M, w) {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.35, w * 0.28, 0.35, 16), M.pot);
    pot.position.y = 0.175;
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(w * 0.5, 12, 10), M.green);
    leaves.position.y = 0.75;
    leaves.scale.y = 1.3;
    for (const o of [pot, leaves]) { o.castShadow = true; g.add(o); }
    return g;
  },
};

// ---------- 部屋の種類ごとの家具リスト ----------
// place: wall（壁付け）/ free（部屋の中ほど）/ front（直前の家具の前）
// align: center（壁の中央）/ corner（隅）/ far（ドアから遠く）
// tall: 窓の前に置かない背の高い家具
const RECIPES = {
  ldk: [
    { id: 'kitchen', model: 'kitchen', w: 2.4, d: 0.65, place: 'wall', align: 'corner' },
    { id: 'fridge', model: 'fridge', w: 0.7, d: 0.7, place: 'wall', align: 'nextTo', ref: 'kitchen', tall: true },
    { id: 'sofa', model: 'sofa', w: 1.8, d: 0.85, place: 'wall', align: 'far' },
    { model: 'coffeeTable', w: 1.0, d: 0.5, place: 'front', ref: 'sofa', gap: 0.35 },
    { model: 'tvBoard', w: 1.6, d: 0.42, place: 'wall', align: 'facing', ref: 'sofa' },
    { model: 'dining', w: 1.4, d: 1.8, place: 'free', near: 'kitchen' },
    { model: 'plant', w: 0.45, d: 0.45, place: 'wall', align: 'corner', optional: true },
  ],
  washitsu: [
    { model: 'lowTable', w: 1.2, d: 1.85, place: 'free' },
    { model: 'tansu', w: 0.9, d: 0.45, place: 'wall', align: 'corner', tall: true },
  ],
  master: [
    { model: 'bed', w: 1.6, d: 2.05, place: 'wall', align: 'far' },
    { model: 'wardrobe', w: 1.2, d: 0.6, place: 'wall', align: 'corner', tall: true },
    { model: 'plant', w: 0.4, d: 0.4, place: 'wall', align: 'corner', optional: true },
  ],
  bedroom: [
    { model: 'bed', w: 1.0, d: 2.0, place: 'wall', align: 'corner' },
    { model: 'desk', w: 1.0, d: 1.05, place: 'wall', align: 'center' },
    { model: 'wardrobe', w: 0.9, d: 0.6, place: 'wall', align: 'corner', tall: true },
  ],
  genkan: [
    { model: 'shoeCabinet', w: 0.9, d: 0.35, place: 'wall', align: 'corner', nearDoorOk: true },
  ],
  senmen: [
    { model: 'vanity', w: 0.75, d: 0.5, place: 'wall', align: 'center', nearDoorOk: true },
    { model: 'washer', w: 0.6, d: 0.6, place: 'wall', align: 'corner', nearDoorOk: true },
  ],
  bath: [
    { model: 'bathtub', w: 1.5, d: 0.8, place: 'wall', align: 'corner', nearDoorOk: true },
  ],
  wc: [
    { model: 'toilet', w: 0.42, d: 0.72, place: 'wall', align: 'far', nearDoorOk: true },
  ],
  storage: [
    { model: 'shelf', w: 0.9, d: 0.4, place: 'wall', align: 'corner', tall: true, nearDoorOk: true },
    { model: 'shelf', w: 0.9, d: 0.4, place: 'wall', align: 'corner', tall: true, nearDoorOk: true, optional: true },
  ],
  hall: [],
};

/** 間取り図の文字（部屋名）から部屋の種類を決める */
function typeFromName(name) {
  const rules = [
    [/LDK|リビング|ダイニング|居間/i, 'ldk'],
    [/主寝室/, 'master'],
    [/和室|座敷/, 'washitsu'],
    [/洋室|寝室|子供|子ども|個室/, 'bedroom'],
    [/玄関/, 'genkan'],
    [/洗面|脱衣/, 'senmen'],
    [/浴室|風呂|バス/, 'bath'],
    [/WC|トイレ|便所/i, 'wc'],
    [/納戸|収納|クローゼット|WIC|物入/i, 'storage'],
    [/ホール|廊下|階段|ポーチ/, 'hall'],
  ];
  for (const [re, t] of rules) if (re.test(name)) return t;
  return null;
}

/** 部屋（壁・建具で区切られた床の塊）を探す */
function findRooms(info) {
  const { cols, rows, grid, outside, m } = info;
  const id = new Int32Array(cols * rows).fill(-1);
  const rooms = [];
  const isFloor = (i) => grid[i] === EMPTY && !outside[i] && !info.overStairs?.(i);
  for (let i = 0; i < grid.length; i++) {
    if (id[i] >= 0 || !isFloor(i)) continue;
    const room = { id: rooms.length, cells: [], doors: [], entrance: false, x0: Infinity, x1: -1, y0: Infinity, y1: -1 };
    const stack = [i];
    id[i] = room.id;
    const doorSeen = new Set();
    while (stack.length) {
      const c = stack.pop();
      room.cells.push(c);
      const x = c % cols, y = (c / cols) | 0;
      room.x0 = Math.min(room.x0, x); room.x1 = Math.max(room.x1, x);
      room.y0 = Math.min(room.y0, y); room.y1 = Math.max(room.y1, y);
      for (const n of [x > 0 ? c - 1 : -1, x < cols - 1 ? c + 1 : -1, y > 0 ? c - cols : -1, y < rows - 1 ? c + cols : -1]) {
        if (n < 0) continue;
        const t = grid[n];
        if ((t === DOOR || t === ENTRANCE || t === STAIRS) && !doorSeen.has(n)) {
          doorSeen.add(n);
          room.doors.push([info.X((n % cols) + 0.5), info.Z(((n / cols) | 0) + 0.5)]);
          if (t === ENTRANCE) room.entrance = true;
        }
        if (id[n] < 0 && isFloor(n)) { id[n] = room.id; stack.push(n); }
      }
    }
    room.area = room.cells.length * m * m;
    room.w = (room.x1 - room.x0 + 1) * m;
    room.h = (room.y1 - room.y0 + 1) * m;
    rooms.push(room);
  }
  return { rooms, id };
}

/** 部屋名のヒントがなければ、広さ・形から部屋の種類を推定する */
function classifyRooms(info, rooms, roomId) {
  for (const hint of info.roomHints) {
    const [x, y] = hint.cell;
    const r = rooms[roomId[y * info.cols + x]];
    const t = typeFromName(hint.name);
    if (r && t && !r.type) r.type = t;
  }
  const upper = info.index > 0;
  const untyped = rooms.filter((r) => !r.type);
  const narrow = (r) => Math.min(r.w, r.h) < 1.3 || Math.max(r.w, r.h) / Math.min(r.w, r.h) > 3.2;
  for (const r of untyped) {
    if (r.area < 1.2 || narrow(r)) r.type = 'hall';
    else if (r.entrance) r.type = 'genkan';
  }
  const rest = untyped.filter((r) => !r.type).sort((a, b) => b.area - a.area);
  if (!upper && rest.length && rest[0].area >= 12 && !rooms.some((r) => r.type === 'ldk')) rest.shift().type = 'ldk';
  const smalls = [];
  for (const r of rest) {
    if (r.area >= 11) r.type = upper ? 'master' : 'washitsu';
    else if (r.area >= 5.5) r.type = upper ? 'bedroom' : 'washitsu';
    else smalls.push(r);
  }
  smalls.sort((a, b) => a.area - b.area);
  if (upper) {
    smalls.forEach((r, i) => { r.type = i === 0 && r.area < 3 ? 'wc' : 'storage'; });
  } else {
    const order = ['wc', 'senmen', 'bath'];
    smalls.forEach((r, i) => { r.type = order[i] || 'storage'; });
  }
}

/**
 * 家具を配置する。各階のグループに家具を追加し、歩けない範囲（house.obstacles）を登録する。
 * @returns 配置した家具の数
 */
let materials = null;
export function furnishHouse(house, clip) {
  // マテリアルは作り直しのたびに増えないよう使い回す
  const M = materials || (materials = makeMaterials(clip));
  let count = 0;
  house.floors.forEach((info, fi) => {
    if (info.empty) return;
    const group = house.group.getObjectByName(`floor-${fi}`);
    const furn = new THREE.Group();
    furn.name = 'furniture';
    group.add(furn);
    const { rooms, id } = findRooms(info);
    classifyRooms(info, rooms, id);
    info.rooms = rooms;
    const roomAt = (wx, wz) => {
      const [x, y] = info.toCell(wx, wz);
      if (x < 0 || y < 0 || x >= info.cols || y >= info.rows) return -1;
      return id[y * info.cols + x];
    };
    const cellAt = (wx, wz) => {
      const [x, y] = info.toCell(wx, wz);
      return info.at(x, y);
    };
    for (const room of rooms) {
      const placed = placeRoom(room, RECIPES[room.type] || [], { roomAt, cellAt, info });
      for (const p of placed) {
        const obj = MODELS[p.item.model](M, p.item.w, p.item.d);
        obj.position.set(p.cx, info.level, p.cz);
        obj.rotation.y = p.rot;
        furn.add(obj);
        house.obstacles[fi].push({ x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1 });
        count++;
      }
    }
  });
  return count;
}

// 各辺：back は壁側の向き。rot は家具の +z（正面）を部屋の内側へ向ける回転
const SIDES = [
  { name: 'N', rot: 0, axis: 'x', back: [0, -1] },
  { name: 'S', rot: Math.PI, axis: 'x', back: [0, 1] },
  { name: 'W', rot: Math.PI / 2, axis: 'z', back: [-1, 0] },
  { name: 'E', rot: -Math.PI / 2, axis: 'z', back: [1, 0] },
];
const OPPOSITE = { N: 'S', S: 'N', W: 'E', E: 'W' };

function placeRoom(room, recipe, env) {
  const { roomAt, cellAt, info } = env;
  const bx0 = info.X(room.x0), bx1 = info.X(room.x1 + 1);
  const bz0 = info.Z(room.y0), bz1 = info.Z(room.y1 + 1);
  const placed = [];
  const byId = {};
  const STEP = 0.1;

  // 長方形が部屋の床の上に収まり、ほかの家具やドアの前をふさがないか
  const fits = (r, item) => {
    for (let x = r.x0 + 0.02; x < r.x1; x += 0.12) {
      for (let z = r.z0 + 0.02; z < r.z1; z += 0.12) if (roomAt(x, z) !== room.id) return false;
      if (roomAt(x, r.z1 - 0.02) !== room.id) return false;
    }
    for (let z = r.z0 + 0.02; z < r.z1; z += 0.12) if (roomAt(r.x1 - 0.02, z) !== room.id) return false;
    for (const p of placed) {
      if (r.x0 < p.x1 + 0.05 && r.x1 > p.x0 - 0.05 && r.z0 < p.z1 + 0.05 && r.z1 > p.z0 - 0.05) return false;
    }
    const clear = item.nearDoorOk ? 0.45 : 0.75;
    for (const [dx, dz] of room.doors) {
      const ex = Math.max(r.x0 - dx, 0, dx - r.x1), ez = Math.max(r.z0 - dz, 0, dz - r.z1);
      if (Math.hypot(ex, ez) < clear) return false;
    }
    return true;
  };

  // 背面が壁についているか（背の高い家具は窓の前を避ける）
  const backed = (r, side, item) => {
    const [bx, bz] = side.back;
    const pts = [];
    if (side.axis === 'x') {
      const z = bz < 0 ? r.z0 - 0.12 : r.z1 + 0.12;
      for (let x = r.x0 + 0.1; x < r.x1 - 0.05; x += 0.2) pts.push([x, z]);
    } else {
      const x = bx < 0 ? r.x0 - 0.12 : r.x1 + 0.12;
      for (let z = r.z0 + 0.1; z < r.z1 - 0.05; z += 0.2) pts.push([x, z]);
    }
    return pts.every(([x, z]) => {
      const t = cellAt(x, z);
      // 背の高い家具は壁だけ、低い家具は窓の下でもよい
      return item.tall ? t === WALL : t !== EMPTY;
    });
  };

  const footprint = (cx, cz, w, d, rotated) => {
    const hw = (rotated ? d : w) / 2, hd = (rotated ? w : d) / 2;
    return { x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd, cx, cz };
  };
  const doorDist = (cx, cz) => room.doors.reduce((a, [dx, dz]) => Math.min(a, Math.hypot(cx - dx, cz - dz)), 10);

  for (const item of recipe) {
    let best = null;
    if (item.place === 'wall') {
      const ref = item.ref ? byId[item.ref] : null;
      for (const side of SIDES) {
        const rotated = side.axis === 'z';
        const w = item.w, d = item.d;
        const along0 = side.axis === 'x' ? bx0 : bz0, along1 = side.axis === 'x' ? bx1 : bz1;
        for (let depth = 0; depth <= 1.2; depth += STEP) {
          let found = false;
          for (let a = along0 + w / 2; a <= along1 - w / 2 + 1e-6; a += STEP) {
            let cx, cz;
            if (side.name === 'N') { cx = a; cz = bz0 + depth + d / 2; }
            if (side.name === 'S') { cx = a; cz = bz1 - depth - d / 2; }
            if (side.name === 'W') { cz = a; cx = bx0 + depth + d / 2; }
            if (side.name === 'E') { cz = a; cx = bx1 - depth - d / 2; }
            const r = footprint(cx, cz, w, d, rotated);
            if (!fits(r, item) || !backed(r, side, item)) continue;
            found = true;
            const mid = (along0 + along1) / 2;
            let score = 0;
            if (item.align === 'center') score = -Math.abs(a - mid);
            else if (item.align === 'corner') score = -Math.min(a - w / 2 - along0, along1 - (a + w / 2));
            else if (item.align === 'far') score = doorDist(cx, cz) - Math.abs(a - mid) * 0.3;
            else if (item.align === 'nextTo' && ref) score = -Math.hypot(cx - ref.cx, cz - ref.cz);
            else if (item.align === 'facing' && ref) score = (side.name === OPPOSITE[ref.side] ? 10 : 0) - Math.abs(a - (side.axis === 'x' ? ref.cx : ref.cz));
            score -= depth * 3; // なるべく壁にぴったり
            if (!best || score > best.score) best = { ...r, rot: side.rot, side: side.name, score };
          }
          if (found) break;
        }
      }
    } else if (item.place === 'front') {
      const ref = byId[item.ref];
      if (ref) {
        const [fx, fz] = [Math.sin(ref.rot), Math.cos(ref.rot)];
        const refDepth = ref.item.d;
        const off = refDepth / 2 + item.gap + item.d / 2;
        const cx = ref.cx + fx * off, cz = ref.cz + fz * off;
        const r = footprint(cx, cz, item.w, item.d, Math.abs(fx) > 0.5);
        if (fits(r, item)) best = { ...r, rot: ref.rot };
      }
    } else if (item.place === 'free') {
      const ref = item.near ? byId[item.near] : null;
      const rcx = (bx0 + bx1) / 2, rcz = (bz0 + bz1) / 2;
      for (const rotated of [false, true]) {
        for (let cx = bx0; cx <= bx1; cx += 0.15) {
          for (let cz = bz0; cz <= bz1; cz += 0.15) {
            const r = footprint(cx, cz, item.w, item.d, rotated);
            if (!fits(r, item)) continue;
            // まわりにどれだけ余裕があるか
            let margin = 0;
            for (let mg = 0.15; mg <= 0.9; mg += 0.15) {
              const e = { x0: r.x0 - mg, x1: r.x1 + mg, z0: r.z0 - mg, z1: r.z1 + mg };
              if (!fits(e, item)) break;
              margin = mg;
            }
            let score = margin * 10 - Math.hypot(cx - rcx, cz - rcz) * 0.5;
            if (ref) score -= Math.hypot(cx - ref.cx, cz - ref.cz) * 0.8;
            if (!best || score > best.score) best = { ...r, rot: rotated ? Math.PI / 2 : 0, score };
          }
        }
      }
    }
    if (!best) continue;
    const p = { ...best, item };
    placed.push(p);
    if (item.id) byId[item.id] = p;
  }
  return placed;
}
