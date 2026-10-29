import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGMA_NET_LEAD_MS,
  SIGMA_QUEUE_MAX,
  SigmaDisplayQueue,
  decideSelfDecode,
  deriveGateFrames,
  findFirstMp3Frame,
  findNextFrameOffset,
  gateFrontierSeconds,
  lineBufferCapFrames,
  parseMp3FrameHeader,
  releaseGatedFrames,
  skipId3Tag
} from '../src/services/audio/mp3Frame.js';

// ===== mp3 帧头构造/解析 =====

// version: 3=MPEG1 2=MPEG2 0=MPEG2.5；layer: 1=Layer III；mode: 3=mono
const buildHeader = ({ version = 3, layer = 1, bitrateIndex = 9, srIndex = 0, padding = 0, mode = 0, protection = 1 }) => {
  const b1 = 0xE0 | (version << 3) | (layer << 1) | protection;
  const b2 = (bitrateIndex << 4) | (srIndex << 2) | (padding << 1);
  const b3 = mode << 6;
  return [0xFF, b1, b2, b3];
};

const bytesOf = (...chunks) => Uint8Array.from(chunks.flat());

test('parses an MPEG1 Layer III 128kbps 44.1kHz stereo frame header', () => {
  const bytes = bytesOf(buildHeader({ bitrateIndex: 9, srIndex: 0 }));
  const header = parseMp3FrameHeader(bytes, 0);
  assert.ok(header);
  assert.equal(header.version, 1);
  assert.equal(header.sampleRate, 44100);
  assert.equal(header.channels, 2);
  assert.equal(header.bitrate, 128000);
  assert.equal(header.samplesPerFrame, 1152);
  // floor(144 * 128000 / 44100) = 417
  assert.equal(header.frameSize, 417);
  assert.ok(Math.abs(header.frameDuration - 1152 / 44100) < 1e-9);
});

test('honors the padding bit and 320kbps/32kHz combination', () => {
  const bytes = bytesOf(buildHeader({ bitrateIndex: 14, srIndex: 2, padding: 1 }));
  const header = parseMp3FrameHeader(bytes, 0);
  assert.equal(header.bitrate, 320000);
  assert.equal(header.sampleRate, 32000);
  // floor(144 * 320000 / 32000) + 1 = 1441
  assert.equal(header.frameSize, 1441);
});

test('parses MPEG2 mono with 576 samples per frame', () => {
  const bytes = bytesOf(buildHeader({ version: 2, bitrateIndex: 8, srIndex: 0, mode: 3 }));
  const header = parseMp3FrameHeader(bytes, 0);
  assert.equal(header.version, 2);
  assert.equal(header.sampleRate, 22050);
  assert.equal(header.channels, 1);
  assert.equal(header.samplesPerFrame, 576);
  // floor(72 * 64000 / 22050) = 208
  assert.equal(header.frameSize, 208);
});

test('rejects invalid headers (reserved bits, free/bad bitrate, non-LayerIII, no sync)', () => {
  assert.equal(parseMp3FrameHeader(bytesOf(buildHeader({ srIndex: 3 })), 0), null);
  assert.equal(parseMp3FrameHeader(bytesOf(buildHeader({ bitrateIndex: 15 })), 0), null);
  assert.equal(parseMp3FrameHeader(bytesOf(buildHeader({ bitrateIndex: 0 })), 0), null);
  assert.equal(parseMp3FrameHeader(bytesOf(buildHeader({ version: 1 })), 0), null);
  assert.equal(parseMp3FrameHeader(bytesOf(buildHeader({ layer: 3 })), 0), null);   // Layer I
  assert.equal(parseMp3FrameHeader(bytesOf([0xFF, 0xF0, 0x90, 0x00]), 0), null);   // 同步位不足
  assert.equal(parseMp3FrameHeader(bytesOf([0xFF, 0xFB, 0x90]), 0), null);         // 字节不够
});

// ===== ID3 跳过与伪同步 =====

test('skipId3Tag computes the synchsafe tag size', () => {
  const tag = [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 100];   // 'ID3' + size=100
  assert.equal(skipId3Tag(Uint8Array.from([...tag, ...new Array(100).fill(0)])), 110);
  assert.equal(skipId3Tag(Uint8Array.from([0xFF, 0xFB, 0x90, 0x00])), 0);
});

