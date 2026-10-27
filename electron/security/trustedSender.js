export const isTrustedSender = (event, windows) => {
  const sender = event?.sender;
  if (!sender) return false;

  const list = Array.isArray(windows) ? windows : [windows];
  return list.some((window) => {
    if (!window || window.isDestroyed?.()) return false;
    if (window.webContents !== sender) return false;

    const frame = event.senderFrame;
    return !!frame && frame === sender.mainFrame;
  });
};
