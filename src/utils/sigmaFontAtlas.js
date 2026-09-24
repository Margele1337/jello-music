// Java2D 字形图集：与 sigmarebase 的 Slick TrueTypeFont 同源光栅化（见 tools/font-atlas/FontAtlas.java）
// 浏览器端只做 1:1 贴图，不做文本排版，从而保证英文与原版逐像素一致。
const META_IMPORTS = {
  14: () => import('../assets/sigma/fonts/atlas-light-14.json'),
  20: () => import('../assets/sigma/fonts/atlas-light-20.json'),
  25: () => import('../assets/sigma/fonts/atlas-light-25.json'),
  40: () => import('../assets/sigma/fonts/atlas-light-40.json')
};

const PNG_IMPORTS = {
  14: () => import('../assets/sigma/fonts/atlas-light-14.png?url'),
  20: () => import('../assets/sigma/fonts/atlas-light-20.png?url'),
  25: () => import('../assets/sigma/fonts/atlas-light-25.png?url'),
  40: () => import('../assets/sigma/fonts/atlas-light-40.png?url')
};

const cache = new Map();

// 加载指定字号的图集（含位图与字形度量），重复调用返回同一实例
export const loadSigmaAtlas = (size) => {
  const key = Number(size);
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    const metaLoader = META_IMPORTS[key];
    const pngLoader = PNG_IMPORTS[key];
    if (!metaLoader || !pngLoader) throw new Error('no atlas for size ' + size);
    const meta = (await metaLoader()).default;
    const url = (await pngLoader()).default;
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('failed to load atlas image'));
      img.src = url;
    });
    const atlas = {
      size: key,
      lineHeight: meta.lineHeight,
      ascent: meta.ascent,
      glyphs: meta.glyphs,
      image
    };
    return atlas;
  })();
  cache.set(key, promise);
  return promise;
};

// 与 Slick TrueTypeFont.getWidth 一致：逐字符 advance 累加（无字距调整）
export const measureSigmaText = (atlas, text) => {
  if (!atlas || !text) return 0;
  let width = 0;
  for (const ch of String(text)) {
    const glyph = atlas.glyphs[ch.codePointAt(0)];
    width += glyph ? glyph.adv : Math.round(atlas.size / 2);
  }
  return width;
};

// 按颜色着色（等价于 Slick 的 glColor 染色）：白色字形 + source-in 上色，带缓存
const tintCache = new Map();
const getTintedAtlas = (atlas, color) => {
  if (!color || color === '#ffffff') return atlas.image;
  const key = atlas.size + '|' + color;
  if (tintCache.has(key)) return tintCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = atlas.image.width;
  canvas.height = atlas.image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(atlas.image, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  tintCache.set(key, canvas);
  return canvas;
};

// 与 Slick TrueTypeFont.drawString 一致：按 advance 逐字形贴图，(x, y) 为文本左上角
export const drawSigmaText = (ctx, atlas, text, x, y, alpha = 1, color = '#ffffff') => {
  if (!atlas || !text) return 0;
  const source = getTintedAtlas(atlas, color);
  const prevAlpha = ctx.globalAlpha;
  if (alpha !== 1) ctx.globalAlpha = prevAlpha * alpha;
  let penX = x;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    const glyph = atlas.glyphs[code];
    if (glyph) {
      ctx.drawImage(source, glyph.x, glyph.y, glyph.w, glyph.h, penX, y, glyph.w, glyph.h);
      penX += glyph.adv;
    } else {
      penX += Math.round(atlas.size / 2);
    }
  }
  ctx.globalAlpha = prevAlpha;
  return penX - x;
};
