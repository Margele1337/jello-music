const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[(ti|ar|al|by|offset|re|ve):(.*)\]$/i;

const fractionToMs = (fraction) => {
  if (!fraction) return 0;
  if (fraction.length === 3) return Number(fraction);
  if (fraction.length === 2) return Number(fraction) * 10;
  return Number(fraction) * 100;
};

export const parseLrc = (text) => {
  const lines = [];
  let offset = 0;

  for (const raw of String(text || '').split(/\r?\n/)) {
    const meta = META_TAG.exec(raw.trim());
    if (meta) {
      if (meta[1].toLowerCase() === 'offset') offset = Number(meta[2]) || 0;
      continue;
    }

    const times = [];
    TIME_TAG.lastIndex = 0;
    let match = TIME_TAG.exec(raw);
    while (match) {
      const seconds = Number(match[1]) * 60 + Number(match[2]) + fractionToMs(match[3]) / 1000;
      times.push(seconds + offset / 1000);
      match = TIME_TAG.exec(raw);
    }
    if (!times.length) continue;

    const content = raw.replace(TIME_TAG, '').trim();
    if (!content) continue;
    for (const time of times) {
      lines.push({ time: Math.max(0, time), text: content });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
};
