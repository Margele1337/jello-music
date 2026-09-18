/**
 * 图标生成：从 build/icons-src 的源图生成全套平台图标
 *
 * 源图：
 *   build/icons-src/app.png   —— 应用图标（建议 1024x1024 或 1000x1000 的方形 PNG）
 *   build/icons-src/tray.png  —— 托盘/favicon（建议 82x82 以上，小尺寸对比度高的版本）
 *
 * 运行（PowerShell，需清掉 ELECTRON_RUN_AS_NODE，否则 Electron 会以纯 Node 启动导致 nativeImage 不可用）：
 *   $env:ELECTRON_RUN_AS_NODE=""; & ".\node_modules\.bin\electron.cmd" tools\gen-icons.cjs
 *
 * 产物：build/icons/{icon.ico,icon.icns,linux/*,linux-icon.png,logo.png,tray-icon.*}
 *       src/assets/images/tray/tray-icon*.png、public/favicon.ico、public/assets/images/logo.png
 * 说明：ICO 用 BMP 条目（≤128）+ PNG 条目（256），兼容性最好；ICNS 用 PNG 块。
 */
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = path.join(ROOT, 'build', 'icons-src', 'app.png');
const TRAY_SRC = path.join(ROOT, 'build', 'icons-src', 'tray.png');

function load(src) {
  const img = nativeImage.createFromPath(src);
  if (img.isEmpty()) throw new Error('无法读取图片: ' + src);
  return img;
}
function png(img, size) {
  const target = img.getSize().width === size ? img : img.resize({ width: size, height: size, quality: 'best' });
  return target.toPNG();
}
function bmpDib(img, size) {
  const resized = img.resize({ width: size, height: size, quality: 'best' });
  const bgra = resized.toBitmap(); // BGRA，顶向下的原始像素
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const xorSize = size * size * 4;
  header.writeUInt32LE(xorSize, 20);
  const xor = Buffer.alloc(xorSize);
  for (let y = 0; y < size; y++) {
    const srcRow = y * size * 4;
    const dstRow = (size - 1 - y) * size * 4; // BMP 自底向上
    bgra.copy(xor, dstRow, srcRow, srcRow + size * 4);
  }
  const maskRow = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskRow * size); // 全 0：完全由 alpha 决定
  return Buffer.concat([header, xor, and]);
}
function writeIco(outPath, img, sizes) {
  const entries = sizes.map((size) => (size === 256 ? png(img, size) : bmpDib(img, size)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + sizes.length * 16;
  const dir = [];
  entries.forEach((data, i) => {
    const size = sizes[i];
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    dir.push(e);
  });
  fs.writeFileSync(outPath, Buffer.concat([header, ...dir, ...entries]));
  console.log('ICO ', path.relative(ROOT, outPath), sizes.join('/'));
}
function writeIcns(outPath, img, chunks) {
  const parts = [];
  for (const [type, size] of chunks) {
    const data = png(img, size);
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    parts.push(head, data);
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  fs.writeFileSync(outPath, Buffer.concat([head, body]));
  console.log('ICNS', path.relative(ROOT, outPath));
}
function writePng(outPath, img, size) {
  fs.writeFileSync(outPath, png(img, size));
  console.log('PNG ', path.relative(ROOT, outPath), `${size}x${size}`);
}

// 生成带圆角/圆形遮罩的 PNG（预乘 alpha，边缘 1px 抗锯齿）
function writeRoundedPng(outPath, img, size, shape, radiusRatio) {
  const resized = img.resize({ width: size, height: size, quality: 'best' });
  const bgra = Buffer.from(resized.toBitmap());
  const c = size / 2;
  const r = shape === 'circle' ? c : size * radiusRatio;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let alpha;
      if (shape === 'circle') {
        alpha = Math.min(Math.max(c - Math.hypot(px - c, py - c) + 0.5, 0), 1);
      } else {
        const cx = Math.min(Math.max(px, r), size - r);
        const cy = Math.min(Math.max(py, r), size - r);
        alpha = Math.min(Math.max(r - Math.hypot(px - cx, py - cy) + 0.5, 0), 1);
      }
      const i = (y * size + x) * 4;
      const a = alpha * 255;
      bgra[i] = Math.round(bgra[i] * alpha);
      bgra[i + 1] = Math.round(bgra[i + 1] * alpha);
      bgra[i + 2] = Math.round(bgra[i + 2] * alpha);
      bgra[i + 3] = Math.round(a);
    }
  }
  const out = nativeImage.createFromBitmap(bgra, { width: size, height: size });
  fs.writeFileSync(outPath, out.toPNG());
  console.log('PNG ', path.relative(ROOT, outPath), `${size}x${size}`, shape);
}

app.whenReady().then(() => {
  const appImg = load(APP_SRC);
  const trayImg = load(TRAY_SRC);
  const iconsDir = path.join(ROOT, 'build', 'icons');
  const linuxDir = path.join(iconsDir, 'linux');
  fs.mkdirSync(linuxDir, { recursive: true });

  // 应用图标
  writeIco(path.join(iconsDir, 'icon.ico'), appImg, [16, 24, 32, 48, 64, 128, 256]);
  writeIcns(path.join(iconsDir, 'icon.icns'), appImg, [
    ['ic11', 32], ['ic12', 64], ['ic07', 128], ['ic08', 256], ['ic13', 256], ['ic09', 512], ['ic14', 512]
  ]);
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) writePng(path.join(linuxDir, `${s}x${s}.png`), appImg, s);
  writePng(path.join(iconsDir, 'linux-icon.png'), appImg, 32);
  writePng(path.join(iconsDir, 'logo.png'), appImg, 512);
  writePng(path.join(ROOT, 'public', 'assets', 'images', 'logo.png'), appImg, 512);

  // 托盘 / favicon
  writeIco(path.join(iconsDir, 'tray-icon.ico'), trayImg, [16, 24, 32]);
  writePng(path.join(iconsDir, 'tray-icon.png'), trayImg, 16);
  writePng(path.join(iconsDir, 'tray-icon@2x.png'), trayImg, 32);
  writePng(path.join(ROOT, 'src', 'assets', 'images', 'tray', 'tray-icon.png'), trayImg, 16);
  writePng(path.join(ROOT, 'src', 'assets', 'images', 'tray', 'tray-icon@2x.png'), trayImg, 32);
  writeIco(path.join(ROOT, 'public', 'favicon.ico'), trayImg, [16, 32, 48]);

  // 图片素材：默认头像（圆形）与无封面占位（圆角方形）
  writeRoundedPng(path.join(ROOT, 'public', 'assets', 'images', 'profile.png'), appImg, 256, 'circle', 0);
  writeRoundedPng(path.join(ROOT, 'public', 'assets', 'images', 'ico.png'), appImg, 384, 'rounded', 0.22);

  console.log('图标生成完成');
  app.quit();
}).catch((error) => {
  console.error(error);
  app.quit();
  process.exit(1);
});
