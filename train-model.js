/**
 * train-model.js - YAMNet 기반 오디오 분류 모델 학습/추론 모듈
 *
 * [아키텍처]
 * 오디오 → 16kHz 리샘플링 → YAMNet(1024d 임베딩, mean-pool) → Classifier
 *
 * [전이 학습]
 * - YAMNet 가중치 고정 (Google AudioSet 사전학습)
 * - Classifier(Dense → Dropout → Dense)만 학습
 */

// ============================================================================
// 전역 상태
// ============================================================================

let isTraining = false;
let truncatedModel = null;   // YAMNet feature extractor
let classifierModel = null;  // 사용자 학습 분류기
let isModelReady = false;

const YAMNET_SAMPLE_RATE = 16000;
const YAMNET_EMBED_DIM = 1024;
const YAMNET_URL = 'model/model.json';

// ============================================================================
// YAMNet 로드
// ============================================================================

async function loadTruncatedModel() {
  if (truncatedModel) return truncatedModel;
  console.log('YAMNet 로딩 중...');
  truncatedModel = await tf.loadGraphModel(YAMNET_URL);
  console.log('YAMNet 로드 완료');
  return truncatedModel;
}

// ============================================================================
// 오디오 전처리
// ============================================================================

/**
 * data URL → 16kHz mono Float32Array (추론용, 앞 3초)
 */
async function decodeAudioToWaveform(dataUrl) {
  const chunks = await decodeAudioToChunks(dataUrl);
  return chunks[0];
}

/**
 * data URL → 3초 단위 청크 배열 (학습용)
 * 3초 미만 마지막 청크는 버림, 최소 1청크 보장
 */
async function decodeAudioToChunks(dataUrl) {
  const response = await fetch(dataUrl);
  const arrayBuffer = await response.arrayBuffer();

  const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
  let audioBuffer;
  try {
    audioBuffer = await tmpCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    tmpCtx.close();
  }

  const CHUNK_SECONDS = 3;
  const chunkLen = CHUNK_SECONDS * YAMNET_SAMPLE_RATE;
  const totalLen = audioBuffer.duration * YAMNET_SAMPLE_RATE;
  const numChunks = Math.max(1, Math.ceil(totalLen / chunkLen));
  const chunks = [];

  for (let i = 0; i < numChunks; i++) {
    const thisChunkLen = Math.min(chunkLen, Math.ceil(totalLen - i * chunkLen));
    const offCtx = new OfflineAudioContext(1, Math.max(thisChunkLen, YAMNET_SAMPLE_RATE), YAMNET_SAMPLE_RATE);
    const src = offCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offCtx.destination);
    src.start(0, i * CHUNK_SECONDS);
    const rendered = await offCtx.startRendering();
    chunks.push(rendered.getChannelData(0));
  }

  return chunks;
}

/**
 * YAMNet 임베딩 추출: [num_frames, 1024] → mean pool → Float32Array[1024]
 */
async function extractFeatures(waveform) {
  const wavTensor = tf.tensor1d(waveform);
  let featureData;
  try {
    const outputs = truncatedModel.execute(wavTensor);
    let embeddings;
    if (Array.isArray(outputs)) {
      embeddings = outputs[1];
      outputs[0].dispose();
      if (outputs[2]) outputs[2].dispose();
    } else {
      const keys = Object.keys(outputs);
      const key = keys.find(k => k.toLowerCase().includes('embed')) || keys[1] || keys[0];
      embeddings = outputs[key];
      keys.forEach(k => { if (outputs[k] !== embeddings) outputs[k].dispose(); });
    }
    const meanEmb = embeddings.mean(0);
    featureData = new Float32Array(await meanEmb.data());
    meanEmb.dispose();
    embeddings.dispose();
  } finally {
    wavTensor.dispose();
  }
  return featureData;
}

