一句话目标

做一个浏览器端实时多模态监测 Demo：仅在人脸表情/姿态发生明显变化或语音韵律（音量/音高/语速）出现显著波动时才触发数据刷新，同时提供实时音转文，并保留事件流与摘要。

⸻

背景 & 参考代码
	•	参考文件：MultiModalAnalyzer_Optimized.py（事件驱动 + 触发式分析架构，分层清晰，含 Mock 组件）
	•	关键理念：
	•	P0 预计算、P1 ASR 并行、P2 事件驱动、P3 缓存聚合
	•	EventDrivenDetector / EventDrivenCache：仅在超过阈值时产出事件（避免高频全量刷新）
	•	ASR 分段模式（如 ASR_PUNCT_FIRST）与 PauseDetector（VAD）
	•	ProsodyAnalyzer：音量/音高/节奏等韵律特征
	•	FacialAnalyzer：表情向量/姿态关键点

本 PRD 将把上述 Python 思路映射到 Web 环境（浏览器 + 可选轻后端），保持“事件触发”核心机制。

⸻

用户故事
	1.	作为用户，我打开网页，授权摄像头与麦克风；页面只在**“出现明显变化”**时更新面板，避免抖动与信息噪声。
	2.	我希望页面实时呈现音转文，并在语速、音量或音高变化较大时给出韵律事件提示。
	3.	我希望页面只在我笑了/皱眉/抬头/侧脸等明显变化时更新“人脸状态卡片”。
	4.	我希望能查看事件时间线与摘要（例如：00:05 语速显著加快；00:12 微笑强度上升）。

⸻

范围（MVP）
	•	✅ 浏览器端：
	•	摄像头流：人脸关键点/表情估计 + 变化检测（阈值触发）
	•	麦克风流：实时 VAD + 音量/音高估计 + 语速估计（结合 ASR 字词时间戳）
	•	实时 ASR（优先使用浏览器原生或低延迟云 ASR）
	•	事件总线：将“显著变化”投递到 UI（卡片 + 时间线）
	•	✅ 轻后端（可选）：
	•	若使用云 ASR/自定义 VAD：提供 WebSocket 流式接口
	•	事件归档与下载（JSON）
	•	❌ 非目标（MVP 外）：身份识别、多人检测、情绪诊断/医疗结论、端到端存储音视频原件

⸻

非功能指标（MVP 目标）
	•	端到端可视刷新延迟：≤ 200 ms（事件触发到 UI 呈现）
	•	ASR 字幕延迟：≤ 800 ms（取决于选用方案）
	•	CPU：在普通笔记本上保持 < 50%（Chrome）
	•	帧率：摄像头处理 ≥ 15 FPS（事件触发机制可降采样）

⸻

系统架构（Web 适配）

前端（Browser）
	•	采集层：MediaDevices.getUserMedia（video+audio）
	•	处理层（WebWorker + AudioWorklet）：
	•	人脸：MediaPipe Tasks Face Landmarker（或 FaceMesh）/ TensorFlow.js 模型（WASM/WebGL）
	•	韵律：
	•	音量（RMS）、能量（dBFS）
	•	音高（F0，ACF/YIN 简化版，WASM 实现）
	•	语速（WPM）：由 ASR 字词时间戳计算
	•	VAD：WebRTC VAD（WASM）或 Silero VAD（WASM）
	•	变化检测（核心）：
	•	人脸变化分数：表情向量余弦距离 + 关键点/姿态（欧氏距离或角度变化）加权
	•	韵律变化分数：Δ音量、ΔF0、Δ语速 的归一化加权
	•	触发逻辑：采用指数滑动平均(EMA) + 双阈值（进入/退出）+ 冷却时间，避免抖动
	•	事件驱动缓存：滑动窗口聚合统计，暴露 getInterpolatedAudio/Video 等接口（对应 Python 的 EventDrivenCache 思路）
	•	ASR 方案（三选一，按可用性降级）：
	1.	Web Speech API（Chrome 原生，最简；无词级时间戳时做启发式对齐）
	2.	云端流式 ASR（Deepgram/AssemblyAI/阿里云短语音交互），通过 WebSocket 推词级时间戳
	3.	本地 Whisper Tiny (WASM)（延迟稍高，作为离线演示备选）
	•	事件总线：BroadcastChannel / 轻量RxJS 流在 Worker 与 UI 之间派发 FaceEvent / ProsodyEvent / ASREvent
	•	UI：
	•	顶部：摄像头预览 + 边框颜色表示当前状态（平稳/变化）
	•	左栏：实时字幕（以词/子词为单位逐条推进）
	•	右栏：两张卡片
	•	人脸状态：表情分布、姿态角、变化分数
	•	语音韵律：音量/F0/语速即时值 + 变化分数
	•	底部：事件时间线（可导出 JSON）

