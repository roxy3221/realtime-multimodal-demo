/**
 * MediaPipe Real-time Face Detection Worker
 * Implements event-driven face detection using MediaPipe Face Landmarker
 */

// Import MediaPipe with fallback CDN sources
let mediapiperLoaded = false;

// Multiple CDN fallback function
async function loadMediaPipe() {
  const cdnUrls = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.js',
    'https://unpkg.com/@mediapipe/tasks-vision@0.10.21/vision_bundle.js',
    'https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.21'
  ];
  
  for (const url of cdnUrls) {
    try {
      importScripts(url);
      console.log('✅ MediaPipe loaded from:', url);
      mediapiperLoaded = true;
      return;
    } catch (error) {
      console.warn('❌ Failed to load MediaPipe from:', url, error.message);
    }
  }
  
  throw new Error('All MediaPipe CDN sources failed to load');
}

let faceLandmarker = null;
let isInitialized = false;
let config = {
  width: 640,
  height: 480,
  processingRate: 15,
  // Event-driven thresholds
  T_high: 0.6,    // Enter threshold
  T_low: 0.4,     // Exit threshold  
  k: 3,           // Consecutive frames needed
  cooldown_ms: 1200, // Cooldown period
  expr_weights: { 
    eyeBlinkLeft: 1.0,
    eyeBlinkRight: 1.0,
    mouthSmile: 1.2,
    jawOpen: 1.0,
    browDownLeft: 0.8,
    browDownRight: 0.8,
    browInnerUp: 0.8
  },
  pose_weights: { yaw: 1.0, pitch: 1.0, roll: 0.8 }
};

// Change detection state
let previousState = null;
let consecutiveHighFrames = 0;
let isInChangeState = false;
let lastEventTime = 0;

// EMA smoothing
let emaAlpha = 0.3;
let smoothedDeltaScore = 0;

/**
 * Initialize MediaPipe Face Landmarker
 */
async function initializeMediaPipe() {
  try {
    console.log('🎯 Initializing MediaPipe Face Landmarker...');
    
    // First load MediaPipe if not already loaded
    if (!mediapiperLoaded) {
      console.log('📦 Loading MediaPipe libraries...');
      await loadMediaPipe();
    }
    
    // Check if MediaPipe is available in global scope
    if (typeof FilesetResolver === 'undefined' || typeof FaceLandmarker === 'undefined') {
      throw new Error('MediaPipe classes not available in global scope');
    }
    
    // Try multiple WASM sources for better reliability
    let vision;
    const wasmSources = [
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm",
      "https://unpkg.com/@mediapipe/tasks-vision@0.10.21/wasm"
    ];
    
    for (const wasmUrl of wasmSources) {
      try {
        vision = await FilesetResolver.forVisionTasks(wasmUrl);
        console.log('✅ MediaPipe WASM loaded from:', wasmUrl);
        break;
      } catch (wasmError) {
        console.warn('❌ Failed to load WASM from:', wasmUrl, wasmError.message);
      }
    }
    
    if (!vision) {
      throw new Error('All MediaPipe WASM sources failed to load');
    }
    
    // Try multiple model sources for better reliability  
    const modelSources = [
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/face_landmarker.task"
    ];
    
    let modelAssetPath;
    for (const modelUrl of modelSources) {
      try {
        // Test if model is accessible
        const response = await fetch(modelUrl, { method: 'HEAD' });
        if (response.ok) {
          modelAssetPath = modelUrl;
          console.log('✅ MediaPipe model accessible at:', modelUrl);
          break;
        }
      } catch (error) {
        console.warn('❌ Model not accessible at:', modelUrl);
      }
    }
    
    if (!modelAssetPath) {
      console.warn('⚠️ Using fallback model path (may fail in some environments)');
      modelAssetPath = modelSources[0]; // Use Google Storage as fallback
    }
    
    // Create Face Landmarker
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelAssetPath,
        delegate: "GPU"
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: 1
    });
    
    console.log('✅ MediaPipe Face Landmarker initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ MediaPipe initialization failed:', error);
    throw error;
  }
}

/**
 * Extract face pose from transformation matrix
 */
function extractPoseFromMatrix(matrix) {
  if (!matrix || !matrix.data || matrix.data.length < 16) {
    return { yaw: 0, pitch: 0, roll: 0 };
  }
  
  const data = matrix.data;
  
  // Extract rotation angles from transformation matrix
  const sy = Math.sqrt(data[0] * data[0] + data[1] * data[1]);
  const singular = sy < 1e-6;
  
  let pitch, yaw, roll;
  
  if (!singular) {
    pitch = Math.atan2(-data[2], sy);
    yaw = Math.atan2(data[1], data[0]);
    roll = Math.atan2(data[6], data[10]);
  } else {
    pitch = Math.atan2(-data[2], sy);
    yaw = 0;
    roll = Math.atan2(-data[4], data[5]);
  }
  
  // Convert to degrees
  return {
    yaw: yaw * 180 / Math.PI,
    pitch: pitch * 180 / Math.PI,
    roll: roll * 180 / Math.PI
  };
}

