// ============ Audio Context ============
let sharedAudioCtx = null;
function getAudioCtx() {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return sharedAudioCtx;
}

// ============ Waveform Drawing ============
const WAVEFORM_COLOR = '#F5A623';

function drawStaticWaveform(canvas, audioBuffer) {
  const ctx = canvas.getContext('2d');
  const w = canvas.offsetWidth || canvas.width;
  const h = canvas.offsetHeight || canvas.height;
  canvas.width = w;
  canvas.height = h;
  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / w);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = WAVEFORM_COLOR;
  for (let i = 0; i < w; i++) {
    let max = 0;
    for (let j = 0; j < step; j++) {
      const v = Math.abs(data[i * step + j] || 0);
      if (v > max) max = v;
    }
    const barH = Math.max(2, max * h * 0.85);
    ctx.fillRect(i, (h - barH) / 2, 1, barH);
  }
}

function drawEmptyWaveform(canvas, duration) {
  const ctx = canvas.getContext('2d');
  const w = canvas.offsetWidth || canvas.width || 300;
  const h = canvas.offsetHeight || canvas.height || 120;
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  const numLines = duration != null ? Math.max(0, duration - 1) : 0;
  if (numLines > 0) {
    ctx.strokeStyle = '#E9EBEE';
    ctx.lineWidth = 1;
    for (let i = 1; i <= numLines; i++) {
      const x = Math.round((w / duration) * i);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }
}

async function createAudioThumbnail(audioBuffer) {
  const canvas = document.createElement('canvas');
  canvas.width = 40;
  canvas.height = 30;
  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / 40);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 40, 30);
  ctx.fillStyle = WAVEFORM_COLOR;
  for (let i = 0; i < 40; i++) {
    let max = 0;
    for (let j = 0; j < step; j++) {
      const v = Math.abs(data[i * step + j] || 0);
      if (v > max) max = v;
    }
    const barH = Math.max(1, max * 28);
    ctx.fillRect(i, (30 - barH) / 2, 1, barH);
  }
  return canvas.toDataURL('image/png');
}

// ============ Real-time Waveform (Recording) ============
const realtimeFrames = {};

function startRealtimeWaveform(canvasId, analyser, duration) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.offsetWidth || 240;
  const h = canvas.offsetHeight || 160;
  canvas.width = w;
  canvas.height = h;

  const fftSize = analyser.fftSize;
  const timeDomainData = new Uint8Array(fftSize);
  const totalMs = (duration || 0) * 1000;
  const columns = new Float32Array(w); // amplitude per x column
  let lastX = 0;
  const startTime = performance.now();

  function draw() {
    realtimeFrames[canvasId] = requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(timeDomainData);

    // Compute mean amplitude of this frame
    let sum = 0;
    for (let i = 0; i < fftSize; i++) {
      sum += Math.abs((timeDomainData[i] - 128) / 128);
    }
    const amp = sum / fftSize;

    // Determine current x position based on elapsed time
    const elapsed = performance.now() - startTime;
    const currentX = totalMs > 0
      ? Math.min(Math.round((elapsed / totalMs) * (w - 1)), w - 1)
      : Math.min(lastX + 1, w - 1);

    for (let x = lastX; x <= currentX; x++) columns[x] = amp;
    lastX = currentX + 1;

    // Redraw
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);

    // Dividers
    if (duration > 1) {
      ctx.strokeStyle = '#E9EBEE';
      ctx.lineWidth = 1;
      for (let i = 1; i < duration; i++) {
        const x = Math.round((w / duration) * i);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }

    // Waveform bars left → right
    ctx.fillStyle = WAVEFORM_COLOR;
    for (let x = 0; x < lastX && x < w; x++) {
      const barH = Math.max(2, columns[x] * h * 3);
      ctx.fillRect(x, (h - barH) / 2, 1, barH);
    }
  }
  draw();
}

function stopRealtimeWaveform(canvasId) {
  if (realtimeFrames[canvasId]) {
    cancelAnimationFrame(realtimeFrames[canvasId]);
    delete realtimeFrames[canvasId];
  }
}

// ============ Train UI ============

function toggleAdvancedOptions() {
  const toggle = document.getElementById('train-advanced-toggle');
  const options = document.getElementById('advanced-options');
  toggle.classList.toggle('active');
  options.classList.toggle('show');
}

function resetAdvancedOptions() {
  document.getElementById('epochs-input').value = 30;
  document.getElementById('batch-size-input').value = 16;
  document.getElementById('learning-rate-input').value = 0.001;
  document.getElementById('validation-split-input').value = 0.15;
}

function resetResultCard() {
  stopResultRecording();
  const resultTitle = document.getElementById('result-title');
  const resultPlaceholder = document.getElementById('result-placeholder');
  const resultContent = document.getElementById('result-content');
  resultTitle.classList.add('train-section-title-gray');
  resultPlaceholder.classList.remove('hidden');
  resultContent.classList.add('hidden');
}

async function finishTraining() {
  const trainBtn = document.getElementById('train-btn');
  const progressWrapper = document.getElementById('train-progress-wrapper');
  trainBtn.disabled = false;
  trainBtn.textContent = '학습하기';
  isTraining = false;
  progressWrapper.classList.remove('show');

  const resultTitle = document.getElementById('result-title');
  const resultPlaceholder = document.getElementById('result-placeholder');
  const resultContent = document.getElementById('result-content');
  resultTitle.classList.remove('train-section-title-gray');
  resultPlaceholder.classList.add('hidden');
  resultContent.classList.remove('hidden');

  await saveTrainedModel();
}