test('findFirstMp3Frame skips the ID3 tag including fake syncs inside it', () => {
  const real = buildHeader({ bitrateIndex: 9, srIndex: 0 });           // frameSize 417（含 4 字节帧头）
  const body = new Array(100).fill(0);
  body[10] = 0xFF; body[11] = 0xFB;                                    // 标签内伪同步
  // 标签(110) → 真帧@110 → 帧体填充 → 下一真帧@110+417=527
  const bytes = bytesOf([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 100], body, real, new Array(413).fill(0), real);
  const found = findFirstMp3Frame(bytes);
  assert.ok(found);
  assert.equal(found.offset, 110);
  assert.equal(found.header.sampleRate, 44100);
});

test('findFirstMp3Frame rejects a fake sync whose next frame position is garbage', () => {
  const real = buildHeader({ bitrateIndex: 9, srIndex: 0 });
  const bytes = new Uint8Array(1400);
  bytes.set(real, 0);                    // 伪同步：0+417 处是垃圾
  bytes.set([0x01, 0x02, 0x03, 0x04], 417);
  bytes.set(real, 500);                  // 真帧对：500 与 500+417
  bytes.set(real, 917);
  const found = findFirstMp3Frame(bytes);
  assert.ok(found);
  assert.equal(found.offset, 500);
  assert.equal(findNextFrameOffset(bytes, 1), 500);
});

// ===== 门控常量（B 推导）与净领先 =====

test('deriveGateFrames yields B=33 at 44.1kHz and the 421.7ms net lead', () => {
  assert.equal(deriveGateFrames(44100, 1152), 33);
  assert.equal(deriveGateFrames(48000, 1152), 35);
  assert.equal(deriveGateFrames(32000, 1152), 29);
  assert.equal(deriveGateFrames(22050, 576), 33);

  // 净领先 = (B-17) 帧 ≈ 421.7ms（误差 < 半帧的取整残差）
  const frameMs = (1152 / 44100) * 1000;
  const netLead = (deriveGateFrames(44100, 1152) - (SIGMA_QUEUE_MAX - 1)) * frameMs;
  assert.ok(Math.abs(netLead - SIGMA_NET_LEAD_MS) < frameMs, `net lead ${netLead}`);
});

test('lineBufferCapFrames bounds the main-thread line buffer to about 4 seconds', () => {
  assert.equal(lineBufferCapFrames(44100, 1152), 154);
  assert.equal(lineBufferCapFrames(48000, 1152), 167);
  const seconds = (lineBufferCapFrames(44100, 1152) * 1152) / 44100;
  assert.ok(seconds >= 4 && seconds < 4.05);
});

// ===== 门控规则 + 18 深显示队列（add；>18 shift；读 0 号位不弹出）=====

test('gate releases frames only at or below the currentTime-derived frontier', () => {
  const fd = 1152 / 44100;
  const gateFrames = deriveGateFrames(44100, 1152);
  const frontier = gateFrontierSeconds(0, gateFrames, fd, 0);
  assert.ok(Math.abs(frontier - gateFrames * fd) < 1e-12);

  const lineBuffer = [];
  for (let i = 0; i < 40; i += 1) lineBuffer.push({ time: i * fd, magnitudes: { id: i } });
  const displayQueue = new SigmaDisplayQueue();

  const released = releaseGatedFrames(lineBuffer, frontier, displayQueue);
  assert.equal(released, gateFrames + 1);                 // time <= 前沿（含等号）
  assert.equal(lineBuffer.length, 40 - released);
  assert.equal(displayQueue.size, SIGMA_QUEUE_MAX);       // 超过 18 shift
  // 读 0 号位不弹出：净领先 = (B-17) 帧
  const head = displayQueue.peek();
  assert.equal(head.id, released - SIGMA_QUEUE_MAX);
  assert.equal(displayQueue.peek(), head);
  assert.equal(displayQueue.size, SIGMA_QUEUE_MAX);
  const leadMs = head.id * fd * 1000;
  assert.ok(Math.abs(leadMs - SIGMA_NET_LEAD_MS) < fd * 1000, `visual lead ${leadMs}`);
});