// ============================================================================
// 유틸리티
// ============================================================================

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getAdvancedOptions() {
  return {
    epochs: parseInt(document.getElementById('epochs-input').value) || 30,
    batchSize: parseInt(document.getElementById('batch-size-input').value) || 16,
    learningRate: parseFloat(document.getElementById('learning-rate-input').value) || 0.001,
    validationSplit: parseFloat(document.getElementById('validation-split-input').value) || 0.15,
  };
}

// 학습 버튼 상태 텍스트 설정 (spinner + text)
function setTrainBtnStatus(btn, text) {
  btn.textContent = '';
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  btn.appendChild(spinner);
  btn.appendChild(document.createTextNode(text));
}

// ============================================================================
// 학습
// ============================================================================

async function startTraining() {
  if (isTraining) return;

  const classesWithData = classIds.filter(id => classSamples[id] && classSamples[id].length > 0);
  if (classesWithData.length < classIds.length) {
    showToast('각 클래스에 최소 1개의 샘플이 필요합니다.');
    return;
  }

  resetResultCard();
  isTraining = true;
  isModelReady = false;

  const trainBtn = document.getElementById('train-btn');
  const progressWrapper = document.getElementById('train-progress-wrapper');
  const progressBar = document.getElementById('train-progress-bar');

  trainBtn.disabled = true;
  setTrainBtnStatus(trainBtn, '모델 로딩 중...');
  progressWrapper.classList.add('show');
  progressBar.style.width = '0%';

  try {
    if (classifierModel) { classifierModel.dispose(); classifierModel = null; }

    // 1. YAMNet 로드
    await loadTruncatedModel();
    setTrainBtnStatus(trainBtn, '특성 추출 중...');
    progressBar.style.width = '10%';

    const numClasses = classesWithData.length;
    const examples = classesWithData.map(() => []);

    let totalSamples = 0;
    classesWithData.forEach(id => (totalSamples += classSamples[id].length));
    let processed = 0;

    // 2. YAMNet 임베딩 추출
    for (let i = 0; i < numClasses; i++) {
      const classId = classesWithData[i];
      console.log(`클래스 ${i} (${classNames[classId]}): ${classSamples[classId].length}개`);
      for (const dataUrl of classSamples[classId]) {
        const waveform = await decodeAudioToWaveform(dataUrl);
        const features = await extractFeatures(waveform);
        examples[i].push(features);
        processed++;
        progressBar.style.width = (10 + (processed / totalSamples) * 30) + '%';
      }
    }

    setTrainBtnStatus(trainBtn, '모델 생성 중...');
    progressBar.style.width = '40%';

    // 3. 데이터 준비
    for (let i = 0; i < numClasses; i++) examples[i] = shuffle(examples[i]);

    const advancedOptions = getAdvancedOptions();
    const { validationSplit, epochs, batchSize } = advancedOptions;

    const trainData = [];
    const validationData = [];

    for (let ci = 0; ci < numClasses; ci++) {
      const oneHot = new Array(numClasses).fill(0);
      oneHot[ci] = 1;
      const classEx = examples[ci];
      const splitIdx = classEx.length - Math.ceil(validationSplit * classEx.length);
      for (let j = 0; j < splitIdx; j++) trainData.push({ data: classEx[j], label: oneHot });
      for (let j = splitIdx; j < classEx.length; j++) validationData.push({ data: classEx[j], label: oneHot });
    }

    const shuffledTrain = shuffle(trainData);
    const shuffledVal = shuffle(validationData);

    // 4. Dataset
    const trainDataset = tf.data.zip({
      xs: tf.data.array(shuffledTrain.map(d => Array.from(d.data))),
      ys: tf.data.array(shuffledTrain.map(d => d.label)),
    });
    const valDataset = tf.data.zip({
      xs: tf.data.array(shuffledVal.map(d => Array.from(d.data))),
      ys: tf.data.array(shuffledVal.map(d => d.label)),
    });

    // 5. 분류기 모델
    const createModel = () => {
      const model = tf.sequential({
        layers: [
          tf.layers.dense({
            inputShape: [YAMNET_EMBED_DIM],
            units: 100,
            activation: 'relu',
            kernelInitializer: 'varianceScaling',
            useBias: true,
          }),
          tf.layers.dropout({ rate: 0.3 }),
          tf.layers.dense({
            units: numClasses,
            activation: 'softmax',
            kernelInitializer: 'varianceScaling',
            useBias: false,
          }),
        ],
      });
      model.compile({
        optimizer: tf.train.adam(advancedOptions.learningRate),
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy'],
      });
      model.classMapping = classesWithData.map((id, idx) => ({
        index: idx,
        classId: id,
        name: classNames[id],
      }));
      return model;
    };

    // 6. 학습
    setTrainBtnStatus(trainBtn, '학습 중...');

    let restartCount = 0;
    const maxRestarts = 5;
    let shouldRestart = false;
    let currentModel = createModel();

    const runTraining = async (model) => {
      let lowAccCount = 0;
      shouldRestart = false;
      await model.fitDataset(trainDataset.batch(batchSize), {
        epochs,
        validationData: valDataset.batch(batchSize),
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            progressBar.style.width = (40 + ((epoch + 1) / epochs) * 55) + '%';
            console.log(`Epoch ${epoch + 1}/${epochs}: loss=${logs.loss.toFixed(4)}, acc=${(logs.acc * 100).toFixed(1)}%`);
            if (logs.acc <= 0.5) {
              lowAccCount++;
              if (lowAccCount >= 5 && restartCount < maxRestarts) {
                shouldRestart = true;
                model.stopTraining = true;
              }
            } else {
              lowAccCount = 0;
            }
          },
        },
      });
    };

    await runTraining(currentModel);

    while (shouldRestart && restartCount < maxRestarts) {
      restartCount++;
      setTrainBtnStatus(trainBtn, `재시작 중... (${restartCount}/${maxRestarts})`);
      progressBar.style.width = '40%';
      currentModel.dispose();
      currentModel = createModel();
      await runTraining(currentModel);
    }

    // 7. 완료
    classifierModel = currentModel;
    progressBar.style.width = '100%';
    isModelReady = true;
    setTimeout(() => finishTraining(), 500);

  } catch (error) {
    console.error('학습 오류:', error);
    showToast('학습 오류: ' + error.message);
    trainBtn.disabled = false;
    trainBtn.textContent = '학습하기';
    isTraining = false;
    progressWrapper.classList.remove('show');
  }
}