function renderResults(container, results) {
  if (!results || !container) return;
  container.textContent = '';
  results.forEach(r => {
    const item = document.createElement('div');
    item.className = 'result-bar-item';

    const header = document.createElement('div');
    header.className = 'result-bar-header';

    const label = document.createElement('span');
    label.className = 'result-bar-label';
    label.textContent = r.name;

    const value = document.createElement('span');
    value.className = 'result-bar-value';
    value.textContent = r.value.toFixed(1) + '%';

    header.appendChild(label);
    header.appendChild(value);

    const track = document.createElement('div');
    track.className = 'result-bar-track';

    const fill = document.createElement('div');
    fill.className = 'result-bar-fill';
    fill.style.width = r.value + '%';

    track.appendChild(fill);
    item.appendChild(header);
    item.appendChild(track);
    container.appendChild(item);
  });
}

// ============ Result Mode ============

function toggleResultDropdown() {
  const menu = document.getElementById('result-dropdown-menu');
  const btn = menu.closest('.result-dropdown-wrapper').querySelector('.result-dropdown-btn');
  document.querySelectorAll('.result-dropdown-menu.show').forEach(m => { if (m !== menu) { m.classList.remove('show'); } });
  if (!menu.classList.contains('show')) adjustDropdownDirection(menu, btn);
  menu.classList.toggle('show');
}

async function selectResultMode(mode) {
  const text = document.getElementById('result-dropdown-text');
  const menu = document.getElementById('result-dropdown-menu');
  menu.classList.remove('show');
  const map = { upload: '업로드', record: '녹음', sample: '샘플' };
  text.textContent = map[mode];

  stopResultRecording();

  document.querySelectorAll('.result-mode-panel').forEach(p => p.classList.add('hidden'));

  const panel = document.getElementById('result-' + mode + '-mode');
  if (panel) panel.classList.remove('hidden');

  if (mode === 'record') {
    const canvas = document.getElementById('result-record-waveform');
    if (canvas) drawEmptyWaveform(canvas);
    const playBtn = document.getElementById('result-record-play-btn');
    if (playBtn) { playBtn.disabled = true; playBtn.classList.add('disabled'); }
    const bars = document.getElementById('result-record-bars');
    if (bars) bars.classList.add('hidden');
    const err = document.getElementById('result-mic-error');
    if (err) err.classList.add('hidden');
  } else if (mode === 'sample') {
    const placeholder = document.getElementById('result-sample-placeholder');
    const result = document.getElementById('result-sample-result');
    if (placeholder) placeholder.classList.remove('hidden');
    if (result) result.classList.add('hidden');
  } else if (mode === 'upload') {
    const uploadArea = document.getElementById('result-upload-area');
    const uploadResult = document.getElementById('result-upload-result');
    if (uploadArea) uploadArea.classList.remove('hidden');
    if (uploadResult) uploadResult.classList.add('hidden');
  }
}

// ============ Result Upload Audio ============

function handleResultDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.add('dragover');
}

function handleResultDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('dragover');
}

function handleResultDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('dragover');
  const files = event.dataTransfer.files;
  if (files.length > 0) processResultAudioFile(files[0]);
}

function handleResultFileSelect(files) {
  if (!files || files.length === 0) return;
  processResultAudioFile(files[0]);
}

async function processResultAudioFile(file) {
  if (!file.type.startsWith('audio/') && !file.name.match(/\.(wav|mp3)$/i)) return;
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = getAudioCtx();
  let audioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } catch (e) {
    showToast('오디오 파일을 읽을 수 없습니다.');
    return;
  }

  const dataUrl = await fileToDataUrl(file);
  resultAudioStore.upload = dataUrl;

  const uploadArea = document.getElementById('result-upload-area');
  const uploadResult = document.getElementById('result-upload-result');
  if (uploadArea) uploadArea.classList.add('hidden');
  if (uploadResult) uploadResult.classList.remove('hidden');

  const canvas = document.getElementById('result-upload-waveform');
  if (canvas) {
    requestAnimationFrame(() => drawStaticWaveform(canvas, audioBuffer));
  }

  const bars = document.getElementById('result-upload-bars');
  if (bars) {
    const results = await runInference(dataUrl);
    renderResults(bars, results);
  }
}

// ============ Result Recording ============

let resultRecordingState = null;
let isResultRecording = false;
const resultAudioStore = { upload: null, record: null, sample: null };

async function toggleResultRecording() {
  if (isResultRecording) {
    stopResultRecording();
  } else {
    await startResultRecording();
  }
}

async function startResultRecording() {
  const micBtn = document.getElementById('result-record-btn');
  const playBtn = document.getElementById('result-record-play-btn');
  const errDiv = document.getElementById('result-mic-error');

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (errDiv) errDiv.classList.add('hidden');
  } catch (err) {
    if (errDiv) errDiv.classList.remove('hidden');
    return;
  }

  const audioCtx = getAudioCtx();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  startRealtimeWaveform('result-record-waveform', analyser);

  isResultRecording = true;
  if (micBtn) micBtn.classList.add('recording');
  if (playBtn) { playBtn.disabled = true; playBtn.classList.add('disabled'); }

  const chunks = [];
  const mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  mediaRecorder.onstop = async () => {
    stopRealtimeWaveform('result-record-waveform');
    stream.getTracks().forEach(t => t.stop());
    isResultRecording = false;
    if (micBtn) micBtn.classList.remove('recording');

    const blob = new Blob(chunks, { type: 'audio/wav' });
    const dataUrl = await blobToDataUrl(blob);
    resultAudioStore.record = dataUrl;

    const canvas = document.getElementById('result-record-waveform');
    const audioCtx2 = getAudioCtx();
    const ab = await blob.arrayBuffer();
    try {
      const audioBuffer = await audioCtx2.decodeAudioData(ab);
      if (canvas) requestAnimationFrame(() => drawStaticWaveform(canvas, audioBuffer));
    } catch (e) {}

    if (playBtn) { playBtn.disabled = false; playBtn.classList.remove('disabled'); }

    const bars = document.getElementById('result-record-bars');
    if (bars) {
      bars.classList.remove('hidden');
      const results = await runInference(dataUrl);
      renderResults(bars, results);
    }
  };

  resultRecordingState = { mediaRecorder, stream };
  mediaRecorder.start();
}