test('user trim shifts the frontier by the trimmed seconds', () => {
  const fd = 1152 / 44100;
  const base = gateFrontierSeconds(10, 33, fd, 0);
  assert.ok(Math.abs(gateFrontierSeconds(10, 33, fd, 0.25) - (base + 0.25)) < 1e-12);
});

test('display queue keeps the newest 18 frames and clears wholesale', () => {
  const queue = new SigmaDisplayQueue();
  for (let i = 0; i < 20; i += 1) queue.add({ id: i });
  assert.equal(queue.size, 18);
  assert.equal(queue.peek().id, 2);
  queue.clear();
  assert.equal(queue.size, 0);
  assert.equal(queue.peek(), null);
});

// ===== 回退判定矩阵 =====

test('decideSelfDecode only admits mp3/flac + WebCodecs + spectrum enabled', () => {
  const base = { extName: 'mp3', hasAudioDecoder: true, spectrumEnabled: true };
  assert.deepEqual(decideSelfDecode(base), { ok: true, reason: '', format: 'mp3' });
  // 大小写不敏感
  assert.equal(decideSelfDecode({ ...base, extName: 'MP3' }).format, 'mp3');
  assert.deepEqual(
    decideSelfDecode({ ...base, extName: 'FLAC' }),
    { ok: true, reason: '', format: 'flac' }
  );
  assert.deepEqual(
    decideSelfDecode({ ...base, extName: 'ogg' }),
    { ok: false, reason: 'ext-unsupported' }
  );
  assert.deepEqual(decideSelfDecode({ ...base, extName: '' }).reason, 'ext-unsupported');
  assert.deepEqual(
    decideSelfDecode({ ...base, hasAudioDecoder: false }),
    { ok: false, reason: 'webcodecs-unavailable' }
  );
  assert.deepEqual(
    decideSelfDecode({ ...base, spectrumEnabled: false }),
    { ok: false, reason: 'spectrum-disabled' }
  );
});

// ===== 门控/容量推导是格式无关的：FLAC 常规块长 4096 直接代入同一公式 =====

test('gate/capacity derivation is format-agnostic with FLAC blocksize 4096', () => {
  // B = round(421.7 / 92.879ms) + 17 = 5 + 17 = 22；净领先 = 5 帧 ≈ 464ms（<1 帧量化残差）
  assert.equal(deriveGateFrames(44100, 4096), 22);
  assert.equal(lineBufferCapFrames(44100, 4096), 44);   // ceil(4*44100/4096) ≈ 4s
  const fd = 4096 / 44100;
  const netLeadMs = (deriveGateFrames(44100, 4096) - (SIGMA_QUEUE_MAX - 1)) * fd * 1000;
  assert.ok(Math.abs(netLeadMs - SIGMA_NET_LEAD_MS) < fd * 1000, `flac net lead ${netLeadMs}`);
});

// ===== getSongUrl 透出 extName + prepareSelfDecode 静默回退 =====

let handler = async () => ({});
globalThis.window = {
  jello: { api: { request: (request) => handler(request) } }
};

const { getSongUrl } = await import('../src/services/api/library.js');
const { prepareSelfDecode } = await import('../src/services/audio/spectrum.js');

test('getSongUrl surfaces the stream extName for the self-decode decision', async () => {
  handler = async (request) => {
    if (request.path === '/privilege/lite') return { status: 1, data: [] };
    return { status: 1, url: ['https://cdn/song.mp3'], extName: 'MP3' };
  };
  const result = await getSongUrl({ hash: 'ABC' }, '320');
  assert.equal(result.extName, 'mp3');

  handler = async (request) => {
    if (request.path === '/privilege/lite') return { status: 1, data: [] };
    if (request.params.quality !== '128') return { status: 1, url: [] };
    return { status: 1, url: ['https://cdn/song.flac'], extName: 'flac' };
  };
  const flac = await getSongUrl({ hash: 'ABC' }, '320');
  assert.equal(flac.extName, 'flac');
});

test('prepareSelfDecode falls back to the remote url without fetching when spectrum is off', async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return { ok: true }; };
  const media = await prepareSelfDecode({ url: 'https://cdn/song.mp3', extName: 'mp3' });
  assert.equal(media.src, 'https://cdn/song.mp3');
  assert.equal(media.decode, null);
  assert.equal(fetched, false);
  delete globalThis.fetch;
});