后端（可选）
	•	/ws/asr：接收 PCM 流（16kHz mono），推送 JSON：{word, start_ms, end_ms}
	•	/log/events：批量接收并持久化事件（用于回放/分析）

⸻

与 Python 架构的映射

Python 组件	Web 对应	说明
MockFacialAnalyzer / FacialAnalyzer	MediaPipe Face Landmarker / TF.js 模型	产出关键点与表情向量
ProsodyAnalyzer	AudioWorklet + WASM F0/RMS/Tempo	产出 F0/能量/语速特征
PauseDetector (VAD)	WebRTC VAD (WASM)/Silero VAD (WASM)	驱动 ASR 分段与语速稳定性
EventDrivenDetector	Worker 内的变化分数计算 + 双阈值触发	只在显著变化时派发事件
EventDrivenCache	滑动窗口缓冲 + 插值查询	供 UI 查询最近稳定数据
ASR_PUNCT_FIRST 分段	结合 VAD + 标点/静音对齐	控制字幕刷写节奏


⸻

关键数据结构（前端）

// 事件基类
interface BaseEvent { type: 'face'|'prosody'|'asr'; t: number; }

// 人脸事件（显著变化）
interface FaceEvent extends BaseEvent {
  type: 'face';
  deltaScore: number; // 0~1，变化强度
  expr: Record<string, number>; // 如 {Smile:0.72, Frown:0.08,...}
  pose: {yaw:number; pitch:number; roll:number};
}

// 韵律事件（显著变化）
interface ProsodyEvent extends BaseEvent {
  type: 'prosody';
  deltaScore: number; // 0~1
  rms: number; f0: number; wpm: number;
}

// ASR 增量
interface ASREvent extends BaseEvent {
  type: 'asr';
  textDelta: string; // 增量文本
  words?: Array<{w:string; s:number; e:number}>; // 可选词级时间戳
}


⸻

变化检测与触发逻辑（详细）
	1.	特征标准化：对人脸表情向量与姿态角、韵律特征统一 z-score/robust 标准化（滑窗统计）
	2.	差分与打分：与滑窗均值做差，计算马氏距离/余弦距离（人脸），对音量/F0/语速做相对变化率
	3.	聚合：deltaScore = w1*face_dist + w2*prosody_dist（类型内先独立判定，跨模态不强制融合）
	4.	双阈值 + 冷却：
	•	进入阈值 T_high 触发事件、标记“变化中”；降到退出阈值 T_low 才回到“平稳”
	•	冷却 cooldown_ms 期间抑制重复触发
	5.	去抖/迟滞：需要连续 k 帧满足才触发；触发后可锁定最显著的峰值帧

参数默认：T_high=0.6, T_low=0.4, k=3, cooldown_ms=1200

⸻

