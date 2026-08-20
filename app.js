import WaveSurfer from './lib/wavesurfer.esm.js'
import RegionsPlugin from './lib/regions.esm.js'
import TimelinePlugin from './lib/timeline.esm.js'
import coverDataUrl from './cover-data.js'

// ===== State =====
let audioContext = null;
let audioBuffer = null;
let wavesurfer = null;
let regionsPlugin = null;
let activeRegion = null;
let currentSource = null;
let gainNode = null;
let isPlaying = false;
let playStartTime = 0;
let playStartOffset = 0;
let rafId = null;
let isUpdatingFromInput = false;
let extractRafId = null; // 视频提取进度轮询

// ===== DOM =====
const $ = (id) => document.getElementById(id);
const uploadZone = $('uploadZone');
const fileInput = $('fileInput');
const btnPickAudio = $('btnPickAudio');
const btnPickVideo = $('btnPickVideo');
const loadingZone = $('loadingZone');
const loadingText = $('loadingText');
const editor = $('editor');
const fileNameEl = $('fileName');
const coverThumb = $('coverThumb');
const reuploadBtn = $('reuploadBtn');
const startTimeInput = $('startTime');
const endTimeInput = $('endTime');
const durationDisplay = $('durationDisplay');
const volumeSlider = $('volumeSlider');
const volumeValue = $('volumeValue');
const previewBtn = $('previewBtn');
const exportBtn = $('exportBtn');
const exportProgress = $('exportProgress');
const progressFill = $('progressFill');
const progressText = $('progressText');
const toast = $('toast');

// 视频格式检测
const VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv|avi|flv|3gp)$/i;
const VIDEO_MIME_RE = /^video\//;

// ===== Init =====
function init() {
  // Upload (audio)
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (isVideoFile(file)) {
      loadVideoFile(file);
    } else {
      loadAudioFile(file);
    }
  });

  // 两个按钮：选音频 / 选视频
  btnPickAudio.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.accept = '.mp3,.wav,.ogg,.m4a,.flac,.aac,.wma,.opus,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/x-flac,audio/flac';
    fileInput.click();
  });
  btnPickVideo.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.accept = '.mp4,.webm,.mov,.m4v,.mkv,.avi,.flv,.3gp,video/mp4,video/webm,video/quicktime,video/x-matroska,video/x-msvideo';
    fileInput.click();
  });

  // 点击上传区默认选音频
  uploadZone.addEventListener('click', () => {
    fileInput.accept = '.mp3,.wav,.ogg,.m4a,.flac,.aac,.wma,.opus,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/x-flac,audio/flac';
    fileInput.click();
  });

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (isVideoFile(file)) {
      loadVideoFile(file);
    } else if (file.type.startsWith('audio/')) {
      loadAudioFile(file);
    } else {
      showToast('请拖入音频或视频文件', 'error');
    }
  });

  // Reupload
  reuploadBtn.addEventListener('click', resetEditor);

  // Volume
  volumeSlider.addEventListener('input', handleVolumeChange);

  // Time inputs
  startTimeInput.addEventListener('change', handleTimeChange);
  endTimeInput.addEventListener('change', handleTimeChange);

  // Playback
  previewBtn.addEventListener('click', togglePreview);
  exportBtn.addEventListener('click', exportMP3);
}

function isVideoFile(file) {
  if (VIDEO_MIME_RE.test(file.type)) return true;
  return VIDEO_RE.test(file.name);
}

// ===== File Loading (Audio) =====
async function loadAudioFile(file) {
  showLoading(true, '正在加载音频...');

  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    const arrayBuffer = await file.arrayBuffer();
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    setupEditor(file.name);
  } catch (err) {
    console.error('Load error:', err);
    stopExtractProgress();
    showLoading(false);
    showToast('音频加载失败，请检查文件格式', 'error');
  }
}

// ===== File Loading (Video → Extract Audio) =====
async function loadVideoFile(file) {
  showLoading(true, '正在解析视频...');

  try {
    audioBuffer = await extractAudioFromVideo(file, (pct) => {
      loadingText.textContent = `正在提取视频音频... ${pct}%（实时渲染，视频越长等待越久）`;
    });
    setupEditor(file.name);
  } catch (err) {
    console.error('Video extract error:', err);
    stopExtractProgress();
    showLoading(false);
    showToast('视频音频提取失败：' + (err.message || '未知错误'), 'error');
  }
}

