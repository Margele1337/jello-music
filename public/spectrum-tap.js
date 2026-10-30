// sigmarebase MusicManager 频谱采集端复刻（AudioWorklet 版）：
// 每攒满一个 44.1kHz MP3 帧等效时长的块，取帧首 1024 个采样时刻，
// 按原版 convertToPCMFloatArray 语义把 L,R 打包成一个 Float32 值
// （L*65536 + R = s16L*2 + s16R/32768），供主线程做 1024 点 FFT。
// 与自解码 Worker 的 original 预设保持完全相同的窗几何；采集点在音量节点之前。
const EMIT_PAIRS = 1024;

class SpectrumTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const frameSize = options?.processorOptions?.frameSize;
    this.frameSize = Number.isFinite(frameSize) && frameSize > 0 ? Math.round(frameSize) : 1152;
    this.left = new Float32Array(this.frameSize);
    this.right = new Float32Array(this.frameSize);
    this.fill = 0;
  }

  flush(stereo) {
    // Float32 才能保留原版打包后的 ±65536 量纲；Int16 会削波且无法表达该值域。
    const out = new Float32Array(EMIT_PAIRS);
    const take = Math.min(this.frameSize, EMIT_PAIRS);
    for (let i = 0; i < take; i++) {
      out[i] = this.left[i] * 65536 + (stereo ? this.right[i] : 0);
    }
    this.port.postMessage(out, [out.buffer]);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const left = input[0];
    const stereo = input.length > 1 && !!input[1];
    const right = stereo ? input[1] : left;
    let offset = 0;

    while (offset < left.length) {
      const take = Math.min(this.frameSize - this.fill, left.length - offset);
      this.left.set(left.subarray(offset, offset + take), this.fill);
      if (stereo) this.right.set(right.subarray(offset, offset + take), this.fill);
      this.fill += take;
      offset += take;

      if (this.fill === this.frameSize) {
        this.flush(stereo);
        this.fill = 0;
      }
    }

    return true;
  }
}

registerProcessor('spectrum-tap', SpectrumTapProcessor);
