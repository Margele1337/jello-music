import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SMOOTHING_COEFFICIENT,
  INFO_BASE,
  TINT_CORNER_FACTOR,
  TINT_CURVE_B,
  TINT_CURVE_M,
  TINT_EXTENT_PX,
  TINT_MASK_PEAK,
  TINT_PEAK_ALPHA,
  TINT_TEXTURE_TEXELS,
  clampHudPosition,
  clampInfoScale,
  hudAnchorPosition,
  hudOffsetFromAnchor,
  hudPositionFromOffset,
  hudSurfaceSize,
  infoLayout,
  legacySmoothingAlpha,
  resolveHudArea,
  scaleHudOffset,
  smoothingAlpha,
  stepAmplitude,
  tintCornerAlpha,
  tintEdgeAlpha,
  tintFalloff,
  tintPixelAlpha
} from '../shared/spectrumHud.js';
import { SETTING_DEFAULTS, sanitizeSettings } from '../shared/settings.js';

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const texelDistance = (texels) => (texels * TINT_EXTENT_PX) / TINT_TEXTURE_TEXELS;

// ===== T1：平滑公式（MusicManager.java:144-149） =====

test('alpha = 系数 × 60/实测帧率，60fps 时即系数本身', () => {
  assert.equal(DEFAULT_SMOOTHING_COEFFICIENT, 0.335);
  assert.ok(Math.abs(smoothingAlpha(0.335, 1000 / 60) - 0.335) < 1e-12);
});

test('帧率越高每步越小（原版 300-1100fps 渲染循环的行为）', () => {
  assert.ok(Math.abs(smoothingAlpha(0.335, 1000 / 144) - 0.335 * (60 / 144)) < 1e-12);
  assert.ok(Math.abs(smoothingAlpha(0.335, 1000 / 300) - 0.067) < 1e-12);
  assert.ok(Math.abs(smoothingAlpha(0.335, 1000 / 1100) - 0.335 * (60 / 1100)) < 1e-12);
  // 单调：帧率↑ → 每步α↓
  const a = smoothingAlpha(0.335, 1000 / 60);
  const b = smoothingAlpha(0.335, 1000 / 240);
  const c = smoothingAlpha(0.335, 1000 / 1000);
  assert.ok(a > b && b > c);
});

test('alpha 上限 1，异常输入返回 0', () => {
  assert.equal(smoothingAlpha(0.335, 1000), 1); // 1fps → min(20.1, 1)
  assert.equal(smoothingAlpha(1, 1000 / 5), 1);
  assert.equal(smoothingAlpha(0.335, 0), 0);
  assert.equal(smoothingAlpha(0.335, -16), 0);
  assert.equal(smoothingAlpha(0.335, Number.NaN), 0);
  assert.equal(smoothingAlpha(0, 1000 / 60), 0);
});

test('legacySmoothingAlpha（预设 2）：1 − exp(−dt/τ)，τ = 1/(系数×60) 秒', () => {
  const tau = 1000 / (0.335 * 60); // ≈49.75ms
  assert.ok(Math.abs(legacySmoothingAlpha(0.335, 1000 / 60) - (1 - Math.exp(-(1000 / 60) / tau))) < 1e-12);
  // 60fps 下比原版线性式略小（≈0.289 vs 0.335）——两种预设的缓动差别是刻意保留的
  assert.ok(legacySmoothingAlpha(0.335, 1000 / 60) < smoothingAlpha(0.335, 1000 / 60));
  // 对 dt 单调递增、上限 1
  assert.ok(legacySmoothingAlpha(0.335, 33) > legacySmoothingAlpha(0.335, 16));
  assert.equal(legacySmoothingAlpha(0.335, 1e6), 1);
  // 异常输入约定与 smoothingAlpha 一致
  assert.equal(legacySmoothingAlpha(0.335, 0), 0);
  assert.equal(legacySmoothingAlpha(0, 16), 0);
  assert.equal(legacySmoothingAlpha(0.335, Number.NaN), 0);
});

