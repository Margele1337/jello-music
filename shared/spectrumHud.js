// 频谱 HUD 的纯计算（渲染层与主进程共用，便于单测）。
// 逐位对齐 sigmarebase（作者本人项目）行为规格：
//   MusicManager.onRender2D :144-149（平滑）、MusicManager.renderSpectrum :217-264（信息卡几何）、
//   RenderUtil.drawRoundedRect 6 参重载 :730-741（封面四周柔边）。
import { SPECTRUM_MAX_LEVEL } from './spectrum.js';

// ===== 平滑（T1）=====
// 原版：float fps = 60.0F / Minecraft.getFps();
//       a = min(2.256E7, max(0, a - (a - target) * min(0.335F * fps, 1.0F)))
// 用户设置的平滑系数直接替换原版的常量 0.335 作为乘数。
export const DEFAULT_SMOOTHING_COEFFICIENT = 0.335;

// dtMs = 渲染循环实测帧间隔；返回每帧逼近比例 alpha
export const smoothingAlpha = (coefficient, dtMs) => {
  const coefficientValue = Number(coefficient);
  const dt = Number(dtMs);
  if (!Number.isFinite(coefficientValue) || coefficientValue <= 0) return 0;
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  const measuredFps = 1000 / dt;
  return Math.min(coefficientValue * (60 / measuredFps), 1);
};

// 预设 2（legacy）平滑式：legacy HUD 按逐帧瞬时 dt 做指数逼近，
// alpha = 1 − exp(−dt/τ)，τ = 1/(系数×60) 秒（0.335 → τ≈49.8ms）。
// 与原版线性式在 60fps 下略有差别（≈0.29 vs 0.335 每帧），刻意保留两种预设的差异。
export const legacySmoothingAlpha = (coefficient, dtMs) => {
  const coefficientValue = Number(coefficient);
  const dt = Number(dtMs);
  if (!Number.isFinite(coefficientValue) || coefficientValue <= 0) return 0;
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  const tauMs = 1000 / (coefficientValue * 60);
  return Math.min(1, 1 - Math.exp(-dt / tauMs));
};

// MusicManager.java:149 的更新式：a += (target - a) * alpha，并夹到 [0, 2.256e7]
export const stepAmplitude = (current, target, alpha) => {
  const base = Number.isFinite(current) ? current : 0;
  const goal = Number.isFinite(target) ? target : 0;
  const rate = Number.isFinite(alpha) ? alpha : 0;
  const next = base + (goal - base) * rate;
  if (!Number.isFinite(next)) return 0;
  return Math.min(SPECTRUM_MAX_LEVEL, Math.max(0, next));
};

// ===== 信息卡基准几何（T2）=====
// 原版全部是「固定像素」，不随分辨率缩放（只有条高用 heightRatio = h/1080）：
// 封面 100×100 画在 (10, h-110)，文字 x=130（封面右侧 20px），
// 单行歌名顶边 y = h-70，拆分时上行 y = h-81、下行 y = h-56，字号 18 / 20，柔边 14px。
export const INFO_BASE = Object.freeze({
  coverLeft: 10,
  coverBottom: 10,
  coverSize: 100,
  textLeft: 130,
  titleSoloTopFromBottom: 70,
  titleSplitTopFromBottom: 81,
  authorTopFromBottom: 56,
  fontSolo: 18,
  fontTitle: 20,
  fontAuthor: 18,
  lineGap: 5,
  tintExtent: 14
});

export const clampInfoScale = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(2, Math.max(0.5, number));
};

