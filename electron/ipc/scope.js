// IPC 信任范围解析（纯逻辑，便于测试）。
//
// registerIpc 的 handler 必须显式声明允许的发送窗口集合（scope），由本模块
// 统一解析成窗口数组后交给 isTrustedSender 校验。在此之前注册器默认信任
// 「任意自家窗口」，导致清会话/代发 API/改设置这类高危通道对 HUD 窗口
// （歌词/频谱，与主窗口跑同一个 bundle）同样开放。
//
// scope 取值：
// - 'main'：仅主窗口。危险通道（settings:set / auth:clear / api:request /
//   app:restart / net:test-* / update:* / window:*）一律 main-only；
//   两个 HUD 窗口走窄 preload（jelloSpectrum / jelloLyrics），本来就没有
//   这些桥，收紧对真实调用方零影响，纯粹是把设计意图变成强制约束。
// - 'hud'：歌词窗 + 频谱窗。
// - 'any'：三个窗口之一。仅用于保持现状即安全的通道（如频谱数据面）。
//
// 访问器允许返回 null / 已销毁窗口，isTrustedSender 会逐个过滤。
export const resolveScopeWindows = (scope, windows) => {
  switch (scope) {
    case 'main':
      return [windows.main()];
    case 'hud':
      return [windows.lyrics(), windows.spectrum()];
    case 'any':
      return [windows.main(), windows.lyrics(), windows.spectrum()];
    default:
      throw new Error(`unknown ipc scope: ${scope}`);
  }
};
