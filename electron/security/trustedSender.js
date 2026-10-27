export const isTrustedSender = (event, window) => {
  const sender = event?.sender;
  if (!sender || !window || window.isDestroyed?.()) return false;
  if (window.webContents !== sender) return false;

  const frame = event.senderFrame;
  return !!frame && frame === sender.mainFrame;
};