// heightPx / pixelRatio 用设备像素，基准常量用 CSS 像素：结果统一是设备像素。
export const infoLayout = (scale, heightPx, pixelRatio = 1) => {
  const s = clampInfoScale(scale);
  const unit = s * (Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1);
  const h = Number.isFinite(heightPx) ? heightPx : 0;
  const tintExtent = INFO_BASE.tintExtent * unit;
  const coverSize = INFO_BASE.coverSize * unit;
  return {
    scale: s,
    unit,
    cover: {
      x: INFO_BASE.coverLeft * unit,
      y: h - (INFO_BASE.coverBottom + INFO_BASE.coverSize) * unit,
      size: coverSize
    },
    // 柔边层：封面矩形向四周各外扩 tintExtent（RenderUtil.java:733-740 的四条边 + 四个角）
    tint: {
      x: (INFO_BASE.coverLeft - INFO_BASE.tintExtent) * unit,
      y: h - (INFO_BASE.coverBottom + INFO_BASE.coverSize + INFO_BASE.tintExtent) * unit,
      size: coverSize + tintExtent * 2
    },
    tintExtent,
    // 低音脉冲枢轴 (60, h-55) = 封面中心再下移 5%（MusicManager.java:214-216）
    pulsePivot: {
      x: (INFO_BASE.coverLeft + INFO_BASE.coverSize / 2) * unit,
      y: h - (INFO_BASE.coverBottom + INFO_BASE.coverSize * 0.45) * unit
    },
    textLeft: INFO_BASE.textLeft * unit,
    titleSoloTop: h - INFO_BASE.titleSoloTopFromBottom * unit,
    titleSplitTop: h - INFO_BASE.titleSplitTopFromBottom * unit,
    authorTop: h - INFO_BASE.authorTopFromBottom * unit,
    fonts: {
      solo: INFO_BASE.fontSolo * unit,
      title: INFO_BASE.fontTitle * unit,
      author: INFO_BASE.fontAuthor * unit
    }
  };
};

// 单行（无 " - "）用 18 号细体，拆分时上行 20 号中黑 + 下行 18 号细体；
// 字号由 CSS 用同一批基准常量 × var(--info-scale) 给出。

// ===== 柔边衰减（T4）=====
// RenderUtil.java:730 的算法：在目标矩形四周画 4 条边贴图 + 4 个角贴图，
// 外扩距离 = var4(14)，着色 = applyAlpha(LIGHT_GREYISH_BLUE #fefefe, 0.3) → alpha 字节 76。
// 贴图本身是「黑色 RGB + 灰度遮罩」，固定管线 MODULATE 后片元 = texRGBA × colorRGBA，
// 所以落地的其实是黑色、alpha = 遮罩/255 × 76/255；遮罩贴边峰值 67/255，
// 20 texel 被拉伸到 14px（k = d/14×20），衰减实测近似 ln(a) = -(B·k² + M·k)。
export const TINT_EXTENT_PX = INFO_BASE.tintExtent;
export const TINT_TEXTURE_TEXELS = 20;
export const TINT_MASK_PEAK = 67 / 255;
export const TINT_COLOR_ALPHA = Math.trunc(0.3 * 255) / 255;
export const TINT_PEAK_ALPHA = TINT_MASK_PEAK * TINT_COLOR_ALPHA;
export const TINT_CORNER_FACTOR = 31 / 67;
export const TINT_CURVE_B = 0.00793;
export const TINT_CURVE_M = 0.0523;

// 归一化衰减因子 e(d) ∈ (0, 1]，d 为到封面边界的像素距离
export const tintFalloff = (distancePx, extentPx = TINT_EXTENT_PX) => {
  const distance = Number(distancePx);
  const extent = Number(extentPx);
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (extent <= 0) return 0;
  if (distance >= extent) return 0;
  const texels = (distance / extent) * TINT_TEXTURE_TEXELS;
  return Math.exp(-(TINT_CURVE_B * texels * texels + TINT_CURVE_M * texels));
};

// 直边区域（只在一条轴上离开封面矩形）
export const tintEdgeAlpha = (distancePx, extentPx = TINT_EXTENT_PX) => TINT_PEAK_ALPHA * tintFalloff(distancePx, extentPx);

// 角部区域（两条轴都离开封面矩形）：原素材是可分离的乘积形式，
// 角尖实测值 = 直边贴边值的 31/67
export const tintCornerAlpha = (dxPx, dyPx, extentPx = TINT_EXTENT_PX) => TINT_PEAK_ALPHA * TINT_CORNER_FACTOR
  * tintFalloff(dxPx, extentPx) * tintFalloff(dyPx, extentPx);

