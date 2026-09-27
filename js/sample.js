// 「サンプルで試す」用に、間取り図と外観イラストをキャンバスで描く

const PX = 60;      // 1m あたりのピクセル
const MARGIN = 70;
const WALL = 0.2;   // 壁の厚み (m)

const W = 9.1, D = 7.28;

const PLANS = [
  {
    name: '1階',
    walls: [
      ['h', 0, 0, W], ['h', D, 0, W], ['v', 0, 0, D], ['v', W, 0, D],
      ['h', 2.73, 0, W],
      ['v', 1.82, 0, 2.73], ['v', 3.64, 0, 2.73], ['v', 5.46, 0, D], ['v', 7.28, 0, 2.73],
    ],
    openings: [
      ['h', 0, 0.35, 1.45, 'entrance'],
      ['v', 1.82, 0.8, 1.9, 'door'],
      ['h', 2.73, 1.97, 2.65, 'door'],
      ['v', 3.64, 0.9, 1.7, 'door'],
      ['v', 5.46, 0.9, 1.7, 'door'],
      ['v', 5.46, 4.4, 6.0, 'door'],
      ['h', 2.73, 7.9, 8.7, 'door'],
      ['h', D, 0.9, 2.6, 'win'], ['h', D, 3.2, 4.6, 'win'], ['h', D, 6.4, 8.2, 'win'],
      ['v', 0, 3.6, 5.4, 'win'], ['v', W, 3.8, 5.2, 'win'], ['v', W, 0.6, 1.4, 'win'],
      ['h', 0, 4.1, 5.0, 'win'], ['h', 0, 6.0, 6.8, 'win'],
    ],
    labels: [
      ['玄関', 0.91, 1.5], ['ホール・階段', 2.73, 1.4], ['洗面', 4.55, 1.4], ['浴室', 6.37, 1.4],
      ['WC', 8.19, 1.4], ['LDK 18帖', 2.73, 5.0], ['和室 6帖', 7.28, 5.0],
    ],
    // 階段 [x0, z0, x1, z1]（m）。上の階へ上れる階段として3Dにする
    stairs: [2.75, 0.1, 3.54, 2.3],
    walkableStairs: true,
  },
  {
    name: '2階',
    walls: [
      ['h', 0, 0, W], ['h', D, 0, W], ['v', 0, 0, D], ['v', W, 0, D],
      ['h', 2.73, 0, W], ['h', 3.64, 0, W],
      ['v', 1.82, 0, 2.73], ['v', 3.64, 0, 2.73], ['v', 4.55, 3.64, D],
    ],
    openings: [
      ['h', 2.73, 0.5, 1.3, 'door'],
      ['h', 2.73, 2.2, 3.3, 'door'],
      ['h', 2.73, 4.2, 5.0, 'door'],
      ['h', 3.64, 3.0, 3.8, 'door'],
      ['h', 3.64, 5.3, 6.1, 'door'],
      ['h', D, 1.2, 3.0, 'win'], ['h', D, 6.0, 7.8, 'win'],
      ['h', 0, 5.0, 7.5, 'win'],
      ['v', 0, 4.8, 6.0, 'win'], ['v', W, 0.9, 1.9, 'win'], ['v', W, 4.8, 6.0, 'win'],
    ],
    labels: [
      ['納戸', 0.91, 1.4], ['階段', 2.73, 1.4], ['主寝室 8帖', 6.37, 1.4], ['廊下', 6.8, 3.25],
      ['洋室 6帖', 2.27, 5.4], ['洋室 6帖', 6.82, 5.4],
    ],
    // 2階は吹き抜けとして描くだけ（1階の階段がここへ上がってくる）
    stairs: [2.75, 0.1, 3.54, 2.3],
  },
];

function toPx(m) { return MARGIN + m * PX; }

