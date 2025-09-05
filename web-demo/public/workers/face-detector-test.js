/**
 * Event-Driven Face Detection Worker - Test Version
 * Implements threshold-based change detection as per CLAUDE.md specifications
 */

let isInitialized = false;
let config = {
  width: 640,
  height: 480,
  processingRate: 15,
  // Threshold parameters from CLAUDE.md
  T_high: 0.6,    // Enter threshold
  T_low: 0.4,     // Exit threshold  
  k: 3,           // Consecutive frames needed
  cooldown_ms: 1200, // Cooldown period
  expr_weights: { smile: 1.0, neutral: 0.5 },
  pose_weights: { yaw: 1.0, pitch: 1.0, roll: 0.8 }
};

// Change detection state
let previousState = null;
let consecutiveHighFrames = 0;
let isInChangeState = false;
let lastEventTime = 0;

// EMA smoothing for delta scores
let emaAlpha = 0.3; // Smoothing factor (0-1, higher = more responsive)
let smoothedDeltaScore = 0;

/**
 * Calculate change score between current and previous face state
 */
function calculateDeltaScore(current, previous) {
  if (!previous) return 0;
  
  // Expression change (cosine distance simulation)
  let exprDelta = 0;
  const exprKeys = Object.keys(current.expr);
  for (const key of exprKeys) {
    const curr = current.expr[key] || 0;
    const prev = previous.expr[key] || 0;
    const weight = config.expr_weights[key.toLowerCase()] || 1.0;
    exprDelta += Math.abs(curr - prev) * weight;
  }
  exprDelta = Math.min(exprDelta / exprKeys.length, 1.0);
  
  // Pose change (Euclidean distance)
  const poseDelta = Math.sqrt(
    Math.pow((current.pose.yaw - previous.pose.yaw) * config.pose_weights.yaw, 2) +
    Math.pow((current.pose.pitch - previous.pose.pitch) * config.pose_weights.pitch, 2) +
    Math.pow((current.pose.roll - previous.pose.roll) * config.pose_weights.roll, 2)
  ) / 180.0; // Normalize by max possible angle change
  
  // Weighted combination (0.7 expression, 0.3 pose)
  return Math.min(0.7 * exprDelta + 0.3 * poseDelta, 1.0);
}

/**
 * Generate mock face state with variation
 */
function generateMockFaceState() {
  const time = Date.now();
  const variation = Math.sin(time / 2000) * 0.3; // Slow sine wave for testing
  const noise = (Math.random() - 0.5) * 0.1; // Small random noise
  
  return {
    expr: {
      'Smile': Math.max(0, Math.min(1, 0.5 + variation + noise)),
      'Neutral': Math.max(0, Math.min(1, 0.5 - variation - noise))
    },
    pose: {
      yaw: variation * 30 + noise * 10,    // ±30 degree variation
      pitch: variation * 20 + noise * 5,   // ±20 degree variation  
      roll: variation * 15 + noise * 8     // ±15 degree variation
    },
    timestamp: time
  };
}

/**
 * Process frame with event-driven change detection
 */
function processFrame() {
  if (!isInitialized) return;
  
  const currentState = generateMockFaceState();
  const rawDeltaScore = calculateDeltaScore(currentState, previousState);
  const now = Date.now();
  
  // Apply EMA smoothing to delta score
  if (previousState === null) {
    smoothedDeltaScore = rawDeltaScore;
  } else {
    smoothedDeltaScore = emaAlpha * rawDeltaScore + (1 - emaAlpha) * smoothedDeltaScore;
  }
  
  // Double threshold logic with cooldown using smoothed score
  if (!isInChangeState) {
    // Not in change state - check if we should enter
    if (smoothedDeltaScore >= config.T_high) {
      consecutiveHighFrames++;
      if (consecutiveHighFrames >= config.k && (now - lastEventTime) >= config.cooldown_ms) {
        // Enter change state and emit event
        isInChangeState = true;
        consecutiveHighFrames = 0;
        lastEventTime = now;
        
        self.postMessage({
          type: 'face-event',
          data: {
            deltaScore: smoothedDeltaScore,
            rawDeltaScore: rawDeltaScore, // Include raw score for debugging
            expr: currentState.expr,
            pose: currentState.pose,
            keyPoints: {},
            timestamp: now
          }
        });
        
        console.log(`🎭 Face change detected! Smoothed: ${smoothedDeltaScore.toFixed(2)}, Raw: ${rawDeltaScore.toFixed(2)}`);
      }
    } else {
      consecutiveHighFrames = 0;
    }
  } else {
    // In change state - check if we should exit
    if (smoothedDeltaScore <= config.T_low) {
      isInChangeState = false;
      consecutiveHighFrames = 0;
      console.log(`😌 Face returned to stable state. Smoothed: ${smoothedDeltaScore.toFixed(2)}, Raw: ${rawDeltaScore.toFixed(2)}`);
    }
  }
  
  // Update state
  previousState = currentState;
}

/**
 * 处理消息
 */
self.addEventListener('message', async (e) => {
  const { type, data } = e.data;
  
  switch (type) {
    case 'init':
      console.log('🎯 Face detection worker initializing (event-driven test mode)...');
      config = { ...config, ...data.config };
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
          mode: 'event-driven-test',
          config: config
        }
      });
      break;
      
    case 'process-frame':
      processFrame();
      break;
      
    case 'update-config':
      config = { ...config, ...data };
      console.log('⚙️ Config updated:', config);
      break;
      
    default:
      console.warn('Unknown message type:', type);
  }
});

console.log('👤 Face detection worker loaded (event-driven test mode)');