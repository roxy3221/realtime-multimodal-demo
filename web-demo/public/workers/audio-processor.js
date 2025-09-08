/**
 * Audio Processor Worklet
 * 实时音频分析：RMS、VAD、F0检测和韵律变化检测
 */

class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    
    this.sampleRate = options.processorOptions.sampleRate || 44100;
    this.windowSize = options.processorOptions.windowSize || 1024;
    
    // 初始化分析器状态
    this.initializeAnalyzers();
    
    // 事件触发器状态
    this.lastProsodyEvent = 0;
    this.cooldownMs = 3000; // 增加冷却时间到3秒
    this.thresholdHigh = 0.75; // 提高触发阈值
    this.thresholdLow = 0.35; // 调整退出阈值
    this.isEventActive = false;
    
    // 连续触发检查
    this.consecutiveHighFrames = 0;
    this.minConsecutiveFrames = 3; // 需要连续3帧才触发
    
    // 历史数据用于变化检测
    this.history = {
      rms: new Float32Array(30), // 1秒历史@30Hz
      f0: new Float32Array(30),
      vadConfidence: new Float32Array(30),
      writeIndex: 0
    };
    
    // VAD状态
    this.vadState = {
      isActive: false,
      confidence: 0,
      silenceFrames: 0,
      activeFrames: 0
    };
    
    console.log('🎵 AudioProcessor initialized');
  }
  
  initializeAnalyzers() {
    // RMS计算相关
    this.rmsWindow = new Float32Array(this.windowSize);
    this.rmsAlpha = 0.1; // EMA平滑因子
    this.currentRMS = 0;
    
    // F0检测相关 (简化版YIN算法)
    this.f0Buffer = new Float32Array(this.windowSize * 2);
    this.f0BufferIndex = 0;
    this.currentF0 = 0;
    this.f0Confidence = 0;
    
    // VAD相关
    this.vadThreshold = 0.02; // RMS阈值
    this.vadHangover = 10; // 保持帧数
  }
  
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    
    const channelData = input[0];
    const frameCount = channelData.length;
    
    // 转换为16bit PCM数据用于阿里云ASR
    const pcmData = this.convertToPCM16(channelData);
    
    // 发送音频数据给阿里云ASR
    this.port.postMessage({
      type: 'audio-data',
      audioBuffer: pcmData.buffer,
      sampleRate: this.sampleRate,
      frameCount: frameCount
    }, [pcmData.buffer]); // 使用Transferable Objects提高性能
    
    // 分析音频特征
    const rms = this.computeRMS(channelData);
    const f0 = this.computeF0(channelData);
    const vadResult = this.computeVAD(rms);
    
    // 更新历史数据
    this.updateHistory(rms, f0, vadResult.confidence);
    
    // 计算变化分数和触发事件
    const deltaScore = this.computeDeltaScore();
    this.checkEventTrigger(deltaScore, rms, f0);
    
    return true;
  }
  
  /**
   * 转换Float32音频数据为16bit PCM
   */
  convertToPCM16(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      // 将-1.0到1.0的float值转换为-32768到32767的int16值
      let sample = Math.max(-1, Math.min(1, float32Array[i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, sample, true); // little endian
    }
    
    return new Uint8Array(buffer);
  }
  
  /**
   * 计算RMS能量
   */
  computeRMS(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    
    const rms = Math.sqrt(sum / samples.length);
    
    // 指数滑动平均
    this.currentRMS = this.rmsAlpha * rms + (1 - this.rmsAlpha) * this.currentRMS;
    
    return this.currentRMS;
  }
  
  /**
   * 简化版F0检测 (基于自相关)
   */
  computeF0(samples) {
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
    
    // 计算自相关
    const f0 = this.autocorrelationF0(this.f0Buffer);
    this.currentF0 = f0;
    
    return f0;
  }
  
  /**
   * 自相关F0检测
   */
  autocorrelationF0(buffer) {
    const minPeriod = Math.floor(this.sampleRate / 800); // 800Hz max
    const maxPeriod = Math.floor(this.sampleRate / 80);  // 80Hz min
    
    let maxCorrelation = 0;
    let bestPeriod = 0;
    
    // 搜索最佳周期
    for (let period = minPeriod; period < maxPeriod && period < buffer.length / 2; period++) {
      let correlation = 0;
      let energy = 0;
      
      for (let i = 0; i < buffer.length - period; i++) {
        correlation += buffer[i] * buffer[i + period];
        energy += buffer[i] * buffer[i];
      }
      
      // 归一化相关性
      const normalizedCorr = energy > 0 ? correlation / energy : 0;
      
      if (normalizedCorr > maxCorrelation) {
        maxCorrelation = normalizedCorr;
        bestPeriod = period;
      }
    }
    
    // 置信度检查
    this.f0Confidence = maxCorrelation;
    
    if (maxCorrelation > 0.3 && bestPeriod > 0) {
      return this.sampleRate / bestPeriod;
    }
    
    return 0; // 无音调
  }
  
  /**
   * VAD检测
   */
  computeVAD(rms) {
    const isActive = rms > this.vadThreshold;
    let confidence = Math.min(rms / this.vadThreshold, 1.0);
    
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
    
    // VAD状态变化时发送事件
    if (wasActive !== this.vadState.isActive) {
      this.port.postMessage({
        type: 'vad-change',
        data: {
          isActive: this.vadState.isActive,
          confidence: confidence,
          timestamp: Date.now()
        }
      });
    }
    
    return { confidence, isActive: this.vadState.isActive };
  }
  
  /**
   * 更新历史数据
   */
  updateHistory(rms, f0, vadConfidence) {
    const idx = this.history.writeIndex;
    this.history.rms[idx] = rms;
    this.history.f0[idx] = f0;
    this.history.vadConfidence[idx] = vadConfidence;
    
    this.history.writeIndex = (idx + 1) % this.history.rms.length;
  }
  
  /**
   * 计算变化分数
   */
  computeDeltaScore() {
    const recentFrames = 5; // 最近5帧
    const historicalFrames = 15; // 历史15帧
    
    // 计算最近和历史的统计值
    const recentStats = this.computeStats(recentFrames);
    const historicalStats = this.computeStats(historicalFrames);
    
    if (!recentStats || !historicalStats) return 0;
    
    // 计算相对变化
    const rmsChange = Math.abs(recentStats.rms - historicalStats.rms) / 
                     Math.max(historicalStats.rms, 0.001);
    
    const f0Change = historicalStats.f0 > 0 ? 
                    Math.abs(recentStats.f0 - historicalStats.f0) / historicalStats.f0 : 0;
    
    // 加权变化分数
    const deltaScore = 0.4 * Math.min(rmsChange, 1.0) + 
                      0.6 * Math.min(f0Change, 1.0);
    
    return Math.min(deltaScore, 1.0);
  }
  
  /**
   * 计算统计值
   */
  computeStats(frameCount) {
    if (this.history.writeIndex < frameCount) return null;
    
    let rmsSum = 0, f0Sum = 0, validF0Count = 0;
    const startIdx = (this.history.writeIndex - frameCount + this.history.rms.length) % 
                    this.history.rms.length;
    
    for (let i = 0; i < frameCount; i++) {
      const idx = (startIdx + i) % this.history.rms.length;
      rmsSum += this.history.rms[idx];
      
      if (this.history.f0[idx] > 0) {
        f0Sum += this.history.f0[idx];
        validF0Count++;
      }
    }
    
    return {
      rms: rmsSum / frameCount,
      f0: validF0Count > 0 ? f0Sum / validF0Count : 0
    };
  }
  
  /**
   * 检查事件触发
   */
  checkEventTrigger(deltaScore, rms, f0) {
    const now = Date.now();
    
    // 冷却检查
    if (now - this.lastProsodyEvent < this.cooldownMs) return;
    
    // 连续帧检查
    if (deltaScore > this.thresholdHigh) {
      this.consecutiveHighFrames++;
    } else {
      this.consecutiveHighFrames = 0;
    }
    
    // 双阈值触发器 + 连续帧要求
    let shouldTrigger = false;
    
    if (!this.isEventActive && 
        deltaScore > this.thresholdHigh && 
        this.consecutiveHighFrames >= this.minConsecutiveFrames) {
      // 进入事件状态
      shouldTrigger = true;
      this.isEventActive = true;
      this.consecutiveHighFrames = 0; // 重置
    } else if (this.isEventActive && deltaScore < this.thresholdLow) {
      // 退出事件状态
      this.isEventActive = false;
      this.consecutiveHighFrames = 0;
    }
    
    if (shouldTrigger) {
      this.lastProsodyEvent = now;
      
      // 发送韵律事件
      this.port.postMessage({
        type: 'prosody-event',
        data: {
          deltaScore,
          rms,
          f0,
          confidence: this.f0Confidence,
          vadActive: this.vadState.isActive,
          timestamp: now
        }
      });
    }
  }
}

// 注册处理器
registerProcessor('audio-processor', AudioProcessor);