function drawPlan(spec) {
  const c = document.createElement('canvas');
  c.width = Math.round(W * PX + MARGIN * 2);
  c.height = Math.round(D * PX + MARGIN * 2);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);

  // 床の色（和室は畳っぽく）
  g.fillStyle = '#f6efe2';
  g.fillRect(toPx(0), toPx(0), W * PX, D * PX);

  // 壁
  g.fillStyle = '#222';
  const t = WALL * PX;
  for (const [o, at, a, b] of spec.walls) {
    if (o === 'h') g.fillRect(toPx(a) - t / 2, toPx(at) - t / 2, (b - a) * PX + t, t);
    else g.fillRect(toPx(at) - t / 2, toPx(a) - t / 2, t, (b - a) * PX + t);
  }

  // 開口：壁を白く抜いて建具の記号を細線で描く
  for (const [o, at, a, b, kind] of spec.openings) {
    const x = o === 'h' ? toPx(a) : toPx(at) - t / 2;
    const y = o === 'h' ? toPx(at) - t / 2 : toPx(a);
    const w = o === 'h' ? (b - a) * PX : t;
    const h = o === 'h' ? t : (b - a) * PX;
    g.fillStyle = '#fff';
    g.fillRect(x, y, w, h);
    g.strokeStyle = '#444';
    g.lineWidth = 1;
    if (kind === 'win') {
      g.beginPath();
      if (o === 'h') {
        g.moveTo(x, y + h * 0.35); g.lineTo(x + w, y + h * 0.35);
        g.moveTo(x, y + h * 0.65); g.lineTo(x + w, y + h * 0.65);
      } else {
        g.moveTo(x + w * 0.35, y); g.lineTo(x + w * 0.35, y + h);
        g.moveTo(x + w * 0.65, y); g.lineTo(x + w * 0.65, y + h);
      }
      g.stroke();
    } else {
      // 開き戸の軌跡
      const len = (b - a) * PX;
      g.beginPath();
      if (o === 'h') {
        const cy = toPx(at) + t / 2;
        g.moveTo(x, cy); g.lineTo(x, cy + len);
        g.moveTo(x + len, cy);
        g.arc(x, cy, len, 0, Math.PI / 2);
      } else {
        const cx = toPx(at) + t / 2;
        g.moveTo(cx, y); g.lineTo(cx + len, y);
        g.moveTo(cx, y + len);
        g.arc(cx, y, len, Math.PI / 2, 0, true);
      }
      g.stroke();
    }
  }

  // 階段
  if (spec.stairs) {
    const [x0, z0, x1, z1] = spec.stairs;
    g.strokeStyle = '#666';
    g.lineWidth = 1;
    for (let z = z0; z <= z1; z += 0.23) {
      g.beginPath(); g.moveTo(toPx(x0), toPx(z)); g.lineTo(toPx(x1), toPx(z)); g.stroke();
    }
  }

  // 部屋名
  g.fillStyle = '#333';
  g.font = '14px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const [text, x, z] of spec.labels) g.fillText(text, toPx(x), toPx(z));

  // 寸法線
  g.strokeStyle = '#888';
  g.fillStyle = '#555';
  g.lineWidth = 1;
  g.font = '12px sans-serif';
  const dy = toPx(D) + 40;
  g.beginPath(); g.moveTo(toPx(0), dy); g.lineTo(toPx(W), dy); g.stroke();
  g.fillText(`${(W * 1000).toFixed(0)}`, toPx(W / 2), dy - 10);
  const dx = toPx(0) - 40;
  g.beginPath(); g.moveTo(dx, toPx(0)); g.lineTo(dx, toPx(D)); g.stroke();
  g.save(); g.translate(dx - 10, toPx(D / 2)); g.rotate(-Math.PI / 2); g.fillText(`${(D * 1000).toFixed(0)}`, 0, 0); g.restore();

  g.font = 'bold 18px sans-serif';
  g.textAlign = 'left';
  g.fillText(spec.name, 16, 24);
  return c;
}

/** サンプル間取り図: [{name, canvas, widthM, entrances, stairs, rooms}]（entrances・stairs は [x0, y0, x1, y1] (px) の配列、rooms は [部屋名, x, y] (px)） */
export function samplePlans() {
  const t = WALL / 2;
  return PLANS.map((spec) => ({
    name: spec.name,
    canvas: drawPlan(spec),
    widthM: W + WALL,
    entrances: spec.openings.filter((o) => o[4] === 'entrance').map(([o, at, a, b]) =>
      o === 'h' ? [toPx(a), toPx(at - t), toPx(b), toPx(at + t)] : [toPx(at - t), toPx(a), toPx(at + t), toPx(b)]),
    stairs: spec.walkableStairs ? [spec.stairs.map(toPx)] : [],
    // 部屋名とその位置 (px)。家具を置くときに部屋の種類を決める手がかりにする
    rooms: spec.labels.map(([text, x, z]) => [text, toPx(x), toPx(z)]),
  }));
}

/** サンプル外観（イラスト） */
export function sampleExterior() {
  const c = document.createElement('canvas');
  c.width = 800;
  c.height = 560;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 380);
  sky.addColorStop(0, '#8fc3ea');
  sky.addColorStop(1, '#dcecf7');
  g.fillStyle = sky;
  g.fillRect(0, 0, 800, 560);
  g.fillStyle = '#79a257';
  g.fillRect(0, 440, 800, 120);

  // 屋根
  g.fillStyle = '#3f4650';
  g.beginPath();
  g.moveTo(120, 180); g.lineTo(400, 70); g.lineTo(680, 180); g.closePath();
  g.fill();
  // 外壁
  g.fillStyle = '#e9dcc4';
  g.fillRect(160, 175, 480, 270);
  g.strokeStyle = 'rgba(0,0,0,0.06)';
  for (let y = 185; y < 445; y += 12) { g.beginPath(); g.moveTo(160, y); g.lineTo(640, y); g.stroke(); }
  // 基礎
  g.fillStyle = '#9d9d9d';
  g.fillRect(160, 440, 480, 16);
  // 窓
  g.fillStyle = '#6d8fa8';
  for (const [x, y, w, h] of [[200, 210, 110, 70], [480, 210, 120, 70], [200, 330, 130, 100], [470, 330, 120, 70]]) {
    g.fillRect(x, y, w, h);
    g.strokeStyle = '#eee';
    g.lineWidth = 4;
    g.strokeRect(x, y, w, h);
  }
  // 玄関
  g.fillStyle = '#6b4a31';
  g.fillRect(370, 340, 60, 100);
  return c;
}