test('stepAmplitude 与 Java 更新式逐位一致：a - (a - target) * alpha', () => {
  // MusicManager.java:147-149
  const java = (a, target, alpha) => Math.min(2.256e7, Math.max(0, a - (a - target) * alpha));
  const cases = [[1000, 500, 0.335], [0, 2.256e7, 0.1], [900, 1200, 0.5], [2.256e7, 0, 1]];
  for (const [a, target, alpha] of cases) {
    assert.equal(stepAmplitude(a, target, alpha), java(a, target, alpha));
  }
});

test('stepAmplitude 夹在 [0, 2.256e7]，非有限输入按 0 参与更新', () => {
  assert.equal(stepAmplitude(3e7, 3e7, 1), 2.256e7);
  assert.equal(stepAmplitude(0, -5, 1), 0);
  // NaN / Infinity 当成 0 处理，不会把整条平滑链传染成 NaN
  assert.equal(stepAmplitude(Number.NaN, 100, 0.5), 50);
  assert.equal(stepAmplitude(100, Number.POSITIVE_INFINITY, 0.5), 50);
  assert.equal(stepAmplitude(100, 100, Number.NaN), 100);
});

test('渲染层不再用指数式 tau 平滑，改为 Java 的帧率式', () => {
  const view = readFileSync(fileURLToPath(new URL('../src/views/SpectrumHudView.vue', import.meta.url)), 'utf8');
  assert.ok(!/1 - Math\.exp\(-dt/.test(view), '不应保留 1-e^(-dt/tau) 形式');
  assert.ok(view.includes('smoothingAlpha('), '应调用共享的 smoothingAlpha');
  assert.ok(view.includes('stepAmplitude('), '应调用共享的 stepAmplitude');
});

// ===== T2：信息卡几何（MusicManager.java:217-264） =====

test('基准几何：封面 100×100@(10,h-110)，文字 x=130，字号 18/20', () => {
  const h = 1040;
  const layout = infoLayout(1, h);
  assert.deepEqual(layout.cover, { x: 10, y: h - 110, size: 100 });
  assert.equal(layout.textLeft, 130);
  assert.equal(layout.titleSoloTop, h - 70);
  assert.equal(layout.titleSplitTop, h - 81);
  assert.equal(layout.authorTop, h - 56);
  assert.equal(layout.fonts.solo, 18);
  assert.equal(layout.fonts.title, 20);
  assert.equal(layout.fonts.author, 18);
  assert.equal(INFO_BASE.tintExtent, 14);
  assert.equal(INFO_BASE.textLeft, INFO_BASE.coverLeft + INFO_BASE.coverSize + 20);
});

test('脉冲枢轴 = 封面中心再下移 5%（glTranslate(60, h-55)）', () => {
  const h = 1080;
  const layout = infoLayout(1, h);
  assert.deepEqual(layout.pulsePivot, { x: 60, y: h - 55 });
});

test('spectrumInfoScale 是纯倍率，且不含分辨率缩放', () => {
  const h = 900;
  const base = infoLayout(1, h);
  const doubled = infoLayout(2, h);
  assert.equal(base.cover.size, 100);
  assert.equal(doubled.cover.size, 200);
  assert.equal(doubled.cover.x, 20);
  assert.equal(doubled.cover.y, h - 220);
  assert.equal(doubled.textLeft, 260);
  assert.equal(doubled.fonts.title, 40);
  assert.equal(doubled.tintExtent, 28);
  assert.equal(doubled.titleSoloTop, h - 140);
  // 设备像素比只做等比放大
  const retina = infoLayout(1, h * 2, 2);
  assert.equal(retina.cover.size, 200);
  assert.equal(retina.cover.y, h * 2 - 220);
});

test('柔边层矩形 = 封面四周各外扩 14px', () => {
  const h = 1080;
  const layout = infoLayout(1, h);
  assert.equal(layout.tint.x, -4);
  assert.equal(layout.tint.y, h - 124);
  assert.equal(layout.tint.size, 128);
});

test('信息卡倍率默认 1.0 并被夹在 [0.5, 2]', () => {
  assert.equal(SETTING_DEFAULTS.spectrumInfoScale, 1);
  assert.equal(clampInfoScale(0.1), 0.5);
  assert.equal(clampInfoScale(9), 2);
  assert.equal(clampInfoScale(Number.NaN), 1);
  assert.equal(sanitizeSettings({ spectrumInfoScale: 0.2 }).spectrumInfoScale, 0.5);
  assert.equal(sanitizeSettings({ spectrumInfoScale: 3 }).spectrumInfoScale, 2);
  assert.equal(sanitizeSettings({ spectrumInfoScale: 1.4 }).spectrumInfoScale, 1.4);
});

// ===== T4：柔边衰减（RenderUtil.java:730-741） =====

test('着色 #fefefe@0.3 × 黑色遮罩：贴边 alpha = 67/255 × 76/255', () => {
  assert.ok(Math.abs(TINT_PEAK_ALPHA - (67 / 255) * (76 / 255)) < 1e-12);
  assert.ok(Math.abs(tintEdgeAlpha(0) - TINT_PEAK_ALPHA) < 1e-12);
  assert.equal(tintEdgeAlpha(TINT_EXTENT_PX), 0);
  assert.equal(tintEdgeAlpha(TINT_EXTENT_PX + 5), 0);
});

test('柔边单调递减，且不超过 14px 外扩', () => {
  let previous = tintEdgeAlpha(0);
  for (let step = 0.25; step <= TINT_EXTENT_PX; step += 0.25) {
    const value = tintEdgeAlpha(step);
    assert.ok(value <= previous + 1e-12, `d=${step} 处不应回升`);
    previous = value;
  }
  assert.equal(tintEdgeAlpha(20), 0);
});

test('角部是可分离乘积，角尖 = 直边贴边值的 31/67', () => {
  assert.ok(Math.abs(tintCornerAlpha(0, 0) - TINT_PEAK_ALPHA * TINT_CORNER_FACTOR) < 1e-12);
  const expected = TINT_PEAK_ALPHA * TINT_CORNER_FACTOR * tintFalloff(3) * tintFalloff(6);
  assert.ok(Math.abs(tintCornerAlpha(3, 6) - expected) < 1e-12);
  // 乘积形式：两条直边归一化后相乘，再乘角尖系数
  const product = tintEdgeAlpha(3) * tintEdgeAlpha(6) / TINT_PEAK_ALPHA * TINT_CORNER_FACTOR;
  assert.ok(Math.abs(tintCornerAlpha(3, 6) - product) < 1e-12);
});

test('拟合曲线复现原素材灰度罩衰减（20 texel 拉伸到 14px）', () => {
  // 原素材 shadow_left/top 实测峰值序列（0..255 遮罩值），用作行为规格
  const measured = [[0, 67], [2, 57], [4, 46], [6, 36], [8, 27], [10, 19], [12, 13], [14, 8], [16, 4], [19, 1]];
  for (const [texels, mask] of measured) {
    const predicted = 255 * TINT_MASK_PEAK * tintFalloff(texelDistance(texels));
    assert.ok(Math.abs(predicted - mask) <= Math.max(0.8, mask * 0.2),
      `k=${texels} 预测 ${predicted.toFixed(2)} 偏离实测 ${mask}`);
  }
  // 曲线系数保持可见，防止被无声改掉
  assert.equal(TINT_CURVE_B, 0.00793);
  assert.equal(TINT_CURVE_M, 0.0523);
});

test('柔边层取样：封面内部透明，四周走边/角公式', () => {
  const cover = INFO_BASE.coverSize;
  const extent = TINT_EXTENT_PX;
  assert.equal(tintPixelAlpha(50, 50, cover, extent), 0, '封面内部不铺色');
  // 紧贴封面左侧的像素中心距边界 0.5px
  assert.ok(Math.abs(tintPixelAlpha(-1, 50, cover, extent) - tintEdgeAlpha(0.5)) < 1e-12);
  // 顶边中段同距离同值
  assert.ok(Math.abs(tintPixelAlpha(50, -1, cover, extent) - tintEdgeAlpha(0.5)) < 1e-12);
  // 右边/底边
  assert.ok(Math.abs(tintPixelAlpha(cover, 50, cover, extent) - tintEdgeAlpha(0.5)) < 1e-12);
  // 左上角外侧 1px：走乘积式，严格弱于同距离的直边
  const corner = tintPixelAlpha(-1.5, -1.5, cover, extent);
  assert.ok(corner > 0 && corner < tintEdgeAlpha(1.5));
  // 超出外扩范围
  assert.equal(tintPixelAlpha(-extent - 1, 50, cover, extent), 0);
});

test('渲染层用画布柔边层替换 CSS box-shadow', () => {
  const view = readFileSync(fileURLToPath(new URL('../src/views/SpectrumHudView.vue', import.meta.url)), 'utf8');
  assert.ok(!view.includes('box-shadow'), 'box-shadow 近似已删除');
  assert.ok(view.includes('tintPixelAlpha'), '柔边层按共享衰减函数逐像素生成');
});

// ===== T3：整屏 HUD 区域 / 锚定 =====

const displays = [
  { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, size: { width: 1920, height: 1080 } },
  { bounds: { x: 2560, y: 0, width: 2560, height: 1440 }, workArea: { x: 2560, y: 0, width: 2560, height: 1400 }, scaleFactor: 1, size: { width: 2560, height: 1440 } }
];

test('未全屏用工作区，前台全屏用整块显示器区域', () => {
  assert.deepEqual(resolveHudArea(displays, { fullscreen: false, monitor: null }, { x: 0, y: 0, width: 100, height: 100 }),
    { ...displays[0].workArea, fullscreen: false });
  const fullscreen = resolveHudArea(displays, { fullscreen: true, monitor: { x: 0, y: 0, width: 1920, height: 1080 } }, null);
  assert.deepEqual(fullscreen, { ...displays[0].bounds, fullscreen: true });
});

test('前台全屏按物理像素匹配显示器（多屏 + DPI）', () => {
  const hidpi = [
    { bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 0, y: 0, width: 1280, height: 680 }, scaleFactor: 2 },
    { bounds: { x: 1280, y: 0, width: 1280, height: 720 }, workArea: { x: 1280, y: 0, width: 1280, height: 680 }, scaleFactor: 1 }
  ];
  // 第二块屏物理 1280×720 @100%
  const matched = resolveHudArea(hidpi, { fullscreen: true, monitor: { x: 1280, y: 0, width: 1280, height: 720 } }, null);
  assert.equal(matched.x, 1280);
  assert.equal(matched.fullscreen, true);
  // 第一块屏物理 2560×1440 @200%
  const scaled = resolveHudArea(hidpi, { fullscreen: true, monitor: { x: 0, y: 0, width: 2560, height: 1440 } }, null);
  assert.equal(scaled.width, 1280);
  assert.equal(scaled.fullscreen, true);
});

