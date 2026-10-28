export const SPECTRUM_BANDS = 48;
export const SPECTRUM_MAX = 255;

export const sanitizeSpectrumBands = (input, count = SPECTRUM_BANDS) => {
  const bands = new Array(count).fill(0);
  if (!Array.isArray(input)) return bands;

  for (let index = 0; index < count; index += 1) {
    const value = Number(input[index]);
    if (!Number.isFinite(value)) continue;
    bands[index] = Math.max(0, Math.min(SPECTRUM_MAX, Math.round(value)));
  }
  return bands;
};