// 柔边层单点取样：入参是相对「封面矩形左上角」的坐标（单位与 extent 一致）
export const tintPixelAlpha = (x, y, coverSizePx, extentPx = TINT_EXTENT_PX) => {
  if (!(coverSizePx > 0) || !(extentPx > 0)) return 0;
  const cx = Number(x) + 0.5;
  const cy = Number(y) + 0.5;
  const dx = cx < 0 ? -cx : (cx > coverSizePx ? cx - coverSizePx : 0);
  const dy = cy < 0 ? -cy : (cy > coverSizePx ? cy - coverSizePx : 0);
  if (dx === 0 && dy === 0) return 0; // 封面内部不铺色（原版只画四周）
  if (dx === 0) return tintEdgeAlpha(dy, extentPx);
  if (dy === 0) return tintEdgeAlpha(dx, extentPx);
  return tintCornerAlpha(dx, dy, extentPx);
};

// ===== 整屏 HUD 窗口几何（T3）=====
// 允许拖出屏幕，但左下角锚点（条基线 + 信息卡）至少保留这些像素可见
export const HUD_MIN_VISIBLE_PX = 120;

// 前台全屏时用整块显示器区域，否则用工作区（避开任务栏）
export const resolveHudArea = (displays, fullscreenState, preferredBounds) => {
  const list = Array.isArray(displays) ? displays.filter((item) => item && item.bounds && item.workArea) : [];
  if (!list.length) return null;
  const monitor = fullscreenState && fullscreenState.fullscreen ? fullscreenState.monitor : null;
  if (monitor) {
    // Win32 给的是物理像素，Electron 的 bounds 是 DIP：用物理尺寸反查显示器
    const matched = list.find((display) => {
      const factor = display.scaleFactor > 0 ? display.scaleFactor : 1;
      return Math.abs(display.bounds.width * factor - monitor.width) <= 4
        && Math.abs(display.bounds.height * factor - monitor.height) <= 4;
    });
    if (matched) return { ...matched.bounds, fullscreen: true };
  }
  const bounds = preferredBounds && Number.isFinite(preferredBounds.x)
    ? preferredBounds
    : list[0].bounds;
  const containing = list.find((display) => display.bounds.x <= bounds.x
    && display.bounds.y <= bounds.y
    && display.bounds.x + display.bounds.width >= bounds.x + (bounds.width || 1)
    && display.bounds.y + display.bounds.height >= bounds.y + (bounds.height || 1));
  return { ...(containing || list[0]).workArea, fullscreen: false };
};

// HUD 表面恒等于目标区域（整屏），条底边贴区域底部
export const hudSurfaceSize = (area) => ({ width: area.width, height: area.height });

export const hudAnchorPosition = (area, size) => ({
  x: area.x,
  y: area.y + area.height - size.height
});

// 用户拖过的窗口：记录相对锚点的偏移，DPI 变化时等比换算
export const hudOffsetFromAnchor = (area, size, bounds) => ({
  x: (bounds.x ?? area.x) - area.x,
  y: ((bounds.y ?? area.y) + (bounds.height ?? size.height)) - (area.y + area.height)
});

export const hudPositionFromOffset = (area, size, offset) => ({
  x: area.x + (offset?.x || 0),
  y: area.y + area.height - size.height + (offset?.y || 0)
});

export const scaleHudOffset = (offset, ratio) => {
  if (!Number.isFinite(ratio) || ratio <= 0) return { ...offset };
  return {
    x: Math.round((offset?.x || 0) * ratio),
    y: Math.round((offset?.y || 0) * ratio)
  };
};

// 只夹「左下角锚点」，让窗口可以向上/向右溢出，这样拖动仍能改变条基线位置
export const clampHudPosition = (area, size, position) => {
  const minX = area.x - size.width + HUD_MIN_VISIBLE_PX;
  const maxX = area.x + area.width - HUD_MIN_VISIBLE_PX;
  const x = Math.min(Math.max(position.x, minX), maxX);
  const bottom = Math.min(
    Math.max((position.y ?? area.y) + size.height, area.y + HUD_MIN_VISIBLE_PX),
    area.y + area.height
  );
  return { x: Math.round(x), y: Math.round(bottom - size.height) };
};
