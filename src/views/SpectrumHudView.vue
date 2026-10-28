<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';

const canvasRef = ref(null);
let target = new Uint8Array(48);
let displayed = new Float32Array(48);
let frame = null;
let unsubscribe = null;

const resizeCanvas = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
};

const draw = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  resizeCanvas();

  const ctx = canvas.getContext('2d');
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (displayed.length !== target.length) {
    displayed = new Float32Array(target.length);
  }

  const count = target.length;
  const gap = Math.max(2, (width / count) * 0.32);
  const barWidth = Math.max(1, (width - gap * (count - 1)) / count);
  const center = height / 2;
  const maxBar = center - 10;

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(255, 105, 180, 0.9)');
  gradient.addColorStop(0.5, 'rgba(254, 254, 254, 0.95)');
  gradient.addColorStop(1, 'rgba(255, 105, 180, 0.9)');
  ctx.fillStyle = gradient;

  for (let index = 0; index < count; index += 1) {
    const next = Number(target[index]) || 0;
    displayed[index] += (next - displayed[index]) * 0.3;
    const barHeight = Math.max(0, (displayed[index] / 255) * maxBar);
    ctx.fillRect(index * (barWidth + gap), center - barHeight, barWidth, barHeight * 2);
  }

  ctx.fillStyle = 'rgba(254, 254, 254, 0.1)';
  ctx.fillRect(0, center - 0.5, width, 1);

  frame = requestAnimationFrame(draw);
};

onMounted(() => {
  unsubscribe = window.jelloSpectrum?.onData?.((bands) => {
    if (Array.isArray(bands)) target = bands;
  }) || null;
  frame = requestAnimationFrame(draw);
});

onBeforeUnmount(() => {
  unsubscribe?.();
  unsubscribe = null;
  if (frame) cancelAnimationFrame(frame);
  frame = null;
});
</script>

<template>
  <main class="spectrum-hud">
    <canvas ref="canvasRef" class="spectrum-canvas"></canvas>
  </main>
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  background: transparent !important;
  overflow: hidden;
}

.spectrum-hud {
  width: 100%;
  height: 100%;
  pointer-events: none;
  user-select: none;
}

.spectrum-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
