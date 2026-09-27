// 外観写真：色の自動抽出・スポイト・外壁模様の切り取り

const MAX_W = 640;

export class PhotoPanel {
  /**
   * @param {HTMLCanvasElement} canvas  写真を表示するキャンバス
   * @param {{onColor:(kind:string, hex:string)=>void, onTexture:(canvas:HTMLCanvasElement)=>void}} cb  色を取ったとき・模様を切り取ったときの処理
   */
  constructor(canvas, cb) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.cb = cb;
    this.mode = 'wall';
    this.img = null;
    this.sel = null;
    this.drag = null;

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.img) return;
      const p = this.pos(e);
      if (this.mode === 'texture') {
        this.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        canvas.setPointerCapture(e.pointerId);
      } else {
        this.cb.onColor(this.mode, this.sample(p.x, p.y, 3));
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const p = this.pos(e);
      this.drag.x1 = p.x;
      this.drag.y1 = p.y;
      this.sel = this.drag;
      this.draw();
    });
    const end = () => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
      const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      if (w < 6 || h < 6) { this.sel = null; this.draw(); return; }
      this.cb.onTexture(this.crop(x, y, w, h));
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  setImage(img) {
    this.img = img;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const s = Math.min(1, MAX_W / iw);
    this.canvas.width = Math.round(iw * s);
    this.canvas.height = Math.round(ih * s);
    this.sel = null;
    this.draw();
  }

  draw() {
    const { ctx, canvas } = this;
    ctx.drawImage(this.img, 0, 0, canvas.width, canvas.height);
    if (this.sel) {
      const { x0, y0, x1, y1 } = this.sel;
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.restore();
    }
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * this.canvas.width,
      y: ((e.clientY - r.top) / r.height) * this.canvas.height,
    };
  }

  sample(x, y, rad) {
    const x0 = Math.max(0, Math.round(x - rad)), y0 = Math.max(0, Math.round(y - rad));
    const w = Math.min(this.canvas.width - x0, rad * 2 + 1), h = Math.min(this.canvas.height - y0, rad * 2 + 1);
    // 選択枠の線を拾わないよう、元画像から読む
    this.ctx.drawImage(this.img, 0, 0, this.canvas.width, this.canvas.height);
    const d = this.ctx.getImageData(x0, y0, w, h).data;
    this.draw();
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return toHex(r / n, g / n, b / n);
  }

  crop(x, y, w, h) {
    const iw = this.img.naturalWidth || this.img.width;
    const s = iw / this.canvas.width;
    const c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(w * s));
    c.height = Math.max(8, Math.round(h * s));
    c.getContext('2d').drawImage(this.img, x * s, y * s, w * s, h * s, 0, 0, c.width, c.height);
    return c;
  }

  /** 写真の上部を屋根、中央を外壁とみなして代表色を推定する */
  autoColors() {
    const { canvas, ctx } = this;
    const W = canvas.width, H = canvas.height;
    ctx.drawImage(this.img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    this.draw();
    const region = (fy0, fy1, fx0, fx1) => {
      const bins = new Map();
      for (let y = Math.floor(H * fy0); y < H * fy1; y += 2) {
        for (let x = Math.floor(W * fx0); x < W * fx1; x += 2) {
          const i = (y * W + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (b > r + 15 && b >= g && lum > 120) continue;   // 空
          if (g > r + 12 && g > b + 12) continue;             // 植栽
          const key = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5);
          const e = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
          e.n++; e.r += r; e.g += g; e.b += b;
          bins.set(key, e);
        }
      }
      return [...bins.values()].sort((a, b) => b.n - a.n).map((e) => [e.r / e.n, e.g / e.n, e.b / e.n]);
    };
    const walls = region(0.45, 0.8, 0.25, 0.75);
    const roofs = region(0.08, 0.42, 0.2, 0.8);
    if (!walls.length) return null;
    const wall = walls[0];
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const roof = roofs.find((c) => dist(c, wall) > 60) || roofs[0] || [70, 72, 78];
    return { wall: toHex(...wall), roof: toHex(...roof) };
  }
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
