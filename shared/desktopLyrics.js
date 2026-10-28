const MAX_TEXT = 200;
const MAX_LINES = 500;
const MAX_CHARS_PER_LINE = 300;
const MAX_TIME = 86400000;

const text = (value) => (typeof value === 'string' ? value.slice(0, MAX_TEXT) : '');

const finite = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

// 主窗口 → 歌词窗口：整首逐字歌词（切歌时发一次）
export const sanitizeDesktopLyricLyrics = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { hash: '', title: '', artist: '', lines: [] };
  }

  const lines = Array.isArray(input.lines) ? input.lines.slice(0, MAX_LINES) : [];

  return {
    hash: text(input.hash),
    title: text(input.title),
    artist: text(input.artist),
    lines: lines.map((line) => {
      if (!line || typeof line !== 'object') return { characters: [] };
      const characters = Array.isArray(line.characters)
        ? line.characters.slice(0, MAX_CHARS_PER_LINE).map((char) => {
          if (!Array.isArray(char)) return [''];
          return [String(char[0] ?? '').slice(0, 40), finite(char[1]), finite(char[2])];
        })
        : [];
      const result = { characters };
      if (typeof line.translated === 'string' && line.translated) {
        result.translated = line.translated.slice(0, MAX_TEXT);
      }
      return result;
    })
  };
};

// 主窗口 → 歌词窗口：播放进度心跳
export const sanitizeDesktopLyricProgress = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { time: 0, playing: false };
  }

  return {
    time: Math.max(0, Math.min(MAX_TIME, finite(input.time))),
    playing: input.playing === true
  };
};
