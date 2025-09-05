/**
 * Face Detection Worker (Classic Script Format)
 * 基于MediaPipe Face Landmarker的实时人脸检测和表情分析
 * 使用UMD bundle和全局vision对象
 */

// MediaPipe Face Landmarker相关变量
let faceLandmarker = null;
let isInitialized = false;

// 画布和上下文
let canvas = null;
let ctx = null;

// 处理配置
let config = {
  width: 640,
  height: 480,
  processingRate: 15
};

// 变化检测状态
const detector = {
  lastFeatures: null,
  history: [],
  maxHistoryLength: 10,
  thresholdHigh: 0.6,
  thresholdLow: 0.4,
  isEventActive: false,
  lastEventTime: 0,
  cooldownMs: 1200
};

/**
 * 尝试从多个源加载MediaPipe UMD bundle
 */
function tryImportScripts(urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      console.log(`🔄 Trying to load: ${url}`);
      importScripts(url);
      
      // 验证全局vision对象是否存在
      const visionNS = self.vision || globalThis.vision;
      if (visionNS && visionNS.FilesetResolver && visionNS.FaceLandmarker) {
        console.log(`✅ Successfully loaded from: ${url}`);
        return url;
      }
      lastError = new Error("vision namespace missing after importScripts");
    } catch (e) {
      console.warn(`❌ Failed to load ${url}:`, e.message);
      lastError = e;
    }
  }
  throw lastError;
}

/**
 * 初始化Face Landmarker - 本地优先 + CDN回退
 */
async function initializeFaceLandmarker() {
  try {
    console.log('🔄 Loading MediaPipe UMD bundle...');
    
    // 1) 使用最稳定的UMD版本
    const VER_UMD = '0.10.0';     // 确认有UMD支持的版本
    
    const loadedUrl = tryImportScripts([
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER_UMD}/vision_bundle.js`,  // jsDelivr UMD版本
      `https://unpkg.com/@mediapipe/tasks-vision@${VER_UMD}/vision_bundle.js`,  // unpkg UMD版本
      // 移除本地fallback，因为本地是0.10.21不兼容
    ]);

    // 2) CDN path for WASM files
    const wasmRoot = loadedUrl.replace('/vision_bundle.js', '/wasm');

    // 3) 获取UMD导出的类
    const visionNS = self.vision || globalThis.vision;
    const { FilesetResolver, FaceLandmarker } = visionNS;

    if (!FilesetResolver || !FaceLandmarker) {
      throw new Error(`Missing MediaPipe classes: FilesetResolver=${!!FilesetResolver}, FaceLandmarker=${!!FaceLandmarker}`);
    }

    console.log(`🎯 Creating Face Landmarker from CDN source...`);
    
    // 4) 初始化fileset和模型
    const fileset = await FilesetResolver.forVisionTasks(wasmRoot);
    
    // 5) 创建Face Landmarker（本地+CDN回退模型）
    const modelPaths = [
      '/models/face_landmarker.task',  // 本地模型优先
      'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'  // 官方CDN
    ];
    
    let landmarkerCreated = false;
    for (const modelPath of modelPaths) {
      try {
        console.log(`🎯 Trying model: ${modelPath}`);
        faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: modelPath,
            delegate: 'CPU'
          },
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          runningMode: 'VIDEO',
          numFaces: 1
        });
        console.log(`✅ Model loaded from: ${modelPath}`);
        landmarkerCreated = true;
        break;
      } catch (e) {
        console.warn(`❌ Failed to load model from ${modelPath}:`, e.message);
      }
    }
    
    if (!landmarkerCreated) {
      throw new Error('Failed to load face landmarker model from all sources');
    }
    
    isInitialized = true;
    console.log('✅ Face Landmarker initialized successfully from UMD bundle');
    
    self.postMessage({
      type: 'status',
      data: { initialized: true, mode: 'umd-bundle' }
    });
    
  } catch (error) {
    console.error('❌ Face Landmarker initialization failed:', error);
    
    self.postMessage({
      type: 'error',
      data: { 
        message: `MediaPipe initialization failed: ${error.message || 'Unknown error'}`,
        stack: error.stack || 'No stack trace',
        suggestion: 'Check internet connection and MediaPipe CDN availability.'
      }
    });
    
    isInitialized = false;
  }
}