可配置项（UI 面板）
	•	人脸：expr_weights、pose_weights、landmark_simplify、fps_cap
	•	韵律：rms_alpha（EMA）、f0_method（YIN/ACF）、vad_sensitivity
	•	触发：T_high/T_low、k、cooldown_ms、min_event_interval
	•	ASR：provider（WebSpeech/Cloud/WhisperWASM）、partial_flush_interval

⸻

API/契约（若使用云 ASR）
	•	WS 入站：audio/l16; rate=16000 的 PCM 分片（20~40ms）
	•	WS 出站：

{"type":"partial","words":[{"w":"hello","s":120,"e":180}],"text":"hel"}
{"type":"final","words":[{"w":"hello","s":120,"e":180}],"text":"hello"}

	•	断线恢复：客户端带 session_id 与 offset_ms

⸻

隐私与合规
	•	默认不上传音视频，仅上传派生事件与字幕（可本地下载）
	•	若启用云 ASR，提供“仅发送音频特征/开关”与“本地离线模式”
	•	明示摄像头/麦克风权限使用范围与停止按钮

⸻

监控与埋点
	•	指标：平均事件频率、平均延迟、ASR 误字率（CER/WER）、F0 稳定性
	•	错误：权限拒绝、设备变更、音频中断、WS 掉线

⸻

验收标准（MVP）
	•	人脸与韵律面板在稳定状态不抖动；有明显变化时 ≤200ms 内出现事件卡片
	•	连续说话 30s，字幕持续输出且误字率**< 15%**（中文/英文任选一类）
	•	在噪声风扇环境，VAD 能抑制空白段（误触发率 < 5%）

⸻

里程碑与实现计划
	1.	W1：前端采集/显示骨架 + 人脸关键点（Face Landmarker） + 韵律 RMS/F0（AudioWorklet）
	2.	W2：事件触发引擎（双阈值 + 冷却 + 去抖）+ 时间线 UI
	3.	W3：集成 ASR（先 Web Speech，后可切换云端）+ 语速计算
	4.	W4：性能优化（Worker/WASM、帧率/分辨率自适应）+ 导出 JSON

⸻

与 Cursor 代码协作建议
	•	将 MultiModalAnalyzer_Optimized.py 的事件触发/缓存接口整理成伪代码，映射到 TS：
	•	pushAudioFrame() / pushVideoFrame()
	•	computeDeltaScore(prev, curr, cfg)
	•	tryEmitEvent(score, thresholds, cooldown)
	•	getInterpolatedAudio(t, n) / getInterpolatedVideo(t, n)
	•	在 cursor 中新建 web/ 目录：/src/workers/face.ts、/src/workers/audio.ts、/src/asr/*、/src/ui/*
	•	提供 demo.config.json 与 demo.recording.json（导出事件）

⸻

代码骨架（示意）

// workers/events.ts
export type E = FaceEvent|ProsodyEvent|ASREvent;
export class EventBus { /* postMessage & subscribers */ }

// workers/face.ts
onmessage = (e)=>{ /* 接收 VideoFrame/OffscreenCanvas，计算 deltaScore，必要时 postMessage(FaceEvent) */ }

// workers/audio.ts
// 使用 AudioWorkletProcessor 获取 128/256 帧块，计算 RMS/F0，VAD；达阈值时发 ProsodyEvent

// asr/webspeech.ts
// 组装增量字幕与词时间戳（若不可得则按字符速率估计）

// ui/App.tsx
// 订阅事件总线，更新卡片/时间线


⸻

风险与备选
	•	浏览器兼容：Web Speech API 兼容性差 → 云 ASR / Whisper WASM 兜底
	•	移动端性能：降分辨率与帧率、降低模型复杂度
	•	F0 稳定性：噪声环境下 YIN 抖动 → 使用更稳健的 pYIN/滤波与门限

⸻

交付物
	•	前端源码（Vite/React + TS）
	•	可选轻后端（Node/WS）
	•	可运行 Demo 链接与测试脚本
	•	EVENTS.json（导出示例）与 README.md（参数/开关说明）