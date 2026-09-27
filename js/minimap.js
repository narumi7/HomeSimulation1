// ウォークスルー中に、間取り上の現在地と向いている方向を表示するミニマップ
import { WALL, WINDOW, DOOR, ENTRANCE, STAIRS } from './planAnalyzer.js';

const MAX = 220;     // ミニマップの最大サイズ（CSS px）
const MARGIN = 3;    // 建物のまわりの余白（セル）

const CELL_COLORS = {
  [WALL]: '#3a3a3a',
  [WINDOW]: '#5fa8e8',
  [DOOR]: '#bfe3bf',
  [ENTRANCE]: '#e89a2a',
  [STAIRS]: '#c9a6e6',
};

export class Minimap {
  /**
   * @param {HTMLElement} container ミニマップを入れる要素
   * @param {(x:number, z:number) => void} onPick ミニマップをタップした地点（ワールド座標）
   */
  constructor(container, onPick) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.label = document.createElement('div');
    this.label.className = 'minimap-label';
    container.append(this.canvas, this.label);
    this.images = [];
    this.house = null;
    this.floor = -1;

    this.canvas.addEventListener('pointerdown', (e) => {
      const info = this.house?.floors[this.floor];
      if (!info || info.empty) return;
      const r = this.canvas.getBoundingClientRect();
      const img = this.images[this.floor];
      const cx = ((e.clientX - r.left) / r.width) * img.cssW / img.s + img.ox;
      const cy = ((e.clientY - r.top) / r.height) * img.cssH / img.s + img.oy;
      onPick(info.X(cx), info.Z(cy));
    });
  }

  /** 家が作り直されたら各階の地図を描き直す */
  setHouse(house) {
    this.house = house;
    this.images = house.floors.map((info) => (info.empty ? null : this.renderFloor(info, house.obstacles[info.index] || [])));
    this.floor = -1;
  }

  renderFloor(info, obstacles) {
    const { bb, cols, grid, outside } = info;
    const ox = bb.x0 - MARGIN, oy = bb.y0 - MARGIN;
    const wCells = bb.x1 - bb.x0 + 1 + MARGIN * 2;
    const hCells = bb.y1 - bb.y0 + 1 + MARGIN * 2;
    const s = MAX / Math.max(wCells, hCells); // 1セルあたりの CSS px
    const cssW = wCells * s, cssH = hCells * s;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 1セル = 1ピクセルで描いてから拡大する（セルのすき間に線が出ないように）
    const cells = document.createElement('canvas');
    cells.width = wCells;
    cells.height = hCells;
    const cg = cells.getContext('2d');
    const data = cg.createImageData(wCells, hCells);
    const rgba = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
    const colors = Object.fromEntries(Object.entries(CELL_COLORS).map(([k, v]) => [k, rgba(v)]));
    const floorColor = rgba('#f6f1e7'), voidColor = rgba('#d9d2e3');
    for (let y = bb.y0; y <= bb.y1; y++) {
      for (let x = bb.x0; x <= bb.x1; x++) {
        const i = y * cols + x;
        let color = colors[grid[i]];
        if (!color) {
          if (outside[i]) continue;
          color = info.overStairs?.(i) ? voidColor : floorColor;
        }
        data.data.set(color, ((y - oy) * wCells + (x - ox)) * 4);
      }
    }
    cg.putImageData(data, 0, 0);

    const c = document.createElement('canvas');
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(30, 36, 44, 0.55)';
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(cells, 0, 0, c.width, c.height);
    g.scale(dpr * s, dpr * s);
    g.translate(-ox, -oy);

    // 家具
    g.fillStyle = 'rgba(176, 132, 88, 0.85)';
    for (const o of obstacles) {
      const [x0, y0] = info.toCellF(o.x0, o.z0);
      const [x1, y1] = info.toCellF(o.x1, o.z1);
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    // 部屋名
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${10 * dpr}px sans-serif`;
    for (const r of info.rooms || []) {
      if (!r.label || r.area < 2.5) continue;
      const [cx, cy] = info.toCellF(r.center[0], r.center[1]);
      const px = (cx - ox) * s * dpr, py = (cy - oy) * s * dpr;
      g.lineWidth = 3 * dpr;
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.strokeText(r.label, px, py);
      g.fillStyle = '#4a4540';
      g.fillText(r.label, px, py);
    }
    return { canvas: c, ox, oy, s, cssW, cssH, dpr };
  }

  /** 現在地（ワールド座標）と向き（yaw）を描く */
  draw(floor, wx, wz, yaw, fov) {
    const img = this.images[floor];
    const info = this.house?.floors[floor];
    if (!img || !info) return;
    if (floor !== this.floor) {
      this.floor = floor;
      this.canvas.width = img.canvas.width;
      this.canvas.height = img.canvas.height;
      this.canvas.style.width = `${img.cssW}px`;
      this.canvas.style.height = `${img.cssH}px`;
      this.label.textContent = info.name;
    }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(img.canvas, 0, 0);
    const [cx, cy] = info.toCellF(wx, wz);
    const px = (cx - img.ox) * img.s * img.dpr;
    const py = (cy - img.oy) * img.s * img.dpr;
    // 前方向：ワールドの (-sin yaw, -cos yaw) を地図の (x, y) へ
    const ang = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
    const half = (fov * Math.PI) / 360;
    const R = 46 * img.dpr;

    // 視野（扇形）
    const grad = g.createRadialGradient(px, py, 0, px, py, R);
    grad.addColorStop(0, 'rgba(255, 170, 60, 0.55)');
    grad.addColorStop(1, 'rgba(255, 170, 60, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(px, py);
    g.arc(px, py, R, ang - half, ang + half);
    g.closePath();
    g.fill();

    // 現在地の矢印
    const a = 9 * img.dpr;
    g.save();
    g.translate(px, py);
    g.rotate(ang);
    g.beginPath();
    g.moveTo(a, 0);
    g.lineTo(-a * 0.7, a * 0.65);
    g.lineTo(-a * 0.35, 0);
    g.lineTo(-a * 0.7, -a * 0.65);
    g.closePath();
    g.fillStyle = '#e8541e';
    g.strokeStyle = '#fff';
    g.lineWidth = 2 * img.dpr;
    g.fill();
    g.stroke();
    g.restore();
    this.drawCompass(g, img.dpr);
  }

  /** 北の向き（地図の上から時計回りの角度、ラジアン） */
  setNorth(angle) {
    this.north = angle;
  }

  drawCompass(g, dpr) {
    const x = this.canvas.width - 24 * dpr, y = 24 * dpr, r = 9 * dpr;
    const a = this.north || 0;
    g.save();
    g.translate(x, y);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.arc(0, 0, r + 13 * dpr, 0, Math.PI * 2);
    g.fill();
    g.rotate(a);
    g.fillStyle = '#d23c2a';
    g.beginPath();
    g.moveTo(0, -r);
    g.lineTo(r * 0.45, 0);
    g.lineTo(-r * 0.45, 0);
    g.closePath();
    g.fill();
    g.fillStyle = '#555';
    g.beginPath();
    g.moveTo(0, r);
    g.lineTo(r * 0.45, 0);
    g.lineTo(-r * 0.45, 0);
    g.closePath();
    g.fill();
    g.rotate(-a);
    g.fillStyle = '#d23c2a';
    g.font = `bold ${9 * dpr}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // 針の先に「N」
    g.fillText('N', Math.sin(a) * (r + 8 * dpr), -Math.cos(a) * (r + 8 * dpr));
    g.restore();
  }

  show(visible) {
    this.container.hidden = !visible;
  }
}