function stopResultRecording() {
  if (resultRecordingState && resultRecordingState.mediaRecorder) {
    if (resultRecordingState.mediaRecorder.state === 'recording') {
      resultRecordingState.mediaRecorder.stop();
    }
  }
  stopRealtimeWaveform('result-record-waveform');
  isResultRecording = false;
  resultRecordingState = null;
}

async function playResultAudio(mode) {
  const dataUrl = resultAudioStore[mode];
  if (!dataUrl) return;
  try {
    const audio = new Audio(dataUrl);
    audio.play();
  } catch (e) {
    showToast('재생할 수 없습니다.');
  }
}

// ============ Result Sample ============

function toggleResultSampleDropdown() {
  const menu = document.getElementById('result-sample-menu');
  const btn = menu.closest('.result-sample-dropdown-wrapper').querySelector('.result-dropdown-btn');
  document.querySelectorAll('.result-dropdown-menu.show').forEach(m => { if (m !== menu) m.classList.remove('show'); });
  if (!menu.classList.contains('show')) adjustDropdownDirection(menu, btn);
  menu.classList.toggle('show');
}

function selectResultSampleCategory(category) {
  const textEl = document.getElementById('result-sample-text');
  const menu = document.getElementById('result-sample-menu');
  const names = { piano: '피아노', guitar: '기타', drums: '드럼' };
  if (textEl) textEl.textContent = names[category] || category;
  if (menu) menu.classList.remove('show');
  loadResultSampleThumbs(category);
}

function loadResultSampleThumbs(category) {
  const thumbs = document.getElementById('result-sample-thumbs');
  if (!thumbs) return;
  thumbs.textContent = '';
  const msg = document.createElement('p');
  msg.style.cssText = 'font-size:13px;color:#646F7C;padding:8px 0;';
  msg.textContent = '샘플 데이터 준비 중';
  thumbs.appendChild(msg);
}

// ============ Project Management ============
let currentProjectId = null;
let currentProjectName = '새 프로젝트';

document.addEventListener('DOMContentLoaded', () => {
  initProject();
});

function initProject() {
  const urlParams = new URLSearchParams(window.location.search);
  currentProjectId = urlParams.get('project');
  if (currentProjectId) {
    loadProject(currentProjectId);
  } else {
    renderAllClasses();
    loadDefaultSamples();
  }
}

// ============ Default Samples ============

const DEFAULT_SAMPLES = {
  0: { label: '강아지', files: Array.from({length: 10}, (_, i) => `dataset/train/dog/${String(i + 1).padStart(2, '0')}.wav`) },
  1: { label: '고양이', files: Array.from({length: 10}, (_, i) => `dataset/train/cat/${String(i + 1).padStart(2, '0')}.wav`) },
};

async function loadDefaultSamples() {
  const overlay = document.getElementById('loading-overlay');
  const countEl = document.getElementById('loading-count');
  const total = Object.values(DEFAULT_SAMPLES).reduce((s, v) => s + v.files.length, 0);
  let done = 0;

  // 클래스 이름 업데이트
  for (const [idStr, info] of Object.entries(DEFAULT_SAMPLES)) {
    const id = parseInt(idStr);
    classNames[id] = info.label;
    const nameEl = document.getElementById('class-name-' + id);
    if (nameEl) nameEl.textContent = info.label;
  }

  if (overlay) overlay.classList.remove('hidden');
  if (countEl) countEl.textContent = `0 / ${total}`;

  const audioCtx = getAudioCtx();

  for (const [idStr, info] of Object.entries(DEFAULT_SAMPLES)) {
    const id = parseInt(idStr);
    for (const url of info.files) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const arrayBuffer = await resp.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
        const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
        const dataUrl = await blobToDataUrl(blob);
        const thumbnail = await createAudioThumbnail(audioBuffer);
        classSamples[id].push(dataUrl);
        classThumbnails[id] = classThumbnails[id] || [];
        classThumbnails[id].push(thumbnail);
      } catch (e) {
        console.warn('샘플 로드 실패:', url, e);
      }
      done++;
      if (countEl) countEl.textContent = `${done} / ${total}`;
    }
    updateAudioThumbsGrid(id);
    updateAudioPreview(id);
  }

  if (overlay) overlay.classList.add('hidden');
}

const DEFAULT_PROJECT_CONFIG = {};

async function loadProject(projectId) {
  const projectsStr = localStorage.getItem('tm_projects');
  if (projectsStr) {
    try {
      const projects = JSON.parse(projectsStr);
      const project = projects.find(p => p.id === projectId);
      if (project) {
        currentProjectName = project.name;
        const input = document.getElementById('project-name-input');
        if (input) { input.value = project.name; autoResizeProjectInput(input); }
      }
    } catch (e) {}
  }

  const dataStr = localStorage.getItem('tm_project_' + projectId);
  if (dataStr) {
    try {
      const data = JSON.parse(dataStr);
      if (data.classIds) classIds = data.classIds;
      if (data.classCounter) classCounter = data.classCounter;
      if (data.classNames) Object.keys(data.classNames).forEach(k => { classNames[parseInt(k)] = data.classNames[k]; });
      if (data.classSamples) Object.keys(data.classSamples).forEach(k => { classSamples[parseInt(k)] = data.classSamples[k]; });
      if (data.classThumbnails) Object.keys(data.classThumbnails).forEach(k => { classThumbnails[parseInt(k)] = data.classThumbnails[k]; });
      if (data.recordSettings) Object.keys(data.recordSettings).forEach(k => { recordSettings[parseInt(k)] = data.recordSettings[k]; });
      renderAllClasses();
    } catch (e) {}
  }
}

