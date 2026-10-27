// 图标来自本项目自有的 Sigma 封面资产（src/assets/sigma/music/artwork.png）。
// ICO 使用 Vista+ 支持的 PNG 载入方式：22 字节目录 + 原始 256x256 PNG。
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'src', 'assets', 'sigma', 'music', 'artwork.png');
const png = fs.readFileSync(source);
if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('icon source is not a PNG');

const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 0;
header[7] = 0;
header[8] = 0;
header[9] = 0;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(header.length, 18);

const buildDir = path.join(root, 'build');
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'icon.ico'), Buffer.concat([header, png]));
fs.copyFileSync(source, path.join(buildDir, 'icon.png'));
console.log('[icon] wrote build/icon.ico and build/icon.png');
