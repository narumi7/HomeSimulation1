// 間取り図の画像から壁・窓・ドアをセル単位のグリッドとして読み取る

export const EMPTY = 0;
export const WALL = 1;
export const WINDOW = 2;
export const DOOR = 3;
export const ENTRANCE = 4;
export const STAIRS = 5;

const MAX_SIDE = 1200;

/**
 * 画像を解析して壁グリッドを作る。
 * @param {HTMLImageElement|HTMLCanvasElement} img  間取り図の画像
 * @param {{threshold?: number, thickness?: number}} opts thickness は処理画像上の px（0 で自動推定）
 */
export function analyzePlan(img, { threshold = 130, thickness = 0 } = {}) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.min(1, MAX_SIDE / Math.max(iw, ih));
  const W = Math.max(1, Math.round(iw * s));
  const H = Math.max(1, Math.round(ih * s));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;

  const dark = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const lum = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
    dark[i] = lum < threshold ? 1 : 0;
  }

  const t = thickness > 0 ? thickness : estimateThickness(dark, W, H);

  // 細い線（寸法線・文字・建具の線）を消して太い壁だけ残す（オープニング処理）
  const r = Math.max(1, Math.round(t * 0.3));
  const opened = dilate(erode(dark, W, H, r), W, H, r);

  // セルに分割
  const cellPx = Math.max(2, Math.round(t / 2));
  const cols = Math.ceil(W / cellPx);
  const rows = Math.ceil(H / cellPx);
  const counts = new Uint16Array(cols * rows);
  for (let y = 0; y < H; y++) {
    const cy = (y / cellPx) | 0;
    for (let x = 0; x < W; x++) {
      if (opened[y * W + x]) counts[cy * cols + ((x / cellPx) | 0)]++;
    }
  }
  const grid = new Uint8Array(cols * rows);
  const need = cellPx * cellPx * 0.35;
  for (let i = 0; i < grid.length; i++) grid[i] = counts[i] >= need ? WALL : EMPTY;

  removeSmallComponents(grid, cols, rows);

  return {
    canvas,
    width: W,
    height: H,
    cellPx,
    cols,
    rows,
    grid,
    thickness: t,
    thickCells: Math.max(1, Math.round(t / cellPx)),
  };
}

/** 壁の太さ（px）を黒画素のランレングス分布から推定 */
function estimateThickness(dark, W, H) {
  const maxLen = Math.max(6, Math.floor(Math.max(W, H) / 15));
  const hist = new Float64Array(maxLen + 2);
  const add = (len) => { if (len >= 3 && len <= maxLen) hist[len] += len; };
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x < W; x++) {
      if (dark[y * W + x]) run++;
      else { add(run); run = 0; }
    }
    add(run);
  }
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y < H; y++) {
      if (dark[y * W + x]) run++;
      else { add(run); run = 0; }
    }
    add(run);
  }
  let best = 8, bestV = 0;
  for (let i = 3; i <= maxLen; i++) {
    const v = hist[i - 1] + hist[i] * 2 + hist[i + 1];
    if (v > bestV) { bestV = v; best = i; }
  }
  return best;
}

function integral(src, W, H) {
  const I = new Uint32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rowSum = 0;
    for (let x = 0; x < W; x++) {
      rowSum += src[y * W + x];
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + rowSum;
    }
  }
  return I;
}

function boxSum(I, W, x0, y0, x1, y1) {
  const w = W + 1;
  return I[(y1 + 1) * w + x1 + 1] - I[y0 * w + x1 + 1] - I[(y1 + 1) * w + x0] + I[y0 * w + x0];
}

function erode(src, W, H, r) {
  const I = integral(src, W, H);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    for (let x = 0; x < W; x++) {
      if (!src[y * W + x]) continue;
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      if (boxSum(I, W, x0, y0, x1, y1) === (x1 - x0 + 1) * (y1 - y0 + 1)) out[y * W + x] = 1;
    }
  }
  return out;
}

function dilate(src, W, H, r) {
  const I = integral(src, W, H);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      if (boxSum(I, W, x0, y0, x1, y1) > 0) out[y * W + x] = 1;
    }
  }
  return out;
}