async function extractAudioFromVideo(file, onProgress) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true; // 静音播放，避免出声
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.src = url;

  // 等待元数据加载
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('视频加载超时'));
    }, 30000);
    video.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    video.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('无法读取该视频文件'));
    }, { once: true });
    if (video.readyState >= 1) {
      clearTimeout(timer);
      resolve();
    }
  });

  let duration = video.duration;
  // 个别浏览器 duration 为 Infinity，用 seek 技巧获取真实时长
  if (!isFinite(duration) || duration <= 0) {
    await new Promise((resolve) => {
      video.currentTime = 1e7;
      video.onseeked = () => resolve();
      setTimeout(resolve, 1500);
    });
    duration = video.duration;
  }
  if (!isFinite(duration) || duration <= 0) {
    URL.revokeObjectURL(url);
    throw new Error('无法获取视频时长');
  }

  const sampleRate = 48000;
  const channels = 2;
  const totalFrames = Math.ceil(duration * sampleRate);
  if (totalFrames <= 0) {
    URL.revokeObjectURL(url);
    throw new Error('视频音频为空');
  }

  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineCtx) {
    URL.revokeObjectURL(url);
    throw new Error('当前浏览器不支持离线音频渲染');
  }
  const offlineCtx = new OfflineCtx(channels, totalFrames, sampleRate);

  // 方式1：MediaElementAudioSourceNode（首选）
  // 方式2：captureStream + MediaStreamAudioSourceNode（备选）
  let source;
  try {
    source = offlineCtx.createMediaElementSource(video);
  } catch (e) {
    if (typeof video.captureStream === 'function') {
      const stream = video.captureStream();
      source = offlineCtx.createMediaStreamSource(stream);
    } else {
      URL.revokeObjectURL(url);
      throw new Error('当前浏览器不支持视频音频提取');
    }
  }
  source.connect(offlineCtx.destination);

  // 开始播放以驱动渲染，并轮询进度
  video.play().catch(() => {});
  let lastTick = 0;
  const tick = () => {
    if (onProgress && video.duration) {
      const pct = Math.min(100, Math.round((video.currentTime / video.duration) * 100));
      if (pct !== lastTick) {
        lastTick = pct;
        onProgress(pct);
      }
    }
    extractRafId = requestAnimationFrame(tick);
  };
  tick();

  let rendered;
  try {
    rendered = await offlineCtx.startRendering();
  } finally {
    stopExtractProgress();
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }

  return rendered;
}

function stopExtractProgress() {
  if (extractRafId) {
    cancelAnimationFrame(extractRafId);
    extractRafId = null;
  }
}

// ===== Shared Editor Setup =====
function setupEditor(name) {
  fileNameEl.textContent = name;
  // 显示封面
  if (coverThumb) {
    coverThumb.src = coverDataUrl;
    coverThumb.classList.remove('hidden');
  }
  showLoading(false);
  showEditor(true);

  // 音频 buffer 转 WAV 供 wavesurfer 显示波形
  const wavBlob = bufferToWav(audioBuffer);
  initWaveSurfer(URL.createObjectURL(wavBlob));

  const dur = audioBuffer.duration;
  startTimeInput.value = formatTime(0);
  endTimeInput.value = formatTime(dur);
  durationDisplay.textContent = formatTime(dur);

  updateVolumeSliderFill();
}

function showLoading(show, text) {
  if (show) {
    uploadZone.classList.add('hidden');
    loadingZone.classList.remove('hidden');
    if (text && loadingText) loadingText.textContent = text;
  } else {
    loadingZone.classList.add('hidden');
  }
}

function showEditor(show) {
  if (show) {
    editor.classList.remove('hidden');
  } else {
    editor.classList.add('hidden');
  }
}