/**
 * 处理消息
 */
self.addEventListener('message', async (e) => {
  const { type, data } = e.data;
  
  switch (type) {
    case 'init':
      canvas = data.canvas;
      config = { ...config, ...data.config };
      
      if (canvas) {
        ctx = canvas.getContext('2d', { willReadFrequently: true });
        console.log(`🎨 Canvas initialized: ${config.width}x${config.height}`);
      }
      
      await initializeFaceLandmarker();
      break;
      
    case 'process-frame':
      if (isInitialized && canvas && ctx) {
        await processVideoFrame(data);
      }
      break;
      
    case 'update-config':
      config = { ...config, ...data };
      console.log('⚙️ Config updated:', config);
      break;
      
    default:
      console.warn('Unknown message type:', type);
  }
});

/**
 * 处理视频帧
 */
async function processVideoFrame(frameData) {
  const { timestamp, imageData, videoWidth, videoHeight } = frameData;
  
  if (!imageData) {
    console.warn('⚠️ No imageData provided for frame processing');
    return;
  }
  
  if (!faceLandmarker) {
    console.warn('⚠️ Face Landmarker not initialized');
    return;
  }
  
  try {
    // 更新canvas尺寸
    if (canvas && ctx && (canvas.width !== videoWidth || canvas.height !== videoHeight)) {
      canvas.width = videoWidth;
      canvas.height = videoHeight;
    }
    
    // 将ImageData绘制到canvas
    if (ctx) {
      ctx.putImageData(imageData, 0, 0);
    }
    
    // MediaPipe检测
    if (faceLandmarker && canvas) {
      const results = faceLandmarker.detectForVideo(canvas, timestamp);
      
      if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        // 提取特征
        const features = extractFacialFeatures(results);
        
        // 变化检测
        const deltaScore = computeFacialChange(features);
        
        // 检查事件触发
        checkFaceEventTrigger(deltaScore, features, timestamp);
      } else {
        // 无人脸时重置检测状态
        if (detector.isEventActive) {
          detector.isEventActive = false;
          console.log('👤 Face lost - resetting detection state');
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Frame processing error:', error);
    
    // MediaPipe 特定错误处理
    const errorMessage = error.message || 'Unknown error';
    if (errorMessage.includes('model') || errorMessage.includes('INVALID_ARGUMENT')) {
      console.log('🔄 Attempting to reinitialize Face Landmarker...');
      isInitialized = false;
      await initializeFaceLandmarker();
    }
  }
}

/**
 * 提取人脸特征
 */
function extractFacialFeatures(results) {
  const landmarks = results.faceLandmarks[0];
  const blendshapes = results.faceBlendshapes?.[0]?.categories || [];
  
  // 提取关键点位置
  const keyPoints = {
    leftEye: landmarks[33],
    rightEye: landmarks[263],
    mouthLeft: landmarks[61],
    mouthRight: landmarks[291],
    mouthTop: landmarks[13],
    mouthBottom: landmarks[14],
    noseTip: landmarks[1]
  };
  
  // 提取表情权重
  const expressions = {};
  blendshapes.forEach(shape => {
    expressions[shape.categoryName] = shape.score;
  });
  
  // 计算姿态角度
  const pose = estimatePoseAngles(landmarks);
  
  return {
    keyPoints,
    expressions,
    pose,
    timestamp: Date.now()
  };
}

/**
 * 简化姿态角度估算
 */
function estimatePoseAngles(landmarks) {
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const nose = landmarks[1];
  const chin = landmarks[152];
  
  // Yaw (左右转头)
  const eyeDistance = Math.abs(leftEye.x - rightEye.x);
  const yaw = (eyeDistance - 0.1) * 90;
  
  // Pitch (上下点头)
  const noseToChain = Math.abs(nose.y - chin.y);
  const pitch = (noseToChain - 0.1) * 90;
  
  // Roll (倾斜)
  const eyeHeightDiff = Math.abs(leftEye.y - rightEye.y);
  const roll = eyeHeightDiff * 180;
  
  return {
    yaw: Math.max(-45, Math.min(45, yaw)),
    pitch: Math.max(-30, Math.min(30, pitch)),
    roll: Math.max(-30, Math.min(30, roll))
  };
}

/**
 * 计算人脸变化分数
 */
function computeFacialChange(currentFeatures) {
  if (!detector.lastFeatures) {
    detector.lastFeatures = currentFeatures;
    return 0;
  }
  
  // 计算表情变化
  const exprChange = computeExpressionChange(
    detector.lastFeatures.expressions,
    currentFeatures.expressions
  );
  
  // 计算姿态变化
  const poseChange = computePoseChange(
    detector.lastFeatures.pose,
    currentFeatures.pose
  );
  
  // 计算关键点变化
  const landmarkChange = computeLandmarkChange(
    detector.lastFeatures.keyPoints,
    currentFeatures.keyPoints
  );
  
  // 加权综合变化分数
  const deltaScore = 0.5 * exprChange + 0.3 * poseChange + 0.2 * landmarkChange;
  
  // 更新历史
  detector.history.push(deltaScore);
  if (detector.history.length > detector.maxHistoryLength) {
    detector.history.shift();
  }
  
  detector.lastFeatures = currentFeatures;
  
  return Math.min(deltaScore, 1.0);
}

/**
 * 计算表情变化（余弦距离）
 */
function computeExpressionChange(prevExpr, currExpr) {
  const keys = Object.keys(currExpr);
  if (keys.length === 0) return 0;
  
  let dotProduct = 0;
  let prevMagnitude = 0;
  let currMagnitude = 0;
  
  keys.forEach(key => {
    const prev = prevExpr[key] || 0;
    const curr = currExpr[key] || 0;
    
    dotProduct += prev * curr;
    prevMagnitude += prev * prev;
    currMagnitude += curr * curr;
  });
  
  const prevMag = Math.sqrt(prevMagnitude);
  const currMag = Math.sqrt(currMagnitude);
  
  if (prevMag === 0 || currMag === 0) return 0;
  
  const cosineDistance = 1 - (dotProduct / (prevMag * currMag));
  return Math.max(0, Math.min(1, cosineDistance));
}

/**
 * 计算姿态变化
 */
function computePoseChange(prevPose, currPose) {
  const yawDiff = Math.abs(currPose.yaw - prevPose.yaw) / 45;
  const pitchDiff = Math.abs(currPose.pitch - prevPose.pitch) / 30;
  const rollDiff = Math.abs(currPose.roll - prevPose.roll) / 30;
  
  return Math.min((yawDiff + pitchDiff + rollDiff) / 3, 1.0);
}

/**
 * 计算关键点变化
 */
function computeLandmarkChange(prevPoints, currPoints) {
  const keys = Object.keys(currPoints);
  let totalChange = 0;
  
  keys.forEach(key => {
    const prev = prevPoints[key];
    const curr = currPoints[key];
    
    if (prev && curr) {
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      totalChange += distance;
    }
  });
  
  return Math.min(totalChange / keys.length * 10, 1.0);
}

/**
 * 检查人脸事件触发
 */
function checkFaceEventTrigger(deltaScore, features, timestamp) {
  const now = Date.now();
  
  // 冷却检查
  if (now - detector.lastEventTime < detector.cooldownMs) return;
  
  // 双阈值触发
  let shouldTrigger = false;
  
  if (!detector.isEventActive && deltaScore > detector.thresholdHigh) {
    shouldTrigger = true;
    detector.isEventActive = true;
  } else if (detector.isEventActive && deltaScore < detector.thresholdLow) {
    detector.isEventActive = false;
  }
  
  if (shouldTrigger) {
    detector.lastEventTime = now;
    
    // 发送人脸事件
    self.postMessage({
      type: 'face-event',
      data: {
        deltaScore,
        expr: features.expressions,
        pose: features.pose,
        keyPoints: features.keyPoints,
        timestamp
      }
    });
  }
}

console.log('👤 Face detection worker loaded (classic format with UMD bundle)');