function saveProject() {
  if (!currentProjectId) { showToast('먼저 프로젝트를 생성하세요.'); return; }
  const data = { classIds, classCounter, classNames, classSamples, classThumbnails, recordSettings };
  localStorage.setItem('tm_project_' + currentProjectId, JSON.stringify(data));
  updateProjectMeta();
  showToast('프로젝트가 저장되었습니다.');
}

function updateProjectMeta() {
  const str = localStorage.getItem('tm_projects');
  if (!str) return;
  try {
    const projects = JSON.parse(str);
    const idx = projects.findIndex(p => p.id === currentProjectId);
    if (idx !== -1) {
      projects[idx].name = currentProjectName;
      projects[idx].updatedAt = Date.now();
      projects[idx].classCount = classIds.length;
      localStorage.setItem('tm_projects', JSON.stringify(projects));
    }
  } catch (e) {}
}

function updateProjectName(name) {
  if (!name.trim()) return;
  currentProjectName = name.trim();
  updateProjectMeta();
}

function autoResizeProjectInput(input) {
  const span = document.createElement('span');
  span.style.cssText = 'visibility:hidden;position:absolute;font-size:18px;font-weight:600;font-family:Pretendard,sans-serif;white-space:pre';
  span.textContent = input.value || input.placeholder || '';
  document.body.appendChild(span);
  input.style.width = Math.max(100, Math.min(span.offsetWidth + 24, 400)) + 'px';
  document.body.removeChild(span);
}

// ============ Class Management ============
let classCounter = 2;
let classIds = [0, 1];
const classNames = { 0: '클래스 1', 1: '클래스 2' };
const classSamples = { 0: [], 1: [] };
const classThumbnails = { 0: [], 1: [] };
const recordSettings = { 0: { duration: 3, delay: 0 }, 1: { duration: 3, delay: 0 } };
const isRecordingMap = {};

function renderAllClasses() {
  const container = document.querySelector('.train-section-body');
  if (!container) return;
  container.querySelectorAll('.train-class-card').forEach(c => c.remove());
  const addBtn = container.querySelector('.train-add-class-btn');
  classIds.forEach(id => {
    const el = buildClassCardElement(id, classNames[id] || ('클래스 ' + (id + 1)));
    if (addBtn) container.insertBefore(el, addBtn);
    else container.appendChild(el);
    if (classSamples[id] && classSamples[id].length > 0) {
      updateAudioThumbsGrid(id);
      updateAudioPreview(id);
    }
  });
}

