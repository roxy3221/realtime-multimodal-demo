/**
 * Enhanced Audio Processor Worklet - WebRTC增强版
 * 解决F0频率异常值（如695Hz）和音频质量问题
 */

class EnhancedAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    
    // WebRTC优化参数
    this.sampleRate = options.processorOptions.sampleRate || 48000;
    this.windowSize = options.processorOptions.windowSize || 2048;
    this.useWebRTCEnhancements = options.processorOptions.useWebRTCEnhancements || false;
    
    // 初始化增强分析器
    this.initializeEnhancedAnalyzers();
    
    // 事件触发器状态
    this.lastProsodyEvent = 0;
    this.cooldownMs = 800; // 减少冷却时间，提升响应性
    this.thresholdHigh = 0.5; // 降低阈值，更敏感
    this.thresholdLow = 0.3;
    this.isEventActive = false;
    
    // 增强历史数据管理
    this.history = {
      rms: new Float32Array(60), // 2秒历史@30Hz
      f0: new Float32Array(60),
      f0Confidence: new Float32Array(60),
      vadConfidence: new Float32Array(60),
      writeIndex: 0,
      validSamples: 0
    };
    
    // 帧计数器
    this.frameCount = 0;
    this.processInterval = Math.floor(this.sampleRate / 128 / 30); // ~30Hz处理频率
  }

  /**
   * 初始化WebRTC增强分析器
   */
  initializeEnhancedAnalyzers() {
    // RMS计算（WebRTC优化）
    this.rmsAlpha = 0.1; // 更平滑的EMA
    this.currentRMS = 0;
    this.peakRMS = 0;
    
    // 增强F0检测
    this.f0BufferSize = Math.floor(this.sampleRate * 0.04); // 40ms窗口
    this.f0Buffer = new Float32Array(this.f0BufferSize);
    this.currentF0 = 0;
    this.f0Confidence = 0;
    this.f0Stability = 0;
    
    // WebRTC VAD增强
    this.vadThreshold = 0.01; // 更敏感的VAD
    this.vadHangover = 10; // 10帧hangover
    this.vadState = {
      isActive: false,
      activeFrames: 0,
      silenceFrames: 0,
      confidence: 0
    };
    
    // 频谱分析（新增）
    this.spectralCentroid = 0;
    this.spectralRolloff = 0;
    this.zeroCrossingRate = 0;
    
    // 异常值检测和过滤
    this.f0Filter = new MedianFilter(5); // 5点中值滤波
    this.rmsFilter = new MedianFilter(3);
    this.outlierDetector = new OutlierDetector();
  }

  /**
   * 主处理函数
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    
    const samples = input[0];
    this.frameCount++;
    
    // 按间隔处理以控制CPU使用
    if (this.frameCount % this.processInterval !== 0) {
      return true;
    }
    
    try {
      // 1. WebRTC增强RMS计算
      const rms = this.computeEnhancedRMS(samples);
      
      // 2. 增强F0检测（关键改进）
      const f0Result = this.computeEnhancedF0(samples);
      
      // 3. WebRTC VAD
      const vadResult = this.computeEnhancedVAD(rms);
      
      // 4. 频谱特征分析
      const spectralFeatures = this.computeSpectralFeatures(samples);
      
      // 5. 更新历史数据
      this.updateHistory(rms, f0Result.frequency, f0Result.confidence, vadResult.confidence);
      
      // 6. 变化检测和事件触发
      this.detectAndEmitEvents(rms, f0Result, vadResult, spectralFeatures);
      
    } catch (error) {
      console.error('Enhanced audio processing error:', error);
    }
    
    return true;
  }

  /**
   * WebRTC增强RMS计算
   */
  computeEnhancedRMS(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    
    const instantRMS = Math.sqrt(sum / samples.length);
    
    // EMA滤波
    this.currentRMS = this.rmsAlpha * instantRMS + (1 - this.rmsAlpha) * this.currentRMS;
    
    // 峰值跟踪
    this.peakRMS = Math.max(this.peakRMS * 0.999, this.currentRMS);
    
    // 应用中值滤波去除异常值
    return this.rmsFilter.filter(this.currentRMS);
  }

  /**
   * 增强F0检测 - 关键改进，解决695Hz等异常值
   */
  computeEnhancedF0(samples) {
    // 将新样本加入缓冲区
    const bufferLen = this.f0Buffer.length;
    const sampleLen = samples.length;
    
    // 移动旧数据
    for (let i = 0; i < bufferLen - sampleLen; i++) {
      this.f0Buffer[i] = this.f0Buffer[i + sampleLen];
    }
    
    // 添加新数据
    for (let i = 0; i < sampleLen; i++) {
      this.f0Buffer[bufferLen - sampleLen + i] = samples[i];
    }
    
    // 预处理：高通滤波去除直流分量
    const filteredBuffer = this.applyHighPassFilter(this.f0Buffer);
    
    // 增强自相关F0检测
    const f0Result = this.enhancedAutocorrelationF0(filteredBuffer);
    
    // 应用中值滤波和异常值检测
    const filteredF0 = this.f0Filter.filter(f0Result.frequency);
    const isOutlier = this.outlierDetector.isOutlier(filteredF0);
    
    // 如果是异常值，使用历史平均值
    const finalF0 = isOutlier ? this.getF0HistoryMean() : filteredF0;
    
    // 更新稳定性指标
    this.updateF0Stability(finalF0);
    
    return {
      frequency: finalF0,
      confidence: f0Result.confidence * (isOutlier ? 0.5 : 1.0),
      stability: this.f0Stability
    };
  }

  /**
   * 高通滤波器（去除直流分量）
   */
  applyHighPassFilter(buffer) {
    const filtered = new Float32Array(buffer.length);
    const alpha = 0.95; // 高通滤波系数
    
    filtered[0] = buffer[0];
    for (let i = 1; i < buffer.length; i++) {
      filtered[i] = alpha * (filtered[i-1] + buffer[i] - buffer[i-1]);
    }
    
    return filtered;
  }

  /**
   * 增强自相关F0检测
   */
  enhancedAutocorrelationF0(buffer) {
    // 更精确的F0范围（人声优化）
    const minPeriod = Math.floor(this.sampleRate / 500); // 500Hz max (女高音)
    const maxPeriod = Math.floor(this.sampleRate / 60);  // 60Hz min (男低音)
    
    let maxCorrelation = 0;
    let bestPeriod = 0;
    let secondBestCorr = 0;
    
    // 搜索最佳周期
    for (let period = minPeriod; period < maxPeriod && period < buffer.length / 2; period++) {
      let correlation = 0;
      let energy1 = 0;
      let energy2 = 0;
      
      const effectiveLength = Math.min(buffer.length - period, period * 4); // 限制计算长度
      
      for (let i = 0; i < effectiveLength; i++) {
        correlation += buffer[i] * buffer[i + period];
        energy1 += buffer[i] * buffer[i];
        energy2 += buffer[i + period] * buffer[i + period];
      }
      
      // 改进的归一化相关性
      const normalizedCorr = (energy1 > 0 && energy2 > 0) ? 
        correlation / Math.sqrt(energy1 * energy2) : 0;
      
      if (normalizedCorr > maxCorrelation) {
        secondBestCorr = maxCorrelation;
        maxCorrelation = normalizedCorr;
        bestPeriod = period;
      } else if (normalizedCorr > secondBestCorr) {
        secondBestCorr = normalizedCorr;
      }
    }
    
    // 计算置信度（改进）
    const confidenceThreshold = 0.3;
    const clarity = maxCorrelation - secondBestCorr; // 峰值清晰度
    const confidence = maxCorrelation > confidenceThreshold ? 
      Math.min(maxCorrelation * clarity * 2, 1.0) : 0;
    
    if (confidence > 0.2 && bestPeriod > 0) {
      const frequency = this.sampleRate / bestPeriod;
      
      // 额外的合理性检查
      if (frequency >= 60 && frequency <= 500) {
        return { frequency, confidence };
      }
    }
    
    return { frequency: 0, confidence: 0 };
  }

  /**
   * WebRTC增强VAD
   */
  computeEnhancedVAD(rms) {
    // 动态阈值调整
    const adaptiveThreshold = Math.max(this.vadThreshold, this.peakRMS * 0.05);
    const isActive = rms > adaptiveThreshold;
    
    // 置信度计算
    let confidence = Math.min(rms / adaptiveThreshold, 1.0);
    
    // 状态机逻辑
    if (isActive) {
      this.vadState.activeFrames++;
      this.vadState.silenceFrames = 0;
    } else {
      this.vadState.silenceFrames++;
      this.vadState.activeFrames = Math.max(0, this.vadState.activeFrames - 1);
    }
    
    // 应用hangover机制
    const wasActive = this.vadState.isActive;
    this.vadState.isActive = this.vadState.activeFrames > 0 || 
                            this.vadState.silenceFrames < this.vadHangover;
    
    this.vadState.confidence = confidence;
    
    // VAD状态变化时发送事件
    if (wasActive !== this.vadState.isActive) {
      this.port.postMessage({
        type: 'webrtc-vad-change',
        data: {
          isActive: this.vadState.isActive,
          confidence: confidence,
          adaptiveThreshold: adaptiveThreshold,
          timestamp: Date.now()
        }
      });
    }
    
    return { confidence, isActive: this.vadState.isActive };
  }

  /**
   * 计算频谱特征
   */
  computeSpectralFeatures(samples) {
    // 零交叉率
    let zeroCrossings = 0;
    for (let i = 1; i < samples.length; i++) {
      if ((samples[i] >= 0) !== (samples[i-1] >= 0)) {
        zeroCrossings++;
      }
    }
    this.zeroCrossingRate = zeroCrossings / samples.length;
    
    // 简化的频谱重心（需要更复杂的FFT实现才能精确计算）
    this.spectralCentroid = this.zeroCrossingRate * this.sampleRate / 4;
    
    return {
      zeroCrossingRate: this.zeroCrossingRate,
      spectralCentroid: this.spectralCentroid
    };
  }

  /**
   * 更新历史数据
   */
  updateHistory(rms, f0, f0Confidence, vadConfidence) {
    const index = this.history.writeIndex % this.history.rms.length;
    
    this.history.rms[index] = rms;
    this.history.f0[index] = f0;
    this.history.f0Confidence[index] = f0Confidence;
    this.history.vadConfidence[index] = vadConfidence;
    
    this.history.writeIndex++;
    this.history.validSamples = Math.min(this.history.validSamples + 1, this.history.rms.length);
  }

  /**
   * 获取F0历史平均值
   */
  getF0HistoryMean() {
    if (this.history.validSamples < 5) return 0;
    
    let sum = 0;
    let count = 0;
    
    for (let i = 0; i < this.history.validSamples; i++) {
      if (this.history.f0[i] > 0 && this.history.f0Confidence[i] > 0.3) {
        sum += this.history.f0[i];
        count++;
      }
    }
    
    return count > 0 ? sum / count : 0;
  }

  /**
   * 更新F0稳定性
   */
  updateF0Stability(currentF0) {
    if (this.history.validSamples < 10) {
      this.f0Stability = 0.5;
      return;
    }
    
    // 计算F0变化率
    let variance = 0;
    let validCount = 0;
    const recentSamples = Math.min(10, this.history.validSamples);
    
    for (let i = this.history.validSamples - recentSamples; i < this.history.validSamples - 1; i++) {
      const idx = i % this.history.f0.length;
      if (this.history.f0[idx] > 0) {
        const diff = Math.abs(this.history.f0[idx] - currentF0);
        variance += diff * diff;
        validCount++;
      }
    }
    
    if (validCount > 0) {
      const stddev = Math.sqrt(variance / validCount);
      this.f0Stability = Math.max(0, 1 - stddev / 50); // 50Hz标准差对应0稳定性
    }
  }

  /**
   * 检测变化并发送事件
   */
  detectAndEmitEvents(rms, f0Result, vadResult, spectralFeatures) {
    const now = Date.now();
    
    // 计算变化分数
    const deltaScore = this.computeEnhancedDeltaScore(rms, f0Result.frequency, vadResult.confidence);
    
    // 双阈值触发逻辑
    const shouldTrigger = (!this.isEventActive && deltaScore > this.thresholdHigh) ||
                         (this.isEventActive && deltaScore > this.thresholdLow);
    
    this.isEventActive = shouldTrigger;
    
    // 冷却时间检查
    if (shouldTrigger && (now - this.lastProsodyEvent) > this.cooldownMs) {
      this.port.postMessage({
        type: 'enhanced-prosody-event',
        data: {
          deltaScore: deltaScore,
          rms: rms,
          f0: Math.round(f0Result.frequency * 10) / 10, // 保留1位小数
          f0Confidence: f0Result.confidence,
          f0Stability: this.f0Stability,
          wpm: 0, // 由ASR计算
          vadActive: vadResult.isActive,
          vadConfidence: vadResult.confidence,
          zeroCrossingRate: spectralFeatures.zeroCrossingRate,
          spectralCentroid: spectralFeatures.spectralCentroid,
          timestamp: now
        }
      });
      
      this.lastProsodyEvent = now;
    }
  }

  /**
   * 计算增强变化分数
   */
  computeEnhancedDeltaScore(rms, f0, vadConfidence) {
    if (this.history.validSamples < 5) return 0;
    
    // 计算各维度的变化
    const rmsChange = this.computeRelativeChange('rms', rms);
    const f0Change = this.computeRelativeChange('f0', f0);
    const vadChange = this.computeRelativeChange('vadConfidence', vadConfidence);
    
    // 权重组合
    const weights = { rms: 0.4, f0: 0.4, vad: 0.2 };
    const deltaScore = weights.rms * rmsChange + 
                      weights.f0 * f0Change + 
                      weights.vad * vadChange;
    
    return Math.min(deltaScore, 1.0);
  }

  /**
   * 计算相对变化率
   */
  computeRelativeChange(feature, currentValue) {
    const historyArray = this.history[feature];
    if (!historyArray) return 0;
    
    // 计算历史均值
    let sum = 0;
    let count = 0;
    
    for (let i = 0; i < this.history.validSamples; i++) {
      if (historyArray[i] > 0) {
        sum += historyArray[i];
        count++;
      }
    }
    
    if (count < 3) return 0;
    
    const mean = sum / count;
    if (mean === 0) return 0;
    
    return Math.min(Math.abs(currentValue - mean) / mean, 1.0);
  }
}

/**
 * 中值滤波器
 */
class MedianFilter {
  constructor(windowSize) {
    this.windowSize = windowSize;
    this.buffer = [];
  }
  
  filter(value) {
    this.buffer.push(value);
    if (this.buffer.length > this.windowSize) {
      this.buffer.shift();
    }
    
    const sorted = [...this.buffer].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}

/**
 * 异常值检测器
 */
class OutlierDetector {
  constructor() {
    this.history = [];
    this.maxHistory = 20;
  }
  
  isOutlier(value) {
    if (value === 0) return false;
    
    this.history.push(value);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    
    if (this.history.length < 5) return false;
    
    // 计算四分位距(IQR)
    const sorted = [...this.history].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    
    // 异常值判断
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    
    return value < lowerBound || value > upperBound;
  }
}

// 注册处理器
registerProcessor('enhanced-audio-processor', EnhancedAudioProcessor);