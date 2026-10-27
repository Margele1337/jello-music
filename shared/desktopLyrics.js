const MAX_TEXT = 200;

const text = (value) => (typeof value === 'string' ? value.slice(0, MAX_TEXT) : '');

export const EMPTY_DESKTOP_LYRIC_STATE = Object.freeze({
  title: '',
  artist: '',
  current: '',
  next: '',
  playing: false
});

export const sanitizeDesktopLyricState = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ...EMPTY_DESKTOP_LYRIC_STATE };
  }

  return {
    title: text(input.title),
    artist: text(input.artist),
    current: text(input.current),
    next: text(input.next),
    playing: input.playing === true
  };
};
