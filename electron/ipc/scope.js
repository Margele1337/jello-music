// IPC 信任范围解析（纯逻辑，便于测试）。
//
// handler 显式声明 scope，由本模块统一解析成窗口集合后交给 isTrustedSender：
// - 'main'：仅主窗口。危险通道（settings/auth/api/update/window/net 等）一律
//   main-only；HUD 窗口走窄 preload（jelloSpectrum / jelloLyrics），本来就没有
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
