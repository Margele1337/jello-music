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

// 高 DPI：1x 位图在 dpr=1.5/2 的屏幕上会被浏览器整体放大，文字发虚/带锯齿。
// 这里按需改用同一套 Java2D 参数光栅化的 2x 图集（tools/font-atlas/FontAtlas.java，
// 字号翻倍），度量统一折算回 CSS px，布局代码不需要区分密度。
// 重新生成（只覆盖实际用到的字号；当前图集由 TeX Gyre Heros 光栅化——
// 开源 Helvetica 克隆，对齐原版 Helvetica Neue Light 观感，见 docs/CLEAN_ROOM.md）：
//   java tools/font-atlas/FontAtlas.java src/assets/sigma/fonts/texgyreheros-regular.otf src/assets/sigma/fonts 12,13,14,20,25,40 atlas-light
//   java tools/font-atlas/FontAtlas.java src/assets/sigma/fonts/texgyreheros-regular.otf src/assets/sigma/fonts 26,28,40,80 atlas2x-light
//   java tools/font-atlas/FontAtlas.java src/assets/sigma/fonts/texgyreheros-regular.otf src/assets/sigma/fonts 12,25 atlas-sans
//   java tools/font-atlas/FontAtlas.java src/assets/sigma/fonts/texgyreheros-regular.otf src/assets/sigma/fonts 24,50 atlas2x-sans
const HIGH_DPI_THRESHOLD = 1.25;
const DENSITY_2X = 2;

const META_IMPORTS_2X = {
  'light-13': () => import('../assets/sigma/fonts/atlas2x-light-26.json'),
  'light-14': () => import('../assets/sigma/fonts/atlas2x-light-28.json'),
  'light-20': () => import('../assets/sigma/fonts/atlas2x-light-40.json'),
  'light-40': () => import('../assets/sigma/fonts/atlas2x-light-80.json'),
  'sans-12': () => import('../assets/sigma/fonts/atlas2x-sans-24.json'),
  'sans-25': () => import('../assets/sigma/fonts/atlas2x-sans-50.json')
};

const PNG_IMPORTS_2X = {
  'light-13': () => import('../assets/sigma/fonts/atlas2x-light-26.png?url'),
  'light-14': () => import('../assets/sigma/fonts/atlas2x-light-28.png?url'),
  'light-20': () => import('../assets/sigma/fonts/atlas2x-light-40.png?url'),
  'light-40': () => import('../assets/sigma/fonts/atlas2x-light-80.png?url'),
  'sans-12': () => import('../assets/sigma/fonts/atlas2x-sans-24.png?url'),
  'sans-25': () => import('../assets/sigma/fonts/atlas2x-sans-50.png?url')
};

// 1.5x 图集实验已移除（150% 屏的半像素/细分歧路），保持 2x + 平滑

const cache = new Map();

const pickDensity = (key) => {
  if (!META_IMPORTS_2X[key]) return 1;
  const dpr = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
  return dpr >= HIGH_DPI_THRESHOLD ? DENSITY_2X : 1;
};

const importsFor = (density) => (density === DENSITY_2X ? [META_IMPORTS_2X, PNG_IMPORTS_2X] : [META_IMPORTS, PNG_IMPORTS]);

// 2x 图集的度量折算回 CSS px（字号越小，取整误差带来的偏移越明显，
// 因此保留小数而不是 Math.round，交给调用方现有的取整逻辑处理）
const toCssMetrics = (meta) => {
  const half = (value) => value / 2;
  const glyphs = {};
  for (const [code, glyph] of Object.entries(meta.glyphs)) {
    glyphs[code] = {
      x: half(glyph.x),
      y: half(glyph.y),
      w: half(glyph.w),
      h: half(glyph.h),
      adv: half(glyph.adv)
    };
  }
  return {
    lineHeight: half(meta.lineHeight),
    ascent: half(meta.ascent),
    glyphs
  };
};

// 加载指定字体族/字号的图集（含位图与字形度量），重复调用返回同一实例
export const loadSigmaAtlas = (size, family = 'light') => {
  const key = family + '-' + Number(size);
  const density = pickDensity(key);
  const cacheKey = key + '@' + density;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const promise = (async () => {
    const [metaImports, pngImports] = importsFor(density);
    const metaLoader = metaImports[key];
    const pngLoader = pngImports[key];
    if (!metaLoader || !pngLoader) throw new Error('no atlas for ' + key);
    const raw = (await metaLoader()).default;
    const url = (await pngLoader()).default;
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('failed to load atlas image'));
      img.src = url;
    });
    const metrics = density === DENSITY_2X ? toCssMetrics(raw) : raw;
    const atlas = {
      size: Number(size),
      family,
      density,
      lineHeight: metrics.lineHeight,
      ascent: metrics.ascent,
      glyphs: metrics.glyphs,
      image
    };
    return atlas;
  })();
  cache.set(cacheKey, promise);
  return promise;
};

// 图集中没有的字形（如中文）改用浏览器字体渲染，与改造前的观感一致
const FALLBACK_STACK = "'SigmaLight', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif";

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

// 按颜色着色（等价于 Slick 的 glColor 染色）：白色字形 + source-in 上色，带缓存。
// 缓存键必须绑定图集图片本身：只看 size|density|color 会让 light-14@2 与 sans-14@2
// 这类同字号同密度的跨字族图集串用着色位图（字形坐标对不上 → 字母错位乱码）。
const tintCache = new WeakMap();
const getTintedAtlas = (atlas, color) => {
  if (!color || color === '#ffffff') return atlas.image;
  let byColor = tintCache.get(atlas.image);
  if (!byColor) {
    byColor = new Map();
    tintCache.set(atlas.image, byColor);
  }
  const cached = byColor.get(color);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = atlas.image.width;
  canvas.height = atlas.image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(atlas.image, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  byColor.set(color, canvas);
  return canvas;
};

// 与 Slick TrueTypeFont.drawString 一致：按 advance 逐字形贴图，(x, y) 为文本左上角。
// 度量是 CSS px，位图是 atlas.density 倍密度，取源矩形时乘回去。
export const drawSigmaText = (ctx, atlas, text, x, y, alpha = 1, color = '#ffffff') => {
  if (!atlas || !text) return 0;
  const source = getTintedAtlas(atlas, color);
  const density = atlas.density || 1;
  const prevAlpha = ctx.globalAlpha;
  if (alpha !== 1) ctx.globalAlpha = prevAlpha * alpha;
  let penX = x;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    const glyph = atlas.glyphs[code];
    if (glyph) {
      ctx.drawImage(source,
        glyph.x * density, glyph.y * density, glyph.w * density, glyph.h * density,
        penX, y, glyph.w, glyph.h);
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