/** 4近傍でラベリングし、小さな塊（太字の文字や家具など）を消す */
function removeSmallComponents(grid, cols, rows) {
  const label = new Int32Array(cols * rows).fill(-1);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== WALL || label[i] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(i);
    label[i] = id;
    while (stack.length) {
      const c = stack.pop();
      size++;
      const x = c % cols, y = (c / cols) | 0;
      for (const n of [x > 0 ? c - 1 : -1, x < cols - 1 ? c + 1 : -1, y > 0 ? c - cols : -1, y < rows - 1 ? c + cols : -1]) {
        if (n >= 0 && grid[n] === WALL && label[n] < 0) { label[n] = id; stack.push(n); }
      }
    }
    sizes.push(size);
  }
  if (!sizes.length) return;
  const minSize = Math.max(4, Math.max(...sizes) * 0.03);
  for (let i = 0; i < grid.length; i++) {
    if (label[i] >= 0 && sizes[label[i]] < minSize) grid[i] = EMPTY;
  }
}

/**
 * 壁の途切れ（開口部）を見つけて窓・ドアとして埋める。
 * 外に面した開口は窓、内部の開口はドアにする。
 */
export function detectOpenings(plan, metersPerCell, maxOpeningM = 3.0) {
  const { cols, rows, grid, thickCells } = plan;
  const maxGap = Math.max(1, Math.round(maxOpeningM / metersPerCell));

  const horiz = findGaps(grid, cols, rows, maxGap, thickCells);
  const vert = findGaps(transpose(grid, cols, rows), rows, cols, maxGap, thickCells)
    .map(g => ({ cells: g.cells.map(([x, y]) => [y, x]), sides: g.sides.map(([x, y]) => [y, x]) }));
  const gaps = [...horiz, ...vert];

  // いったん壁として埋めてから外部を塗りつぶし、外に面しているかを判定する
  const tmp = grid.slice();
  for (const g of gaps) for (const [x, y] of g.cells) tmp[y * cols + x] = WALL;
  const outside = computeOutside(tmp, cols, rows);

  for (const g of gaps) {
    const exterior = g.sides.some(([x, y]) => x < 0 || y < 0 || x >= cols || y >= rows || outside[y * cols + x]);
    const type = exterior ? WINDOW : DOOR;
    for (const [x, y] of g.cells) if (grid[y * cols + x] === EMPTY) grid[y * cols + x] = type;
  }
  return gaps.length;
}

function transpose(grid, cols, rows) {
  const out = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) out[x * rows + y] = grid[y * cols + x];
  return out;
}

/** 横方向の壁の途切れを探す（縦方向は転置して同じ処理を使う） */
function findGaps(grid, cols, rows, maxGap, thick) {
  const at = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows) ? EMPTY : grid[y * cols + x];
  const cand = new Uint8Array(cols * rows);
  const runA = new Int32Array(cols * rows);
  const runB = new Int32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      if (grid[y * cols + x] !== EMPTY) { x++; continue; }
      const a = x;
      while (x < cols && grid[y * cols + x] === EMPTY) x++;
      const b = x - 1;
      if (a > 0 && x < cols && b - a + 1 <= maxGap) {
        for (let i = a; i <= b; i++) {
          cand[y * cols + i] = 1;
          runA[y * cols + i] = a;
          runB[y * cols + i] = b;
        }
      }
    }
  }
  // 上下の行でほぼ同じ範囲の途切れだけをつなぐ（壁の穴と、その先の部屋を分けるため）
  const sameRun = (c, n) => Math.abs(runA[c] - runA[n]) <= 1 && Math.abs(runB[c] - runB[n]) <= 1;

  // 同じ列範囲で縦に重なる候補をまとめる
  const seen = new Uint8Array(cols * rows);
  const gaps = [];
  for (let i = 0; i < cand.length; i++) {
    if (!cand[i] || seen[i]) continue;
    const cells = [];
    const stack = [i];
    seen[i] = 1;
    let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
    while (stack.length) {
      const c = stack.pop();
      const x = c % cols, y = (c / cols) | 0;
      cells.push([x, y]);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const n of [x > 0 ? c - 1 : -1, x < cols - 1 ? c + 1 : -1, y > 0 ? c - cols : -1, y < rows - 1 ? c + cols : -1]) {
        if (n >= 0 && cand[n] && !seen[n] && sameRun(c, n)) { seen[n] = 1; stack.push(n); }
      }
    }
    const h = y1 - y0 + 1;
    if (h > thick + 2) continue; // 廊下や部屋そのもの
    if (x1 - x0 + 1 > maxGap) continue;

    // 開口の上下は壁でないこと
    let wallAbove = 0, wallBelow = 0;
    for (let x = x0; x <= x1; x++) {
      if (at(x, y0 - 1) !== EMPTY) wallAbove++;
      if (at(x, y1 + 1) !== EMPTY) wallBelow++;
    }
    const w = x1 - x0 + 1;
    if (wallAbove > w * 0.5 || wallBelow > w * 0.5) continue;

    // 両端が同じ向きの壁につながっているか（部屋の中に突き出た袖壁の誤検出を防ぐ）
    const ym = (y0 + y1) >> 1;
    if (!validEnd(at, x0 - 1, -1, y0, y1, ym, thick) || !validEnd(at, x1 + 1, 1, y0, y1, ym, thick)) continue;

    const sides = [];
    for (let x = x0; x <= x1; x++) sides.push([x, y0 - 1], [x, y1 + 1]);
    gaps.push({ cells, sides });
  }
  return gaps;
}

