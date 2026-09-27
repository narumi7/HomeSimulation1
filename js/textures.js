// キャンバスで描く簡単なテクスチャ（1枚 = 約1m四方として繰り返す）
import * as THREE from 'three';

function makeCanvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 横張りサイディング（白地にうっすら横目地。色はマテリアル側で乗せる） */
export function sidingTexture() {
  return makeCanvas(256, (g, s) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, s, s);
    const rows = 4;
    for (let i = 0; i < rows; i++) {
      const y = (i * s) / rows;
      const grad = g.createLinearGradient(0, y, 0, y + s / rows);
      grad.addColorStop(0, '#f4f4f4');
      grad.addColorStop(1, '#ffffff');
      g.fillStyle = grad;
      g.fillRect(0, y, s, s / rows);
      g.fillStyle = '#c9c9c9';
      g.fillRect(0, y, s, 2);
    }
  });
}

/** 屋根材（横の段と縦の継ぎ目） */
export function roofTexture() {
  return makeCanvas(256, (g, s) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, s, s);
    const rows = 8;
    for (let i = 0; i < rows; i++) {
      const y = (i * s) / rows;
      g.fillStyle = '#b8b8b8';
      g.fillRect(0, y, s, 3);
      const off = (i % 2) * (s / 8);
      g.fillStyle = '#d6d6d6';
      for (let x = off; x < s; x += s / 4) g.fillRect(x, y, 2, s / rows);
    }
  });
}

/** フローリング */
export function floorTexture() {
  return makeCanvas(256, (g, s) => {
    const boards = 6;
    for (let i = 0; i < boards; i++) {
      const x = (i * s) / boards;
      const v = 225 + ((i * 37) % 30);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, 0, s / boards, s);
      g.fillStyle = '#9a9a9a';
      g.fillRect(x, 0, 1.5, s);
      const cut = ((i * 97) % s);
      g.fillRect(x, cut, s / boards, 1.5);
    }
  });
}

/** 芝生 */
export function grassTexture() {
  return makeCanvas(256, (g, s) => {
    g.fillStyle = '#7fa65a';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2500; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.5 ? 'rgba(90,130,60,0.5)' : 'rgba(150,190,110,0.45)';
      g.fillRect(Math.random() * s, Math.random() * s, 2, 3);
    }
  });
}

/** 写真の一部を切り取った外壁テクスチャ */
export function photoTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