test('无显示器信息时返回 null，交给调用方兜底', () => {
  assert.equal(resolveHudArea([], { fullscreen: false, monitor: null }, null), null);
  assert.equal(resolveHudArea(undefined, null, null), null);
});

test('表面尺寸恒等于区域，未拖动时左下贴底', () => {
  const size = hudSurfaceSize(AREA);
  assert.deepEqual(size, { width: 1920, height: 1040 });
  assert.deepEqual(hudAnchorPosition(AREA, size), { x: 0, y: 0 });
});

test('偏移换算可逆：拖到别处再读回来', () => {
  const size = hudSurfaceSize(AREA);
  const offset = { x: -100, y: -300 };
  const position = hudPositionFromOffset(AREA, size, offset);
  const back = hudOffsetFromAnchor(AREA, size, { x: position.x, y: position.y, height: size.height });
  assert.deepEqual(back, offset);
});

test('DPI 变化时只等比换算用户偏移', () => {
  assert.deepEqual(scaleHudOffset({ x: -100, y: -300 }, 1.5), { x: -150, y: -450 });
  assert.deepEqual(scaleHudOffset({ x: -100, y: -300 }, Number.NaN), { x: -100, y: -300 });
});

test('拖动可以把表面顶出屏幕，但左下角锚点必须留在屏内', () => {
  const size = hudSurfaceSize(AREA);
  // 正常偏移：上移 300（条基线随之抬高，原版整屏绘制的能力）
  const moved = clampHudPosition(AREA, size, hudPositionFromOffset(AREA, size, { x: 0, y: -300 }));
  assert.equal(moved.y, -300);
  assert.equal(moved.x, 0);
  // 拖过头：底边最高只能到区域顶部往下 120px
  const extreme = clampHudPosition(AREA, size, hudPositionFromOffset(AREA, size, { x: 0, y: -5000 }));
  assert.equal(extreme.y + size.height, AREA.y + 120);
  assert.equal(extreme.y, -920);
  // 底边不能低过工作区底（默认锚点即贴底）
  const below = clampHudPosition(AREA, size, hudPositionFromOffset(AREA, size, { x: 0, y: 500 }));
  assert.equal(below.y + size.height, AREA.y + AREA.height);
  assert.equal(below.y, 0);
  // 左右各允许溢出，只要左下角还看得见
  const left = clampHudPosition(AREA, size, hudPositionFromOffset(AREA, size, { x: -5000, y: 0 }));
  assert.equal(left.x, AREA.x - size.width + 120);
  const right = clampHudPosition(AREA, size, hudPositionFromOffset(AREA, size, { x: 5000, y: 0 }));
  assert.equal(right.x, AREA.width - 120);
});