/**
 * Calculate change score between current and previous face state
 */
function calculateDeltaScore(current, previous) {
  if (!previous) return 0;
  
  // Expression change (weighted difference)
  let exprDelta = 0;
  let exprCount = 0;
  
  for (const [key, weight] of Object.entries(config.expr_weights)) {
    const curr = current.expr[key] || 0;
    const prev = previous.expr[key] || 0;
    exprDelta += Math.abs(curr - prev) * weight;
    exprCount += weight;
  }
  
  exprDelta = exprCount > 0 ? Math.min(exprDelta / exprCount, 1.0) : 0;
  
  // Pose change (Euclidean distance normalized)
  const poseDelta = Math.sqrt(
    Math.pow((current.pose.yaw - previous.pose.yaw) * config.pose_weights.yaw / 180, 2) +
    Math.pow((current.pose.pitch - previous.pose.pitch) * config.pose_weights.pitch / 180, 2) +
    Math.pow((current.pose.roll - previous.pose.roll) * config.pose_weights.roll / 180, 2)
  );
  
  // Weighted combination (0.7 expression, 0.3 pose)
  return Math.min(0.7 * exprDelta + 0.3 * poseDelta, 1.0);
}

/**
 * Process video frame with MediaPipe
 */
function processVideoFrame(imageData, timestamp) {
  if (!faceLandmarker || !isInitialized) {
    console.warn('Face landmarker not ready');
    return;
  }
  
  try {
    // Create ImageBitmap for MediaPipe
    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    
    // Detect faces
    const results = faceLandmarker.detectForVideo(canvas, timestamp);
    
    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
      // Process first face
      const landmarks = results.faceLandmarks[0];
      const blendshapes = results.faceBlendshapes?.[0]?.categories || [];
      const transformMatrix = results.facialTransformationMatrixes?.[0];
      
      // Extract expression scores
      const expr = {};
      blendshapes.forEach(shape => {
        expr[shape.categoryName] = shape.score;
      });
      
      // Extract pose
      const pose = extractPoseFromMatrix(transformMatrix);
      
      // Create face state
      const currentState = {
        expr,
        pose,
        landmarks: landmarks.map(point => ({ x: point.x, y: point.y, z: point.z || 0 })),
        timestamp: Date.now()
      };
      
      // Calculate change score
      const rawDeltaScore = calculateDeltaScore(currentState, previousState);
      const now = Date.now();
      
      // Apply EMA smoothing
      if (previousState === null) {
        smoothedDeltaScore = rawDeltaScore;
      } else {
        smoothedDeltaScore = emaAlpha * rawDeltaScore + (1 - emaAlpha) * smoothedDeltaScore;
      }
      
      // Event-driven detection logic
      if (!isInChangeState) {
        if (smoothedDeltaScore >= config.T_high) {
          consecutiveHighFrames++;
          if (consecutiveHighFrames >= config.k && (now - lastEventTime) >= config.cooldown_ms) {
            isInChangeState = true;
            consecutiveHighFrames = 0;
            lastEventTime = now;
            
            // Emit face event
            self.postMessage({
              type: 'face-event',
              data: {
                deltaScore: smoothedDeltaScore,
                rawDeltaScore: rawDeltaScore,
                expr: currentState.expr,
                pose: currentState.pose,
                keyPoints: currentState.landmarks.slice(0, 20), // Send key landmarks only
                timestamp: now
              }
            });
            
            console.log(`🎭 Face change detected! Score: ${smoothedDeltaScore.toFixed(2)}`);
          }
        } else {
          consecutiveHighFrames = 0;
        }
      } else {
        if (smoothedDeltaScore <= config.T_low) {
          isInChangeState = false;
          consecutiveHighFrames = 0;
          console.log(`😌 Face returned to stable state. Score: ${smoothedDeltaScore.toFixed(2)}`);
        }
      }
      
      // Update previous state
      previousState = currentState;
    }
  } catch (error) {
    console.error('❌ Face processing error:', error);
  }
}

/**
 * Message handler
 */
self.addEventListener('message', async (e) => {
  const { type, data } = e.data;
  
  switch (type) {
    case 'init':
      try {
        console.log('🎯 Face detection worker initializing with MediaPipe...');
        config = { ...config, ...data.config };
        
        await initializeMediaPipe();
        isInitialized = true;
        
        // Reset state
        previousState = null;
        consecutiveHighFrames = 0;
        isInChangeState = false;
        lastEventTime = 0;
        smoothedDeltaScore = 0;
        
        self.postMessage({
          type: 'status',
          data: { 
            initialized: true, 
            mode: 'mediapipe',
            config: config
          }
        });
      } catch (error) {
        self.postMessage({
          type: 'error',
          data: { message: error.message, stack: error.stack }
        });
      }
      break;
      
    case 'process-frame':
      if (data.imageData && data.timestamp) {
        processVideoFrame(data.imageData, data.timestamp);
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

console.log('👤 MediaPipe Face Detection Worker loaded');