// ============================================================================
// 모델 저장
// ============================================================================

async function saveTrainedModel() {
  if (!classifierModel) return;
  try {
    await classifierModel.save('indexeddb://tm-classifier-model');
    localStorage.setItem('tm_model_meta', JSON.stringify({
      type: 'audio-yamnet',
      classMapping: classifierModel.classMapping,
      projectId: currentProjectId,
      projectName: currentProjectName,
      savedAt: Date.now(),
    }));
  } catch (e) {
    console.error('모델 저장 오류:', e);
  }
}

// ============================================================================
// 추론
// ============================================================================

/**
 * @param {string} audioDataUrl
 * @returns {Promise<Array|null>} [{ name, value }, ...]
 */
async function runInference(audioDataUrl) {
  if (!isModelReady || !classifierModel || !truncatedModel) return null;
  try {
    const waveform = await decodeAudioToWaveform(audioDataUrl);
    const features = await extractFeatures(waveform);
    const featureTensor = tf.tensor2d([Array.from(features)]);
    const predictions = classifierModel.predict(featureTensor);
    const probabilities = await predictions.data();
    featureTensor.dispose();
    predictions.dispose();
    return classifierModel.classMapping.map((m, idx) => ({
      name: m.name,
      value: probabilities[idx] * 100,
    }));
  } catch (e) {
    console.error('추론 오류:', e);
    return null;
  }
}
