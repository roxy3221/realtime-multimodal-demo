/**
 * 分析器类型定义
 * 映射自Python MultiModalAnalyzer的组件接口
 */

// 音频特征（对应ProsodyAnalyzer输出）
export interface AudioFeatures {
  pitch: number[];  // F0序列
  rate: number[];   // 语速变化序列
  level: number[];  // 音量级别序列
  rms: number;      // RMS能量
  duration_ms: number;
}

// 面部特征（对应FacialAnalyzer输出）
export interface FaceFeatures {
  // 表情特征 [mean, std]
  Smile: [number, number];
  Mouth: [number, number];
  EAR: [number, number];   // Eye Aspect Ratio
  Brow: [number, number];
  
  // 姿态特征 [value, variance] 
  Yaw: [number, number];
  Pitch: [number, number];
  Roll: [number, number];
  
  // 其他
  FaceSize?: [number, number];
  landmarks?: number[]; // 468个关键点坐标
}

// VAD检测结果
export interface VADResult {
  speech_segments: Array<{
    start_time: number;
    end_time: number;
    confidence?: number;
  }>;
  pause_segments: Array<{
    start_time: number;
    end_time: number;
  }>;
}

// ASR分段结果
export interface ASRSegment {
  text: string;
  start_ms: number;
  end_ms: number;
  source: 'ASR_PUNCT' | 'VAD_FALLBACK' | 'MOCK' | 'WEB_SPEECH';
  punct?: string;
  confidence?: number;
}

// 缓存数据结构（对应EventDrivenCache）
export interface CacheEntry<T> {
  timestamp: number;
  data: T;
  ttl: number; // Time To Live
}

export interface EventDrivenCacheData {
  audio: Map<number, AudioFeatures>;
  face: Map<number, FaceFeatures>;
  events: Map<number, any>; // 事件缓存
}

// 预计算结果（对应Python的precompute阶段）
export interface PrecomputedData {
  audio: {
    duration_ms: number;
    sample_rate: number;
    vad_result?: VADResult;
    features?: any; // 预计算的音频特征
  };
  video: {
    duration_ms: number;
    fps: number;
    total_frames: number;
    face_cache: Map<number, FaceFeatures>; // 稀疏采样的人脸特征
  };
}

// 分析器配置（映射自Python CFG）
export interface AnalyzerConfig {
  // 分段控制
  max_segment_s: number;
  max_chars: number;
  vad_pause_cut_s: number;
  prosody_points: number;
  
  // 事件驱动配置
  analysis_window_s: number;
  trigger_threshold: number;
  cache_max_age_s: number;
  min_recompute_interval_s: number;
  
  // 性能配置
  parallel_precompute: boolean;
  video_fps_cap: number;
  audio_buffer_size: number;
}

// Worker消息类型
export interface WorkerMessage<T = any> {
  type: 'init' | 'process' | 'result' | 'error' | 'config';
  id: string;
  data: T;
  timestamp: number;
}

// 媒体流配置
export interface MediaConfig {
  video: {
    width: number;
    height: number;
    frameRate: number;
    facingMode: 'user' | 'environment';
    processingRate?: number; // 处理帧率
  };
  audio: {
    sampleRate: number;
    channelCount: number;
    echoCancellation: boolean;
    noiseSuppression: boolean;
    windowSize?: number; // 音频窗口大小
  };
}