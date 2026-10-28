// JavaFFT 移植（源自所有者 sigmarebase 的 util/client/music/JavaFFT.java）：
// 就地基-2 FFT，位反转置换 + 旋转因子递推。主线程（tap 回退链路）与
// mp3 自解码 Worker 共用同一实现，保证两条链路频谱数值一致。
export const createSpectrumFft = (size) => {
  const bits = Math.round(Math.log2(size));
  const reverseIndices = new Uint16Array(size);
  for (let i = 0; i < size; i += 1) {
    let reversed = 0;
    for (let bit = 0; bit < bits; bit += 1) reversed = (reversed << 1) | ((i >> bit) & 1);
    reverseIndices[i] = reversed;
  }

  return (realIn, realOut, imagOut) => {
    for (let i = 0; i < size; i += 1) realOut[reverseIndices[i]] = realIn[i];
    imagOut.fill(0);

    let blockEnd = 1;
    for (let blockSize = 2; blockSize <= size; blockSize <<= 1) {
      const deltaAngle = (2 * Math.PI) / blockSize;
      const sm2 = -Math.sin(-2 * deltaAngle);
      const sm1 = -Math.sin(-deltaAngle);
      const cm2 = Math.cos(-2 * deltaAngle);
      const cm1 = Math.cos(-deltaAngle);
      const w = 2 * cm1;

      for (let i = 0; i < size; i += blockSize) {
        let ar2 = cm2;
        let ar1 = cm1;
        let ai2 = sm2;
        let ai1 = sm1;
        for (let j = i, n = 0; n < blockEnd; j += 1, n += 1) {
          const ar0 = w * ar1 - ar2;
          ar2 = ar1;
          ar1 = ar0;
          const ai0 = w * ai1 - ai2;
          ai2 = ai1;
          ai1 = ai0;
          const k = j + blockEnd;
          const tr = ar0 * realOut[k] - ai0 * imagOut[k];
          const ti = ar0 * imagOut[k] + ai0 * realOut[k];
          realOut[k] = realOut[j] - tr;
          imagOut[k] = imagOut[j] - ti;
          realOut[j] += tr;
          imagOut[j] += ti;
        }
      }
      blockEnd = blockSize;
    }
  };
};