function buildClassCardElement(classId, className) {
  const card = document.createElement('div');
  card.className = 'train-class-card';
  card.dataset.classId = classId;
  card.setAttribute('onclick', 'handleCardClick(this, event)');

  // Header
  const header = document.createElement('div');
  header.className = 'train-class-header';

  const headerLeft = document.createElement('div');
  headerLeft.className = 'train-class-header-left';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'train-class-name';
  nameSpan.id = 'class-name-' + classId;
  nameSpan.textContent = className;

  const editIcon = document.createElement('span');
  editIcon.className = 'material-icons train-class-edit';
  editIcon.textContent = 'edit';
  editIcon.setAttribute('onclick', 'event.stopPropagation(); editClassName(' + classId + ')');

  headerLeft.appendChild(nameSpan);
  headerLeft.appendChild(editIcon);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'train-class-delete';
  deleteBtn.setAttribute('onclick', 'event.stopPropagation(); deleteClass(' + classId + ')');
  const deleteIcon = document.createElement('span');
  deleteIcon.className = 'material-icons';
  deleteIcon.textContent = 'delete';
  deleteBtn.appendChild(deleteIcon);

  header.appendChild(headerLeft);
  header.appendChild(deleteBtn);

  // Placeholder
  const placeholder = document.createElement('p');
  placeholder.className = 'train-class-placeholder';
  placeholder.id = 'placeholder-' + classId;
  placeholder.textContent = '여기를 클릭하여 데이터를 추가하세요.';

  // Audio preview
  const audioPreview = document.createElement('div');
  audioPreview.className = 'train-audio-preview';
  audioPreview.id = 'audio-preview-' + classId;

  // Content
  const content = document.createElement('div');
  content.className = 'train-class-content';

  // Input dropdown wrapper
  const ddWrapper = document.createElement('div');
  ddWrapper.className = 'train-input-dropdown-wrapper';

  const ddBtn = document.createElement('button');
  ddBtn.className = 'train-input-dropdown';
  ddBtn.setAttribute('onclick', 'event.stopPropagation(); toggleInputDropdown(' + classId + ')');

  const ddText = document.createElement('span');
  ddText.className = 'train-input-dropdown-text';
  ddText.id = 'dropdown-text-' + classId;
  ddText.textContent = '업로드';

  const ddIcon = document.createElement('span');
  ddIcon.className = 'material-icons';
  ddIcon.textContent = 'expand_more';

  ddBtn.appendChild(ddText);
  ddBtn.appendChild(ddIcon);

  const ddMenu = document.createElement('div');
  ddMenu.className = 'train-input-dropdown-menu';
  ddMenu.id = 'dropdown-menu-' + classId;

  const ddUpload = document.createElement('button');
  ddUpload.className = 'train-input-dropdown-item';
  ddUpload.textContent = '업로드';
  ddUpload.setAttribute('onclick', 'event.stopPropagation(); selectInputMode(' + classId + ", 'upload')");

  const ddRecord = document.createElement('button');
  ddRecord.className = 'train-input-dropdown-item';
  ddRecord.textContent = '녹음';
  ddRecord.setAttribute('onclick', 'event.stopPropagation(); selectInputMode(' + classId + ", 'record')");

  ddMenu.appendChild(ddUpload);
  ddMenu.appendChild(ddRecord);
  ddWrapper.appendChild(ddBtn);
  ddWrapper.appendChild(ddMenu);

  // Upload mode
  const uploadMode = document.createElement('div');
  uploadMode.className = 'train-audio-upload-mode';
  uploadMode.id = 'upload-mode-' + classId;

  const uploadContentRow = document.createElement('div');
  uploadContentRow.className = 'train-audio-content-row';

  const uploadArea = document.createElement('div');
  uploadArea.className = 'train-audio-upload-area';
  uploadArea.setAttribute('ondragover', 'handleDragOver(event)');
  uploadArea.setAttribute('ondragleave', 'handleDragLeave(event)');
  uploadArea.setAttribute('ondrop', 'handleDrop(event, ' + classId + ')');

  const uploadIcon = document.createElement('span');
  uploadIcon.className = 'material-icons train-upload-icon';
  uploadIcon.textContent = 'upload';

  const uploadText = document.createElement('p');
  uploadText.className = 'train-upload-text';
  uploadText.appendChild(document.createTextNode('사운드 파일을 이곳에'));
  uploadText.appendChild(document.createElement('br'));
  uploadText.appendChild(document.createTextNode('끌어다 놓으세요'));

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'train-upload-btn';
  uploadBtn.textContent = '파일 선택';
  uploadBtn.setAttribute('onclick', "event.stopPropagation(); document.getElementById('file-input-" + classId + "').click()");

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'file-input-' + classId;
  fileInput.className = 'hidden-file-input';
  fileInput.accept = '.wav,.mp3,audio/*';
  fileInput.multiple = true;
  fileInput.setAttribute('onchange', 'handleFileSelect(' + classId + ', this.files)');

  const uploadHint = document.createElement('p');
  uploadHint.className = 'train-audio-hint';
  uploadHint.appendChild(document.createTextNode('3MB 이하의 wav, mp3 형식의'));
  uploadHint.appendChild(document.createElement('br'));
  uploadHint.appendChild(document.createTextNode('파일을 추가할 수 있습니다.'));

  uploadArea.appendChild(uploadIcon);
  uploadArea.appendChild(uploadText);
  uploadArea.appendChild(uploadBtn);
  uploadArea.appendChild(fileInput);
  uploadArea.appendChild(uploadHint);

  const uploadThumbsGrid = document.createElement('div');
  uploadThumbsGrid.className = 'train-audio-thumbs-grid';
  uploadThumbsGrid.id = 'audio-thumbs-grid-' + classId;

  uploadContentRow.appendChild(uploadArea);
  uploadContentRow.appendChild(uploadThumbsGrid);
  uploadMode.appendChild(uploadContentRow);

  // Record mode
  const recordMode = document.createElement('div');
  recordMode.className = 'train-record-mode hidden';
  recordMode.id = 'record-mode-' + classId;

  // Record settings
  const recSettings = document.createElement('div');
  recSettings.className = 'train-record-settings';

  // Duration select
  const durWrapper = document.createElement('div');
  durWrapper.className = 'train-record-select-wrapper';

  const durBtn = document.createElement('button');
  durBtn.className = 'train-record-select';
  durBtn.setAttribute('onclick', "event.stopPropagation(); toggleRecordDropdown(" + classId + ", 'duration')");

  const durText = document.createElement('span');
  durText.className = 'train-record-select-text';
  durText.id = 'record-duration-text-' + classId;
  durText.textContent = '녹음 시간 3초';

  const durIcon = document.createElement('span');
  durIcon.className = 'material-icons';
  durIcon.textContent = 'expand_more';

  durBtn.appendChild(durText);
  durBtn.appendChild(durIcon);

  const durMenu = document.createElement('div');
  durMenu.className = 'train-record-dropdown-menu';
  durMenu.id = 'record-duration-menu-' + classId;

  [1, 2, 3].forEach(sec => {
    const item = document.createElement('button');
    item.className = 'train-record-dropdown-item';
    item.textContent = sec + '초';
    item.setAttribute('onclick', 'event.stopPropagation(); selectRecordDuration(' + classId + ', ' + sec + ')');
    durMenu.appendChild(item);
  });

  durWrapper.appendChild(durBtn);
  durWrapper.appendChild(durMenu);

  // Delay select
  const delayWrapper = document.createElement('div');
  delayWrapper.className = 'train-record-select-wrapper';

  const delayBtn = document.createElement('button');
  delayBtn.className = 'train-record-select';
  delayBtn.setAttribute('onclick', "event.stopPropagation(); toggleRecordDropdown(" + classId + ", 'delay')");

  const delayText = document.createElement('span');
  delayText.className = 'train-record-select-text';
  delayText.id = 'record-delay-text-' + classId;
  delayText.textContent = '대기 시간 없음';

  const delayIcon = document.createElement('span');
  delayIcon.className = 'material-icons';
  delayIcon.textContent = 'expand_more';

  delayBtn.appendChild(delayText);
  delayBtn.appendChild(delayIcon);

  const delayMenu = document.createElement('div');
  delayMenu.className = 'train-record-dropdown-menu';
  delayMenu.id = 'record-delay-menu-' + classId;

  const delayNone = document.createElement('button');
  delayNone.className = 'train-record-dropdown-item';
  delayNone.textContent = '없음';
  delayNone.setAttribute('onclick', 'event.stopPropagation(); selectRecordDelay(' + classId + ', 0)');
  delayMenu.appendChild(delayNone);

  [1, 2, 3].forEach(sec => {
    const item = document.createElement('button');
    item.className = 'train-record-dropdown-item';
    item.textContent = sec + '초';
    item.setAttribute('onclick', 'event.stopPropagation(); selectRecordDelay(' + classId + ', ' + sec + ')');
    delayMenu.appendChild(item);
  });

  delayWrapper.appendChild(delayBtn);
  delayWrapper.appendChild(delayMenu);

  recSettings.appendChild(durWrapper);
  recSettings.appendChild(delayWrapper);

  // Waveform row
  const recContentRow = document.createElement('div');
  recContentRow.className = 'train-record-content-row';

  const waveWrapper = document.createElement('div');
  waveWrapper.className = 'train-waveform-wrapper';

  const waveCanvas = document.createElement('canvas');
  waveCanvas.className = 'train-waveform-canvas';
  waveCanvas.id = 'waveform-canvas-' + classId;

  waveWrapper.appendChild(waveCanvas);

  const recThumbsGrid = document.createElement('div');
  recThumbsGrid.className = 'train-audio-thumbs-grid';
  recThumbsGrid.id = 'rec-thumbs-grid-' + classId;

  recContentRow.appendChild(waveWrapper);
  recContentRow.appendChild(recThumbsGrid);

  // Record actions
  const recActions = document.createElement('div');
  recActions.className = 'train-record-actions';
  recActions.id = 'record-actions-' + classId;

  const recBtn = document.createElement('button');
  recBtn.className = 'train-record-btn';
  recBtn.id = 'record-btn-' + classId;
  recBtn.setAttribute('onclick', 'event.stopPropagation(); toggleRecording(' + classId + ')');

  const recMicIcon = document.createElement('span');
  recMicIcon.className = 'material-icons';
  recMicIcon.textContent = 'mic';

  recBtn.appendChild(recMicIcon);
  recBtn.appendChild(document.createTextNode(' 녹음하기'));
  recActions.appendChild(recBtn);

  recordMode.appendChild(recSettings);
  recordMode.appendChild(recContentRow);
  recordMode.appendChild(recActions);

  content.appendChild(ddWrapper);
  content.appendChild(uploadMode);
  content.appendChild(recordMode);

  card.appendChild(header);
  card.appendChild(placeholder);
  card.appendChild(audioPreview);
  card.appendChild(content);

  return card;
}

