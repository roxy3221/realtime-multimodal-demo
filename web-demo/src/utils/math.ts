/**
 * 数学和信号处理工具函数
 * 移植自Python MultiModalAnalyzer中的核心算法
 */

/**
 * 指数滑动平均（EMA）
 * 用于去噪和平滑信号
 */
export function exponentialMovingAverage(
  current: number,
  previous: number,
  alpha: number = 0.3
): number {
  return alpha * current + (1 - alpha) * previous;
}

/**
 * 计算RMS能量（Root Mean Square）
 */
export function calculateRMS(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  
  return Math.sqrt(sum / samples.length);
}

/**
 * 将RMS转换为dBFS（decibels relative to full scale）
 */
export function rmsToDbFS(rms: number): number {
  if (rms <= 0) return -Infinity;
  return 20 * Math.log10(rms);
}

/**
 * Z-Score标准化
 */
export function zScoreNormalize(
  value: number,
  mean: number,
  std: number
): number {
  if (std === 0) return 0;
  return (value - mean) / std;
}

/**
 * 计算余弦距离（用于表情向量比较）
 */
export function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  if (normA === 0 || normB === 0) return 1.0; // 最大距离
  
  const cosineSimilarity = dotProduct / (normA * normB);
  return 1 - cosineSimilarity; // 转换为距离
}

/**
 * 计算欧氏距离
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }
  
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  
  return Math.sqrt(sum);
}

/**
 * 滑动窗口统计
 */
export class SlidingWindowStats {
  private values: number[] = [];
  private windowSize: number;
  
  constructor(windowSize: number = 30) {
    this.windowSize = windowSize;
  }
  
  update(value: number): void {
    this.values.push(value);
    if (this.values.length > this.windowSize) {
      this.values.shift();
    }
  }
  
  getMean(): number {
    if (this.values.length === 0) return 0;
    return this.values.reduce((sum, v) => sum + v, 0) / this.values.length;
  }
  
  getStd(): number {
    if (this.values.length === 0) return 0;
    
    const mean = this.getMean();
    const variance = this.values.reduce((sum, v) => {
      const diff = v - mean;
      return sum + diff * diff;
    }, 0) / this.values.length;
    
    return Math.sqrt(variance);
  }
  
  getRange(): [number, number] {
    if (this.values.length === 0) return [0, 0];
    return [Math.min(...this.values), Math.max(...this.values)];
  }
  
  clear(): void {
    this.values = [];
  }
}

/**
 * 双阈值触发器（防抖动）
 */
export class HysteresisTrigger {
  private isTriggered = false;
  private lastTriggerTime = 0;
  
  constructor(
    private highThreshold: number = 0.6,
    private lowThreshold: number = 0.4,
    private cooldownMs: number = 1200
  ) {}
  
  update(value: number, currentTime: number): {
    shouldTrigger: boolean;
    justTriggered: boolean;
    justUntriggered: boolean;
  } {
    const inCooldown = (currentTime - this.lastTriggerTime) < this.cooldownMs;
    const wasTriggered = this.isTriggered;
    
    if (!this.isTriggered && value >= this.highThreshold && !inCooldown) {
      this.isTriggered = true;
      this.lastTriggerTime = currentTime;
    } else if (this.isTriggered && value <= this.lowThreshold) {
      this.isTriggered = false;
    }
    
    return {
      shouldTrigger: this.isTriggered,
      justTriggered: !wasTriggered && this.isTriggered,
      justUntriggered: wasTriggered && !this.isTriggered
    };
  }
  
  reset(): void {
    this.isTriggered = false;
    this.lastTriggerTime = 0;
  }
}

/**
 * 简单的圆形缓冲区
 */
export class CircularBuffer<T> {
  private buffer: T[];
  private head = 0;
  private count = 0;
  
  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }
  
  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }
  
  toArray(): T[] {
    if (this.count < this.capacity) {
      return this.buffer.slice(0, this.count);
    }
    
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head)
    ];
  }
  
  getLatest(n: number = 1): T[] {
    const items = this.toArray();
    return items.slice(-n);
  }
  
  clear(): void {
    this.head = 0;
    this.count = 0;
  }
  
  get size(): number {
    return this.count;
  }
  
  get isFull(): boolean {
    return this.count === this.capacity;
  }
}