// ===== AudioBuffer → WAV Blob =====
function bufferToWav(buffer) {
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const bufferSize = 44 + dataSize;
  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const offset = 44;
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset + (i * numChannels + channel) * bytesPerSample, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

// ===== WaveSurfer =====
function initWaveSurfer(url) {
  if (wavesurfer) {
    wavesurfer.destroy();
  }

  regionsPlugin = RegionsPlugin.create();

  wavesurfer = WaveSurfer.create({
    container: '#waveform',
    url: url,
    waveColor: '#3a3a5a',
    progressColor: '#7c5cff',
    cursorColor: '#ffffff',
    cursorWidth: 2,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    height: 100,
    normalize: true,
    dragToSeek: false,
    interact: false,
    plugins: [
      regionsPlugin,
      TimelinePlugin.create({
        container: '#wave-timeline',
        height: 18,
        style: {
          color: '#606080',
          fontSize: '10px',
        },
      }),
    ],
  });

  wavesurfer.on('ready', () => {
    const duration = wavesurfer.getDuration();

    // Add default region (entire audio)
    activeRegion = regionsPlugin.addRegion({
      start: 0,
      end: duration,
      color: 'rgba(124, 92, 255, 0.12)',
      drag: true,
      resize: true,
      minLength: 0.05,
    });

    updateRegionDisplay();
  });

  // Region events — listen on the plugin object
  regionsPlugin.on('region-updated', (region) => {
    activeRegion = region;
    if (!isUpdatingFromInput) {
      updateRegionDisplay();
    }
  });

  regionsPlugin.on('region-clicked', (region, e) => {
    e.stopPropagation();
    activeRegion = region;
    updateRegionDisplay();
  });
}

function updateRegionDisplay() {
  if (!activeRegion) return;
  startTimeInput.value = formatTime(activeRegion.start);
  endTimeInput.value = formatTime(activeRegion.end);
  durationDisplay.textContent = formatTime(activeRegion.end - activeRegion.start);
}

// ===== Time Input Handler =====
function handleTimeChange() {
  if (!activeRegion || !wavesurfer) return;

  const start = parseTime(startTimeInput.value);
  const end = parseTime(endTimeInput.value);
  const duration = wavesurfer.getDuration();

  if (isNaN(start) || isNaN(end)) {
    showToast('时间格式不正确，请使用 mm:ss.xxx', 'error');
    updateRegionDisplay();
    return;
  }

  if (start < 0 || end > duration) {
    showToast(`时间超出范围（0 ~ ${formatTime(duration)})`, 'error');
    updateRegionDisplay();
    return;
  }

  if (start >= end) {
    showToast('开始时间必须小于结束时间', 'error');
    updateRegionDisplay();
    return;
  }

  // Update region
  isUpdatingFromInput = true;
  try {
    activeRegion.setOptions({ start, end });
  } catch (e) {
    // Fallback: remove & re-add
    activeRegion.remove();
    activeRegion = regionsPlugin.addRegion({
      start,
      end,
      color: 'rgba(124, 92, 255, 0.12)',
      drag: true,
      resize: true,
      minLength: 0.05,
    });
  }
  isUpdatingFromInput = false;
  updateRegionDisplay();
}

// ===== Volume =====
function handleVolumeChange() {
  const vol = parseInt(volumeSlider.value);
  volumeValue.textContent = `${vol}%`;
  updateVolumeSliderFill();

  if (gainNode) {
    gainNode.gain.value = vol / 100;
  }
}

function updateVolumeSliderFill() {
  const val = parseInt(volumeSlider.value);
  const min = parseInt(volumeSlider.min);
  const max = parseInt(volumeSlider.max);
  const pct = ((val - min) / (max - min)) * 100;
  volumeSlider.style.setProperty('--fill', `${pct}%`);
}

// ===== Preview Playback =====
function togglePreview() {
  if (isPlaying) {
    stopPlayback();
  } else {
    playPreview();
  }
}

function playPreview() {
  if (!audioBuffer || !activeRegion) return;

  stopPlayback();

  // Resume audio context (autoplay policy)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  const start = activeRegion.start;
  const end = activeRegion.end;
  const duration = end - start;
  const vol = parseInt(volumeSlider.value) / 100;

  currentSource = audioContext.createBufferSource();
  currentSource.buffer = audioBuffer;

  gainNode = audioContext.createGain();
  gainNode.gain.value = vol;

  currentSource.connect(gainNode);
  gainNode.connect(audioContext.destination);

  currentSource.start(0, start, duration);

  isPlaying = true;
  previewBtn.classList.add('playing');
  previewBtn.querySelector('span').textContent = '停止试听';
  previewBtn.querySelector('svg').innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>';

  playStartTime = audioContext.currentTime;
  playStartOffset = start;

  updateProgress();

  currentSource.onended = () => {
    if (isPlaying) stopPlayback();
  };
}

function updateProgress() {
  if (!isPlaying || !wavesurfer) return;

  const elapsed = audioContext.currentTime - playStartTime;
  const current = playStartOffset + elapsed;

  wavesurfer.setTime(current);

  if (current >= activeRegion.end - 0.02) {
    stopPlayback();
    return;
  }

  rafId = requestAnimationFrame(updateProgress);
}

function stopPlayback() {
  if (currentSource) {
    try {
      currentSource.onended = null;
      currentSource.stop();
    } catch (e) {}
    currentSource = null;
  }

  gainNode = null;
  isPlaying = false;
  previewBtn.classList.remove('playing');
  previewBtn.querySelector('span').textContent = '试听片段';
  previewBtn.querySelector('svg').innerHTML = '<polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>';

  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

// ===== Export MP3 =====
async function exportMP3() {
  if (!audioBuffer || !activeRegion) return;

  if (typeof lamejs === 'undefined') {
    showToast('MP3 编码库加载失败，请刷新重试', 'error');
    return;
  }

  exportBtn.disabled = true;
  exportProgress.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = '正在处理音频...';

  try {
    const start = activeRegion.start;
    const end = activeRegion.end;
    const vol = parseInt(volumeSlider.value) / 100;
    const sampleRate = audioBuffer.sampleRate;
    const channels = Math.min(audioBuffer.numberOfChannels, 2);
    const length = Math.floor((end - start) * sampleRate);

    // Render with volume via OfflineAudioContext
    const offlineCtx = new OfflineAudioContext(channels, length, sampleRate);
    const src = offlineCtx.createBufferSource();
    src.buffer = audioBuffer;

    const gain = offlineCtx.createGain();
    gain.gain.value = vol;

    src.connect(gain);
    gain.connect(offlineCtx.destination);
    src.start(0, start, end - start);

    progressFill.style.width = '30%';
    progressText.textContent = '正在渲染音频...';

    const rendered = await offlineCtx.startRendering();

    progressFill.style.width = '60%';
    progressText.textContent = '正在编码 MP3...';

    // Yield to UI
    await new Promise(r => setTimeout(r, 50));

    const mp3Blob = encodeMP3(rendered);

    // 嵌入封面（ID3v2 标签）
    const finalBlob = embedCoverToMP3(mp3Blob, fileNameEl.textContent);

    progressFill.style.width = '100%';
    progressText.textContent = '导出完成！';

    // Download
    const url = URL.createObjectURL(finalBlob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = fileNameEl.textContent.replace(/\.[^.]+$/, '');
    a.download = `${baseName}_edited.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast(`已导出 ${formatTime(end - start)} 的 MP3 文件（含封面）`, 'success');

    setTimeout(() => {
      exportProgress.classList.add('hidden');
    }, 1500);

  } catch (err) {
    console.error('Export error:', err);
    progressText.textContent = '导出失败: ' + err.message;
    showToast('导出失败，请重试', 'error');
  } finally {
    exportBtn.disabled = false;
  }
}

function encodeMP3(buffer) {
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const kbps = 192;

  const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps);

  const left = floatToInt16(buffer.getChannelData(0));
  const right = numChannels > 1 ? floatToInt16(buffer.getChannelData(1)) : null;

  const blockSize = 1152;
  const mp3Data = [];
  const totalBlocks = Math.ceil(left.length / blockSize);

  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize);
    let mp3buf;

    if (numChannels > 1 && right) {
      const rightChunk = right.subarray(i, i + blockSize);
      mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
    } else {
      mp3buf = encoder.encodeBuffer(leftChunk);
    }

    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }

  const end = encoder.flush();
  if (end.length > 0) {
    mp3Data.push(end);
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
}

function floatToInt16(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

// ===== ID3v2 Cover Embedding =====
function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function utf16Bytes(str) {
  const bytes = new Uint8Array(2 + str.length * 2 + 2);
  const dv = new DataView(bytes.buffer);
  dv.setUint16(0, 0xfeff); // BOM
  for (let i = 0; i < str.length; i++) {
    dv.setUint16(2 + i * 2, str.charCodeAt(i));
  }
  // 末尾双字节终止符（v2.3 文本帧要求）
  dv.setUint16(2 + str.length * 2, 0);
  return bytes;
}

function syncsafe(num) {
  return [
    (num >> 21) & 0x7f,
    (num >> 14) & 0x7f,
    (num >> 7) & 0x7f,
    num & 0x7f,
  ];
}

function buildID3Frame(frameId, data) {
  const header = new Uint8Array(10);
  const textEncoder = new TextEncoder();
  header.set(textEncoder.encode(frameId), 0);
  const dv = new DataView(header.buffer);
  dv.setUint32(4, data.length, false); // v2.3 帧大小为大端
  // flags = 0
  const frame = new Uint8Array(10 + data.length);
  frame.set(header, 0);
  frame.set(data, 10);
  return frame;
}

function embedCoverToMP3(mp3Blob, title) {
  try {
    const coverBytes = dataUrlToBytes(coverDataUrl);
    const mimeStr = 'image/png';

    // APIC 帧数据：编码(1) + MIME(带\0) + 图片类型(1) + 描述(\0) + 图片数据
    const apicData = new Uint8Array(1 + mimeStr.length + 1 + 1 + 1 + coverBytes.length);
    let p = 0;
    apicData[p++] = 0x00; // ISO-8859-1
    for (let i = 0; i < mimeStr.length; i++) apicData[p++] = mimeStr.charCodeAt(i);
    apicData[p++] = 0x00;
    apicData[p++] = 0x03; // Cover (front)
    apicData[p++] = 0x00; // 空描述
    apicData.set(coverBytes, p);

    // 标题/专辑/艺术家（UTF-16 文本帧）
    const tit2 = utf16Bytes(title.replace(/\.[^.]+$/, ''));
    const talb = utf16Bytes('视频音频提取');
    const tpe1 = utf16Bytes('audio-editor-pro');

    const frames = [
      buildID3Frame('APIC', apicData),
      buildID3Frame('TIT2', tit2),
      buildID3Frame('TALB', talb),
      buildID3Frame('TPE1', tpe1),
    ];

    let framesSize = 0;
    frames.forEach(f => framesSize += f.length);

    // ID3v2.3 头
    const header = new Uint8Array(10);
    header.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00], 0); // "ID3" + 3.0 + 无flags
    header.set(syncsafe(framesSize), 6);

    const id3 = new Uint8Array(10 + framesSize);
    id3.set(header, 0);
    let off = 10;
    frames.forEach(f => {
      id3.set(f, off);
      off += f.length;
    });

    return new Blob([id3, mp3Blob], { type: 'audio/mp3' });
  } catch (err) {
    console.error('Cover embed error:', err);
    return mp3Blob; // 嵌入失败时返回原 MP3
  }
}

// ===== Time Utils =====
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00.000';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${pad(mins, 2)}:${pad(secs, 2)}.${pad(ms, 3)}`;
}

function parseTime(str) {
  if (!str) return NaN;
  str = str.trim();
  // Support formats: mm:ss.xxx, mm:ss, ss.xxx, ss, m:ss.xxx
  const match = str.match(/^(?:(\d+):)?(\d+)(?:\.(\d+))?$/);
  if (!match) return NaN;

  const mins = match[1] ? parseInt(match[1]) : 0;
  const secs = parseInt(match[2]);
  const msStr = match[3] || '0';
  const ms = parseInt(msStr.padEnd(3, '0').substring(0, 3));

  if (secs >= 60 && !match[1]) return NaN;

  return mins * 60 + secs + ms / 1000;
}

function pad(n, len) {
  return String(n).padStart(len, '0');
}

// ===== Toast =====
let toastTimer = null;
function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.classList.remove('hidden');

  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

// ===== Reset =====
function resetEditor() {
  stopPlayback();
  stopExtractProgress();
  if (wavesurfer) {
    wavesurfer.destroy();
    wavesurfer = null;
  }
  audioBuffer = null;
  activeRegion = null;
  regionsPlugin = null;
  if (coverThumb) coverThumb.classList.add('hidden');
  showEditor(false);
  uploadZone.classList.remove('hidden');
  fileInput.value = '';
  volumeSlider.value = 100;
  volumeValue.textContent = '100%';
  updateVolumeSliderFill();
  exportProgress.classList.add('hidden');
}

// ===== Start =====
init();
updateVolumeSliderFill();
