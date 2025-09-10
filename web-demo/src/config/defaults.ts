/**
 * 默认配置 - 基于Claude.md和Python优化版参数
 */

import type { AnalyzerConfig, TriggerConfig, MediaConfig } from '../types';

// 分析器默认配置（映射自Python CFG）
export const DEFAULT_ANALYZER_CONFIG: AnalyzerConfig = {
  // 分段控制（来自Python）
  max_segment_s: 12.0,
  max_chars: 30,
  vad_pause_cut_s: 0.4,
  prosody_points: 15,
  
  // 事件驱动配置（来自Python）
  analysis_window_s: 2.0,
  trigger_threshold: 0.5,
  cache_max_age_s: 300.0,
  min_recompute_interval_s: 0.5,
  
  // Web特有的性能配置
  parallel_precompute: true,
  video_fps_cap: 15, // 降低到15fps以节省资源
  audio_buffer_size: 4096,
};

// 触发配置（来自Claude.md，调整为更保守的阈值）
export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  face: {
    T_high: 0.15,      // 进一步降低阈值，更容易触发 
    T_low: 0.1,        // 进一步降低退出阈值
    cooldown_ms: 1000, // 减少冷却时间到1秒
    min_frames: 2,     // 减少最小连续帧数
  },
  prosody: {
    T_high: 0.4,       // 降低阈值更容易触发
    T_low: 0.2,
    cooldown_ms: 800,
    min_samples: 3,    // 减少最小连续采样数
  },
  global: {
    max_event_rate: 2.0, // 提高到最大2事件/秒
  },
};

// 媒体采集配置
export const DEFAULT_MEDIA_CONFIG: MediaConfig = {
  video: {
    width: 640,
    height: 480,
    frameRate: 15,     // 匹配fps_cap
    facingMode: 'user',
    processingRate: 15, // 添加处理帧率
  },
  audio: {
    sampleRate: 16000, // 标准语音识别采样率
    channelCount: 1,   // 单声道
    echoCancellation: true,
    noiseSuppression: true,
    windowSize: 1024,  // 添加窗口大小
    frameSize: 128,    // 添加帧大小
  },
  detection: {
    cooldownMs: 2000,  // 与face.cooldown_ms保持一致
    thresholds: {
      high: 0.3,       // 与face.T_high保持一致
      low: 0.2,        // 与face.T_low保持一致
    },
  },
};

// 性能目标（来自Claude.md非功能指标）
export const PERFORMANCE_TARGETS = {
  // PRD目标
  end_to_end_latency_ms: 200,  // 事件触发到UI呈现
  asr_latency_ms: 800,         // ASR字幕延迟
  cpu_usage_target: 0.5,       // 50% CPU使用率上限
  min_fps: 15,                 // 最小帧率保证
  
  // 缓冲区配置
  audio_buffer_duration_ms: 256, // ~16ms @ 16kHz
  video_analysis_interval_ms: 66, // ~15fps
  event_batch_size: 10,
  
  // 内存管理
  max_cache_size_mb: 50,
  gc_interval_ms: 30000, // 30秒清理一次
};

// 开发/调试配置
export const DEBUG_CONFIG = {
  enable_logging: true,
  log_level: 'debug' as 'debug' | 'info' | 'warn' | 'error',
  enable_performance_monitoring: true,
  show_debug_overlay: false,
  export_events_json: true,
};