// Keep HTML-based class card creation for compatibility
function createClassCardHTML(classId, className) {
  const el = buildClassCardElement(classId, className);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

function addClass() {
  const id = classCounter++;
  const name = '클래스 ' + (classIds.length + 1);
  classIds.push(id);
  classNames[id] = name;
  classSamples[id] = [];
  classThumbnails[id] = [];
  recordSettings[id] = { duration: 3, delay: 0 };
  const addBtn = document.querySelector('.train-add-class-btn');
  const el = buildClassCardElement(id, name);
  if (addBtn) addBtn.parentNode.insertBefore(el, addBtn);
}

function deleteClass(classId) {
  stopClassRecording(classId);
  const card = document.querySelector('.train-class-card[data-class-id="' + classId + '"]');
  if (card) card.remove();
  const idx = classIds.indexOf(classId);
  if (idx > -1) classIds.splice(idx, 1);
  delete classSamples[classId];
  delete classThumbnails[classId];
  delete recordSettings[classId];
}

function editClassName(classId) {
  const nameSpan = document.getElementById('class-name-' + classId);
  if (!nameSpan) return;
  const current = classNames[classId] || nameSpan.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'train-class-name-input';
  input.value = current;
  nameSpan.replaceWith(input);
  input.focus(); input.select();
  const save = () => {
    const name = input.value.trim() || current;
    classNames[classId] = name;
    const span = document.createElement('span');
    span.className = 'train-class-name';
    span.id = 'class-name-' + classId;
    span.textContent = name;
    input.replaceWith(span);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); input.value = current; save(); }
  });
  input.addEventListener('blur', save);
}

function handleCardClick(card, event) {
  event.stopPropagation();
  if (card.classList.contains('expanded')) return;
  document.querySelectorAll('.train-class-card.expanded').forEach(c => {
    const id = parseInt(c.dataset.classId);
    stopClassRecording(id);
    c.classList.remove('expanded');
  });
  card.classList.add('expanded');
  const classId = parseInt(card.dataset.classId);
  const recordMode = document.getElementById('record-mode-' + classId);
  if (recordMode && !recordMode.classList.contains('hidden')) {
    const canvas = document.getElementById('waveform-canvas-' + classId);
    if (canvas && !canvas.dataset.drawn) {
      const dur = (recordSettings[classId] || {}).duration;
      drawEmptyWaveform(canvas, dur);
    }
  }
}

document.addEventListener('click', event => {
  if (!event.target.closest('.train-class-card')) {
    document.querySelectorAll('.train-class-card.expanded').forEach(c => {
      const id = parseInt(c.dataset.classId);
      stopClassRecording(id);
      c.classList.remove('expanded');
    });
  }
});

// ============ Audio Upload ============

function handleFileSelect(classId, files) {
  if (!files || files.length === 0) return;
  processAudioFiles(classId, Array.from(files));
}

function handleDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.add('dragover');
}

function handleDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('dragover');
}

function handleDrop(event, classId) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('dragover');
  const files = Array.from(event.dataTransfer.files).filter(f => f.type.startsWith('audio/') || f.name.match(/\.(wav|mp3)$/i));
  if (files.length > 0) processAudioFiles(classId, files);
}

