import WaveSurfer from './lib/wavesurfer.esm.js'
import RegionsPlugin from './lib/regions.esm.js'
import TimelinePlugin from './lib/timeline.esm.js'

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

// ===== DOM =====
const $ = (id) => document.getElementById(id);
const uploadZone = $('uploadZone');
const fileInput = $('fileInput');
const loadingZone = $('loadingZone');
const editor = $('editor');
const fileNameEl = $('fileName');
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

// ===== Init =====
function init() {
  // Upload
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadAudioFile(file);
  });
  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      loadAudioFile(file);
    } else {
      showToast('请拖入音频文件', 'error');
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

// ===== File Loading =====
async function loadAudioFile(file) {
  showLoading(true);

  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    const arrayBuffer = await file.arrayBuffer();
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    fileNameEl.textContent = file.name;
    showLoading(false);
    showEditor(true);

    initWaveSurfer(URL.createObjectURL(file));

    const dur = audioBuffer.duration;
    startTimeInput.value = formatTime(0);
    endTimeInput.value = formatTime(dur);
    durationDisplay.textContent = formatTime(dur);

    updateVolumeSliderFill();
  } catch (err) {
    console.error('Load error:', err);
    showLoading(false);
    showToast('音频加载失败，请检查文件格式', 'error');
  }
}

function showLoading(show) {
  if (show) {
    uploadZone.classList.add('hidden');
    loadingZone.classList.remove('hidden');
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

    progressFill.style.width = '100%';
    progressText.textContent = '导出完成！';

    // Download
    const url = URL.createObjectURL(mp3Blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = fileNameEl.textContent.replace(/\.[^.]+$/, '');
    a.download = `${baseName}_edited.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast(`已导出 ${formatTime(end - start)} 的 MP3 文件`, 'success');

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
  if (wavesurfer) {
    wavesurfer.destroy();
    wavesurfer = null;
  }
  audioBuffer = null;
  activeRegion = null;
  regionsPlugin = null;
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