test('HUD 窗口模块不再用固定条高，表面由区域推导', () => {
  const source = readFileSync(fileURLToPath(new URL('../electron/windows/spectrumHud.js', import.meta.url)), 'utf8');
  assert.ok(!source.includes('BASE_WINDOW_HEIGHT'), '280px 条高常量应移除');
  assert.ok(source.includes('resolveHudArea'), '应使用共享区域解析');
  assert.ok(source.includes('getForegroundFullscreenState'), '前台全屏应切到显示器区域');
  assert.ok(source.includes('setIgnoreMouseEvents'), '锁/穿透仍走 setIgnoreMouseEvents');
  // 两级透明度都由渲染层合成：主进程只转发设置，不再走 DWM 整窗 alpha
  assert.ok(!source.includes('setOpacity'), '整窗透明度改由渲染层合成，主进程不应 setOpacity');
  assert.ok(source.includes('spectrumInfoOpacity'), '信息卡透明度应随设置转发给 HUD');
  assert.ok(source.includes('spectrumBarOpacity'), '条形透明度应随设置转发给 HUD');
  assert.ok(source.includes('spectrumMouseFade'), '鼠标靠近透明开关应随设置转发给 HUD');
  assert.ok(source.includes('spectrumMouseFadeRadius'), '渐隐圈半径应随设置转发给 HUD');
});

