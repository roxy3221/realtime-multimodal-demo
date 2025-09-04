/**
 * 事件系统类型定义 - 基于Claude.md规范
 * 映射自Python MultiModalAnalyzer_Optimized的事件结构
 */

// 事件基类
export interface BaseEvent {
  type: 'face' | 'prosody' | 'asr';
  t: number; // 时间戳 (ms)
  id?: string; // 事件唯一标识
}

// 人脸事件（显著变化）
export interface FaceEvent extends BaseEvent {
  type: 'face';
  deltaScore: number; // 0~1，变化强度
  expr: Record<string, number>; // 表情分数 {Smile:0.72, Frown:0.08, ...}
  pose: {
    yaw: number;   // 左右转头角度
    pitch: number; // 上下点头角度 
    roll: number;  // 左右歪头角度
  };
  landmarks?: number[]; // 可选的关键点数据
}

// 韵律事件（显著变化）
export interface ProsodyEvent extends BaseEvent {
  type: 'prosody';
  deltaScore: number; // 0~1，变化强度
  rms: number;        // 音量能量
  f0: number;         // 基频/音高
  wpm: number;        // 语速 (words per minute)
  vad?: boolean;      // VAD检测结果
}

// ASR增量事件
export interface ASREvent extends BaseEvent {
  type: 'asr';
  textDelta: string; // 增量文本
  words?: Array<{    // 词级时间戳（可选）
    w: string;       // 单词
    s: number;       // 开始时间 (ms)
    e: number;       // 结束时间 (ms)
    confidence?: number;
  }>;
  isFinal: boolean; // 是否为最终结果
  currentWPM?: number; // 当前语速
}

// 联合事件类型
export type MultiModalEvent = FaceEvent | ProsodyEvent | ASREvent;

// 事件监听器
export type EventListener<T extends MultiModalEvent = MultiModalEvent> = (event: T) => void;

// 事件触发配置
export interface TriggerConfig {
  face: {
    T_high: number;    // 进入阈值
    T_low: number;     // 退出阈值
    cooldown_ms: number; // 冷却时间
    min_frames: number;  // 最小连续帧数
  };
  prosody: {
    T_high: number;
    T_low: number;
    cooldown_ms: number;
    min_samples: number;
  };
  global: {
    max_event_rate: number; // 最大事件频率 (events/sec)
  };
}

// 分析器状态
export interface AnalyzerState {
  face: {
    last_event_time: number;
    current_score: number;
    is_in_cooldown: boolean;
    baseline_features: Record<string, number>;
  };
  prosody: {
    last_event_time: number;
    current_score: number;
    is_in_cooldown: boolean;
    baseline_features: {
      rms_avg: number;
      f0_avg: number;
      wpm_avg: number;
    };
  };
}

// 事件导出格式
export interface EventExport {
  session_id: string;
  start_time: number;
  end_time: number;
  events: MultiModalEvent[];
  summary: {
    total_duration_ms: number;
    face_events: number;
    prosody_events: number;
    asr_events: number;
    avg_face_score: number;
    avg_prosody_score: number;
  };
}