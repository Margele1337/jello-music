export const SPECTRUM_BAR_COUNT = 114;
export const SPECTRUM_MAX_LEVEL = 22560000;

const text = (value, max = 300) => (typeof value === 'string' ? value.slice(0, max) : undefined);

export const sanitizeSpectrumPayload = (input) => {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const levels = new Array(SPECTRUM_BAR_COUNT).fill(0);

  if (Array.isArray(source.levels)) {
    const count = Math.min(SPECTRUM_BAR_COUNT, source.levels.length);
    for (let index = 0; index < count; index += 1) {
      const value = Number(source.levels[index]);
      if (!Number.isFinite(value)) continue;
      levels[index] = Math.max(0, Math.min(SPECTRUM_MAX_LEVEL, value));
    }
  }

  const payload = {
    levels,
    playing: source.playing === true
  };
  if (source.reset === true) payload.reset = true;

  const cover = text(source.cover, 500);
  if (cover !== undefined) payload.cover = cover;
  const title = text(source.title);
  if (title !== undefined) payload.title = title;
  const author = text(source.author);
  if (author !== undefined) payload.author = author;
  return payload;
};