async function processAudioFiles(classId, files) {
  const audioCtx = getAudioCtx();
  for (const file of files) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      const dataUrl = await fileToDataUrl(file);
      const thumbnail = await createAudioThumbnail(audioBuffer);
      classSamples[classId].push(dataUrl);
      classThumbnails[classId] = classThumbnails[classId] || [];
      classThumbnails[classId].push(thumbnail);
      updateAudioThumbsGrid(classId);
      updateAudioPreview(classId);
    } catch (err) {
      console.error('오디오 처리 오류:', err);
      showToast(file.name + ': 지원하지 않는 형식입니다.');
    }
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function buildThumbElement(thumb, classId, idx) {
  const wrapper = document.createElement('div');
  wrapper.className = 'train-audio-thumb-wrapper';
  wrapper.setAttribute('onclick', 'event.stopPropagation(); deleteSample(' + classId + ', ' + idx + ')');

  const img = document.createElement('img');
  img.className = 'train-audio-thumb-img';
  img.src = thumb;
  img.alt = '';

  const delOverlay = document.createElement('div');
  delOverlay.className = 'train-audio-thumb-delete';
  const delIcon = document.createElement('span');
  delIcon.className = 'material-icons';
  delIcon.textContent = 'close';
  delOverlay.appendChild(delIcon);

  wrapper.appendChild(img);
  wrapper.appendChild(delOverlay);
  return wrapper;
}

function updateAudioThumbsGrid(classId) {
  const uploadGrid = document.getElementById('audio-thumbs-grid-' + classId);
  const recGrid = document.getElementById('rec-thumbs-grid-' + classId);
  const thumbs = classThumbnails[classId] || [];

  [uploadGrid, recGrid].forEach(grid => {
    if (!grid) return;
    grid.textContent = '';
    thumbs.forEach((thumb, idx) => {
      grid.appendChild(buildThumbElement(thumb, classId, idx));
    });
  });
}

function updateAudioPreview(classId) {
  const preview = document.getElementById('audio-preview-' + classId);
  const thumbs = classThumbnails[classId] || [];
  const card = preview ? preview.closest('.train-class-card') : null;
  if (!preview) return;
  preview.textContent = '';
  if (thumbs.length > 0) {
    thumbs.forEach(t => {
      const img = document.createElement('img');
      img.className = 'train-preview-thumb';
      img.src = t;
      preview.appendChild(img);
    });
    preview.classList.add('has-samples');
    if (card) card.classList.add('has-samples');
  } else {
    preview.classList.remove('has-samples');
    if (card) card.classList.remove('has-samples');
  }
}

function deleteSample(classId, index) {
  classSamples[classId].splice(index, 1);
  (classThumbnails[classId] || []).splice(index, 1);
  updateAudioThumbsGrid(classId);
  updateAudioPreview(classId);
}

// ============ Recording ============

const recordingStates = {};

async function toggleRecording(classId) {
  if (isRecordingMap[classId]) {
    stopClassRecording(classId);
  } else {
    await startClassRecording(classId);
  }
}