test('频谱透明度由渲染层按层合成：信息卡 CSS opacity + 条形 canvas globalAlpha', () => {
  const view = readFileSync(fileURLToPath(new URL('../src/views/SpectrumHudView.vue', import.meta.url)), 'utf8');
  // 信息卡 opacity 由 draw() 每帧命令式写入（信息透明度 × 鼠标渐隐系数）
  assert.ok(view.includes('infoEl.style.opacity'), '信息卡透明度应由 draw 每帧写入');
  assert.ok(view.includes('spectrumBarOpacity'), '应接收条形透明度设置');
  assert.ok(view.includes('spectrumMouseFade'), '应接收鼠标靠近透明开关');
  assert.ok(view.includes('spectrumMouseFadeRadius'), '应接收渐隐圈半径设置');
  assert.ok(view.includes('0.4 * barOpacity'), '条内封面叠加应随条形透明度衰减');
  // 关闭动画有整体淡出因子；打开无动画（与恢复播放同款，pendingSnap 瞬间吸附）
  assert.ok(view.includes('closeFade'), '关闭动画应有整体淡出因子');
  assert.ok(!view.includes('openFade'), '打开应吸附而非淡入');
  // 全屏根元素禁止套 CSS opacity：透明窗口的全屏合成层在部分 GPU 下整层不重绘，
  // 表现为设置透明度后整窗空白、换歌触发重绘才恢复
  const rootStart = view.indexOf('<div class="spectrum-hud"');
  const rootTag = view.slice(rootStart, view.indexOf('>', rootStart));
  assert.ok(!rootTag.includes('opacity'), '全屏根元素不应套 CSS opacity');
});

test('解锁态指示不铺压暗底色', () => {
  const view = readFileSync(fileURLToPath(new URL('../src/views/SpectrumHudView.vue', import.meta.url)), 'utf8');
  assert.ok(!view.includes("document.body.style.setProperty('background'"), 'body 压暗底应删除');
  assert.ok(view.includes('.hud-edit-band'), '应改用指示框 + 徽标');
});
