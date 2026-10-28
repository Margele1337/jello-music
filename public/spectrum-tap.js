// sigmarebase MusicManager.pushVisualizer 的采集端复刻（AudioWorklet 版）：
// JLayer 每解码一个 MP3 帧（1152 采样/声道）调用一次 pushVisualizer，
// 取 pcm 前 1024 个交错采样（L0,R0,L1,R1... = 前 512 对）做 1024 点 FFT。
// 这里按同样的粒度攒块并回传：未加音量（pre-volume），Int16 量纲与 JLayer 的 short 一致。
const EMIT_SAMPLES = 1024;
const EMIT_PAIRS = EMIT_SAMPLES / 2;

class SpectrumTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const frameSize = options?.processorOptions?.frameSize;
    this.frameSize = Number.isFinite(frameSize) && frameSize > 0 ? Math.round(frameSize) : 1152;
    this.left = new Float32Array(this.frameSize);
    this.right = new Float32Array(this.frameSize);
    this.fill = 0;
  }

  flushMono() {
    const out = new Int16Array(EMIT_SAMPLES);
    for (let i = 0; i < EMIT_SAMPLES; i++) {
      const v = Math.round(this.left[i] * 32768);
      out[i] = v < -32768 ? -32768 : v > 32767 ? 32767 : v;
    }
    this.port.postMessage(out, [out.buffer]);
  }

  flushStereo() {
    const out = new Int16Array(EMIT_SAMPLES);
    for (let i = 0; i < EMIT_PAIRS; i++) {
      const l = Math.round(this.left[i] * 32768);
      const r = Math.round(this.right[i] * 32768);
      out[i * 2] = l < -32768 ? -32768 : l > 32767 ? 32767 : l;
      out[i * 2 + 1] = r < -32768 ? -32768 : r > 32767 ? 32767 : r;
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
        if (stereo) this.flushStereo();
        else this.flushMono();
        this.fill = 0;
      }
    }

    return true;
  }
}

registerProcessor('spectrum-tap', SpectrumTapProcessor);