async function startClassRecording(classId) {
  const btn = document.getElementById('record-btn-' + classId);
  const settings = recordSettings[classId] || { duration: 3, delay: 0 };

  if (settings.delay > 0) {
    btn.disabled = true;
    for (let i = settings.delay; i > 0; i--) {
      btn.textContent = '';
      const icon = document.createElement('span');
      icon.className = 'material-icons';
      icon.textContent = 'hourglass_empty';
      btn.appendChild(icon);
      btn.appendChild(document.createTextNode(' ' + i + '초 후 시작'));
      await new Promise(r => setTimeout(r, 1000));
    }
    btn.disabled = false;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    showToast('마이크에 접근할 수 없습니다.');
    if (btn) {
      btn.textContent = '';
      const icon = document.createElement('span');
      icon.className = 'material-icons';
      icon.textContent = 'mic';
      btn.appendChild(icon);
      btn.appendChild(document.createTextNode(' 녹음하기'));
      btn.disabled = false;
    }
    return;
  }

  const audioCtx = getAudioCtx();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const canvasId = 'waveform-canvas-' + classId;
  const canvas = document.getElementById(canvasId);
  if (canvas) {
    canvas.width = canvas.offsetWidth || 240;
    canvas.height = canvas.offsetHeight || 160;
  }
  startRealtimeWaveform(canvasId, analyser, settings.duration);

  isRecordingMap[classId] = true;
  if (btn) {
    btn.textContent = '';
    const icon = document.createElement('span');
    icon.className = 'material-icons';
    icon.textContent = 'stop';
    btn.appendChild(icon);
    btn.appendChild(document.createTextNode(' 중지'));
    btn.classList.add('recording');
  }

  const chunks = [];
  const mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  mediaRecorder.onstop = async () => {
    stopRealtimeWaveform(canvasId);
    stream.getTracks().forEach(t => t.stop());
    isRecordingMap[classId] = false;
    if (btn) {
      btn.textContent = '';
      const icon = document.createElement('span');
      icon.className = 'material-icons';
      icon.textContent = 'mic';
      btn.appendChild(icon);
      btn.appendChild(document.createTextNode(' 녹음하기'));
      btn.classList.remove('recording');
      btn.disabled = false;
    }

    const blob = new Blob(chunks, { type: 'audio/wav' });
    const dataUrl = await blobToDataUrl(blob);
    const ab = await blob.arrayBuffer();
    try {
      const audioBuffer = await getAudioCtx().decodeAudioData(ab);
      const thumbnail = await createAudioThumbnail(audioBuffer);
      classSamples[classId].push(dataUrl);
      classThumbnails[classId] = classThumbnails[classId] || [];
      classThumbnails[classId].push(thumbnail);
      if (canvas) requestAnimationFrame(() => drawStaticWaveform(canvas, audioBuffer));
      updateAudioThumbsGrid(classId);
      updateAudioPreview(classId);
    } catch (e) {
      showToast('녹음 처리 중 오류가 발생했습니다.');
    }
  };

  recordingStates[classId] = { mediaRecorder, stream };
  mediaRecorder.start();

  setTimeout(() => {
    if (isRecordingMap[classId] && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }, settings.duration * 1000);
}

function stopClassRecording(classId) {
  const state = recordingStates[classId];
  if (state && state.mediaRecorder && state.mediaRecorder.state === 'recording') {
    state.mediaRecorder.stop();
  }
  stopRealtimeWaveform('waveform-canvas-' + classId);
  if (isRecordingMap[classId]) {
    isRecordingMap[classId] = false;
    const btn = document.getElementById('record-btn-' + classId);
    if (btn) {
      btn.textContent = '';
      const icon = document.createElement('span');
      icon.className = 'material-icons';
      icon.textContent = 'mic';
      btn.appendChild(icon);
      btn.appendChild(document.createTextNode(' 녹음하기'));
      btn.classList.remove('recording');
      btn.disabled = false;
    }
  }
}

// ============ Record Settings ============

function toggleRecordDropdown(classId, type) {
  const menu = document.getElementById('record-' + type + '-menu-' + classId);
  const btn = menu.closest('.train-record-select-wrapper').querySelector('.train-record-select');
  document.querySelectorAll('.train-record-dropdown-menu.show').forEach(m => { if (m !== menu) m.classList.remove('show'); });
  if (!menu.classList.contains('show')) adjustDropdownDirection(menu, btn);
  menu.classList.toggle('show');
}

function selectRecordDuration(classId, seconds) {
  const textEl = document.getElementById('record-duration-text-' + classId);
  if (textEl) textEl.textContent = '녹음 시간 ' + seconds + '초';
  if (!recordSettings[classId]) recordSettings[classId] = { duration: 3, delay: 0 };
  recordSettings[classId].duration = seconds;
  const menu = document.getElementById('record-duration-menu-' + classId);
  if (menu) menu.classList.remove('show');
  const canvas = document.getElementById('waveform-canvas-' + classId);
  if (canvas && !isRecordingMap[classId]) drawEmptyWaveform(canvas, seconds);
}

function selectRecordDelay(classId, seconds) {
  const textEl = document.getElementById('record-delay-text-' + classId);
  if (textEl) textEl.textContent = seconds === 0 ? '대기 시간 없음' : '대기 시간 ' + seconds + '초';
  if (!recordSettings[classId]) recordSettings[classId] = { duration: 3, delay: 0 };
  recordSettings[classId].delay = seconds;
  const menu = document.getElementById('record-delay-menu-' + classId);
  if (menu) menu.classList.remove('show');
}

// ============ Input Mode ============

function selectInputMode(classId, mode) {
  const dropdownText = document.getElementById('dropdown-text-' + classId);
  const uploadMode = document.getElementById('upload-mode-' + classId);
  const recordMode = document.getElementById('record-mode-' + classId);
  const menu = document.getElementById('dropdown-menu-' + classId);
  if (menu) menu.classList.remove('show');
  const map = { upload: '업로드', record: '녹음' };
  if (dropdownText) dropdownText.textContent = map[mode] || mode;
  if (uploadMode) uploadMode.classList.add('hidden');
  if (recordMode) recordMode.classList.add('hidden');
  stopClassRecording(classId);
  if (mode === 'upload') {
    if (uploadMode) uploadMode.classList.remove('hidden');
  } else if (mode === 'record') {
    if (recordMode) recordMode.classList.remove('hidden');
    const canvas = document.getElementById('waveform-canvas-' + classId);
    if (canvas) {
      const dur = (recordSettings[classId] || {}).duration;
      requestAnimationFrame(() => drawEmptyWaveform(canvas, dur));
    }
  }
}

// ============ Dropdown Logic ============

function adjustDropdownDirection(menu, button) {
  menu.classList.remove('open-up');
  const rect = button.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const menuH = parseInt(window.getComputedStyle(menu).maxHeight) || 200;
  if (spaceBelow < menuH + 10) menu.classList.add('open-up');
}

function toggleInputDropdown(classId) {
  const menu = document.getElementById('dropdown-menu-' + classId);
  const btn = menu.closest('.train-input-dropdown-wrapper').querySelector('.train-input-dropdown');
  document.querySelectorAll('.train-input-dropdown-menu.show').forEach(m => { if (m !== menu) m.classList.remove('show'); });
  if (!menu.classList.contains('show')) adjustDropdownDirection(menu, btn);
  menu.classList.toggle('show');
}

document.addEventListener('click', event => {
  if (!event.target.closest('.train-input-dropdown-wrapper')) {
    document.querySelectorAll('.train-input-dropdown-menu.show').forEach(m => m.classList.remove('show'));
  }
  if (!event.target.closest('.train-record-select-wrapper')) {
    document.querySelectorAll('.train-record-dropdown-menu.show').forEach(m => m.classList.remove('show'));
  }
  if (!event.target.closest('.result-dropdown-wrapper') && !event.target.closest('.result-sample-dropdown-wrapper')) {
    document.querySelectorAll('.result-dropdown-menu.show').forEach(m => m.classList.remove('show'));
  }
});

// ============ Toast ============

function showToast(message, duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  const msgSpan = document.createElement('span');
  msgSpan.className = 'toast-message';
  msgSpan.textContent = message;
  toast.appendChild(msgSpan);
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============ Fullscreen ============

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

document.addEventListener('fullscreenchange', () => {
  const icon = document.querySelector('.fullscreen-icon');
  const exitIcon = document.querySelector('.exit-fullscreen-icon');
  if (document.fullscreenElement) {
    if (icon) icon.style.display = 'none';
    if (exitIcon) exitIcon.style.display = 'block';
  } else {
    if (icon) icon.style.display = 'block';
    if (exitIcon) exitIcon.style.display = 'none';
  }
});