function validEnd(at, xe, dir, y0, y1, ym, thick) {
  let up = 0, down = 0;
  while (at(xe, y0 - 1 - up) !== EMPTY && up < 100) up++;
  while (at(xe, y1 + 1 + down) !== EMPTY && down < 100) down++;
  if (Math.min(up, down) <= thick + 1) return true; // 壁の端・L字の角
  let run = 0;
  while (at(xe + dir * run, ym) !== EMPTY && run < 100) run++;
  return run >= thick * 2 + 2; // T字：壁が反対側にも続いている
}

/**
 * グリッドの外周からたどれる空きセル＝建物の外。
 * close > 0 のときは幅 2*close セル程度までの壁の途切れを塞いでから判定する
 * （窓やドアを認識しきれなくても室内が「外」にならないように）。
 */
export function computeOutside(grid, cols, rows, close = 0) {
  let barrier = grid;
  if (close > 0) {
    const solid = new Uint8Array(cols * rows);
    for (let i = 0; i < solid.length; i++) solid[i] = grid[i] !== EMPTY ? 1 : 0;
    barrier = dilate(solid, cols, rows, close);
  }
  const out = new Uint8Array(cols * rows);
  const stack = [];
  const push = (x, y) => {
    const i = y * cols + x;
    if (!out[i] && barrier[i] === EMPTY) { out[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < cols; x++) { push(x, 0); push(x, rows - 1); }
  for (let y = 0; y < rows; y++) { push(0, y); push(cols - 1, y); }
  while (stack.length) {
    const c = stack.pop();
    const x = c % cols, y = (c / cols) | 0;
    if (x > 0) push(x - 1, y);
    if (x < cols - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < rows - 1) push(x, y + 1);
  }
  if (close > 0) {
    // 塞いだ分だけ外側を壁際まで広げ直す
    const grown = dilate(out, cols, rows, close);
    for (let i = 0; i < out.length; i++) out[i] = grown[i] && grid[i] === EMPTY ? 1 : 0;
  }
  return out;
}

/** 壁などが入っているセルの範囲 */
export function gridBounds(grid, cols, rows) {
  let x0 = cols, y0 = rows, x1 = -1, y1 = -1;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (grid[y * cols + x] !== EMPTY) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1 };
}

/** 条件を満たすセルを長方形にまとめる（貪欲法） */
export function mergeRects(cols, rows, test) {
  const used = new Uint8Array(cols * rows);
  const rects = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (used[i] || !test(i)) continue;
      let w = 1;
      while (x + w < cols && !used[i + w] && test(i + w)) w++;
      let h = 1;
      outer: while (y + h < rows) {
        for (let k = 0; k < w; k++) {
          const j = (y + h) * cols + x + k;
          if (used[j] || !test(j)) break outer;
        }
        h++;
      }
      for (let yy = 0; yy < h; yy++) for (let k = 0; k < w; k++) used[(y + yy) * cols + x + k] = 1;
      rects.push({ x, y, w, h });
    }
  }
  return rects;
}
