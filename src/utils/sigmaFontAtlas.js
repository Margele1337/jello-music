// Java2D 字形图集：与 sigmarebase 的 Slick TrueTypeFont 同源光栅化（见 tools/font-atlas/FontAtlas.java）
// 浏览器端只做 1:1 贴图，不做文本排版，从而保证英文与原版逐像素一致。
const META_IMPORTS = {
  'light-12': () => import('../assets/sigma/fonts/atlas-light-12.json'),
  'light-13': () => import('../assets/sigma/fonts/atlas-light-13.json'),
  'light-14': () => import('../assets/sigma/fonts/atlas-light-14.json'),
  'light-20': () => import('../assets/sigma/fonts/atlas-light-20.json'),
  'light-25': () => import('../assets/sigma/fonts/atlas-light-25.json'),
  'light-40': () => import('../assets/sigma/fonts/atlas-light-40.json'),
  // sans：Java 逻辑字体，对应 ResourceRegistry.getChineseFont（缩略图卡片/输入框用）
  'sans-12': () => import('../assets/sigma/fonts/atlas-sans-12.json'),
  'sans-25': () => import('../assets/sigma/fonts/atlas-sans-25.json')
};

const PNG_IMPORTS = {
  'light-12': () => import('../assets/sigma/fonts/atlas-light-12.png?url'),
  'light-13': () => import('../assets/sigma/fonts/atlas-light-13.png?url'),
  'light-14': () => import('../assets/sigma/fonts/atlas-light-14.png?url'),
  'light-20': () => import('../assets/sigma/fonts/atlas-light-20.png?url'),
  'light-25': () => import('../assets/sigma/fonts/atlas-light-25.png?url'),
  'light-40': () => import('../assets/sigma/fonts/atlas-light-40.png?url'),
  'sans-12': () => import('../assets/sigma/fonts/atlas-sans-12.png?url'),
  'sans-25': () => import('../assets/sigma/fonts/atlas-sans-25.png?url')
};

const cache = new Map();

// 加载指定字体族/字号的图集（含位图与字形度量），重复调用返回同一实例
export const loadSigmaAtlas = (size, family = 'light') => {
  const key = family + '-' + Number(size);
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    const metaLoader = META_IMPORTS[key];
    const pngLoader = PNG_IMPORTS[key];
    if (!metaLoader || !pngLoader) throw new Error('no atlas for ' + key);
    const meta = (await metaLoader()).default;
    const url = (await pngLoader()).default;
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('failed to load atlas image'));
      img.src = url;
    });
    const atlas = {
      size: Number(size),
      family,
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

// 图集中没有的字形（如中文）改用浏览器字体渲染，与改造前的观感一致
const FALLBACK_STACK = "'JelloLight', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif";

// 与 Slick TrueTypeFont.getWidth 一致：逐字符 advance 累加（无字距调整）
// ctx 可选：提供时缺失字形用浏览器度量（中文），否则按半字号估算
export const measureSigmaText = (atlas, text, ctx = null) => {
  if (!atlas || !text) return 0;
  let width = 0;
  let measured = null;
  for (const ch of String(text)) {
    const glyph = atlas.glyphs[ch.codePointAt(0)];
    if (glyph) {
      width += glyph.adv;
      continue;
    }
    if (ctx) {
      if (measured === null) {
        ctx.save();
        ctx.font = atlas.size + 'px ' + FALLBACK_STACK;
        measured = true;
      }
      width += Math.ceil(ctx.measureText(ch).width);
    } else {
      width += Math.round(atlas.size / 2);
    }
  }
  if (measured) ctx.restore();
  return width;
};

// 超宽截断（对应 CSS text-overflow: ellipsis）
export const truncateSigmaText = (atlas, text, maxWidth, ctx = null) => {
  const full = String(text ?? '');
  if (!atlas || !full) return full;
  if (measureSigmaText(atlas, full, ctx) <= maxWidth) return full;
  let dotsWidth = Math.max(1, Math.round(atlas.size / 2));
  if (ctx) {
    ctx.save();
    ctx.font = atlas.size + 'px ' + FALLBACK_STACK;
    dotsWidth = Math.ceil(ctx.measureText('…').width);
    ctx.restore();
  }
  let result = '';
  let width = 0;
  for (const ch of full) {
    const glyph = atlas.glyphs[ch.codePointAt(0)];
    let adv;
    if (glyph) {
      adv = glyph.adv;
    } else if (ctx) {
      ctx.save();
      ctx.font = atlas.size + 'px ' + FALLBACK_STACK;
      adv = Math.ceil(ctx.measureText(ch).width);
      ctx.restore();
    } else {
      adv = Math.round(atlas.size / 2);
    }
    if (width + adv > maxWidth - dotsWidth) break;
    width += adv;
    result += ch;
  }
  return result + '…';
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
      continue;
    }
    // 图集缺失字形（中文等）：浏览器字体渲染，基线对齐图集 ascent
    ctx.save();
    ctx.font = atlas.size + 'px ' + FALLBACK_STACK;
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(ch, penX, y + atlas.ascent);
    const w = Math.ceil(ctx.measureText(ch).width);
    ctx.restore();
    penX += w;
  }
  ctx.globalAlpha = prevAlpha;
  return penX - x;
};
