/**
 * Face Detection Worker
 * 基于MediaPipe Face Landmarker的实时人脸检测和表情分析
 */

// MediaPipe Face Landmarker相关导入
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
 * 初始化Face Landmarker - 生产环境优化版本
 */
async function initializeFaceLandmarker() {
  try {
    console.log('🔄 Initializing Face Landmarker for production...');
    
    // 使用本地安装的 MediaPipe Tasks Vision (从 node_modules)
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    
    // 配置 WASM 文件路径 - 指向 node_modules 中的文件
    const vision = await FilesetResolver.forVisionTasks(
      // 在 Vercel 等生产环境中，使用相对路径从 node_modules 加载
      '/node_modules/@mediapipe/tasks-vision/wasm'
    );
    
    // 使用更可靠的模型路径配置
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        // 优先尝试本地模型，失败则使用 CDN
        modelAssetPath: await getModelPath(),
        delegate: 'GPU' // 优先GPU，失败会自动降级到CPU
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: 'VIDEO',
      numFaces: 1
    });
    
    isInitialized = true;
    console.log('✅ Face Landmarker initialized successfully');
    
    postMessage({
      type: 'status',
      data: { initialized: true, mode: 'mediapipe' }
    });
    
  } catch (error) {
    console.error('❌ Face Landmarker initialization failed:', error);
    console.error('Error details:', error.stack);
    
    // 发送详细错误信息，但不降级到模拟模式
    postMessage({
      type: 'error',
      data: { 
        message: `MediaPipe initialization failed: ${error.message}`,
        stack: error.stack,
        suggestion: 'Please check network connectivity and CORS settings'
      }
    });
  }
}

/**
 * 获取最佳可用的模型路径
 */
async function getModelPath() {
  const modelPaths = [
    // 1. 尝试本地静态资源
    '/models/face_landmarker.task',
    // 2. 尝试 CDN (Google 官方)
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
  ];
  
  for (const path of modelPaths) {
    try {
      const response = await fetch(path, { method: 'HEAD' });
      if (response.ok) {
        console.log(`✅ Using model from: ${path}`);
        return path;
      }
    } catch (e) {
      console.log(`⚠️ Model not available at: ${path}`);
    }
  }
  
  // 默认使用 Google CDN
  console.log('📡 Using default Google CDN model');
  return 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
}

/**
 * 处理消息
 */
onmessage = async function(e) {
  const { type, data } = e.data;
  
  switch (type) {
    case 'init':
      canvas = data.canvas;
      config = { ...config, ...data.config };
      
      if (canvas) {
        ctx = canvas.getContext('2d');
        console.log(`🎨 Canvas initialized: ${config.width}x${config.height}`);
      }
      
      // 初始化Face Landmarker
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
};

/**
 * 处理视频帧 - MediaPipe 专用版本
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
    // 更新canvas尺寸（如果需要）
    if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
      canvas.width = videoWidth;
      canvas.height = videoHeight;
    }
    
    // 将ImageData绘制到canvas
    ctx.putImageData(imageData, 0, 0);
    
    // MediaPipe检测 - 使用优化的时间戳
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
    
  } catch (error) {
    console.error('❌ Frame processing error:', error);
    
    // MediaPipe 特定错误处理
    if (error.message.includes('model') || error.message.includes('INVALID_ARGUMENT')) {
      console.log('🔄 Attempting to reinitialize Face Landmarker...');
      isInitialized = false;
      await initializeFaceLandmarker();
    } else if (error.message.includes('GPU')) {
      console.log('⚠️ GPU processing failed, consider using CPU delegate');
    }
  }
}

/**
 * 提取人脸特征
 */
function extractFacialFeatures(results) {
  const landmarks = results.faceLandmarks[0];
  const blendshapes = results.faceBlendshapes?.[0]?.categories || [];
  
  // 提取关键点位置（简化版）
  const keyPoints = {
    // 眼部关键点 (MediaPipe landmark indices)
    leftEye: landmarks[33], // 左眼中心
    rightEye: landmarks[263], // 右眼中心
    // 嘴部关键点
    mouthLeft: landmarks[61],
    mouthRight: landmarks[291],
    mouthTop: landmarks[13],
    mouthBottom: landmarks[14],
    // 鼻部
    noseTip: landmarks[1]
  };
  
  // 提取表情权重
  const expressions = {};
  blendshapes.forEach(shape => {
    expressions[shape.categoryName] = shape.score;
  });
  
  // 计算姿态角度（简化估算）
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
  // 使用关键点估算头部姿态
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const nose = landmarks[1];
  const chin = landmarks[152];
  
  // Yaw (左右转头) - 基于眼部距离
  const eyeDistance = Math.abs(leftEye.x - rightEye.x);
  const yaw = (eyeDistance - 0.1) * 90; // 简化映射
  
  // Pitch (上下点头) - 基于鼻子到下巴距离
  const noseToChain = Math.abs(nose.y - chin.y);
  const pitch = (noseToChain - 0.1) * 90;
  
  // Roll (倾斜) - 基于眼部高度差
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
  const yawDiff = Math.abs(currPose.yaw - prevPose.yaw) / 45; // 归一化
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
  
  return Math.min(totalChange / keys.length * 10, 1.0); // 放大并归一化
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
    postMessage({
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

console.log('👤 Face detection worker loaded');