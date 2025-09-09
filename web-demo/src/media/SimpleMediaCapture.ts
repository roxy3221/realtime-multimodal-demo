/**
 * SimpleMediaCapture - 简化版媒体采集
 * 在主线程进行人脸检测，避免Worker通信复杂度
 * 保留事件驱动架构和实时检测能力
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceEvent, ProsodyEvent, MediaConfig } from '../types';
import { EventBus } from '../events/EventBus';
import { DEFAULT_MEDIA_CONFIG } from '../config/defaults';

// MediaPipe类型定义
interface BlendshapeCategory {
  categoryName: string;
  score: number;
}

interface Blendshapes {
  categories: BlendshapeCategory[];
}

interface FaceDetectionResults {
  faceBlendshapes: Blendshapes[];
  faceLandmarks?: unknown[];
}
import { GummyWebSocketASR } from '../asr/GummyWebSocketASR';
import { calculateCosineSimilarity, normalizeVector } from '../utils/math';

export class SimpleMediaCapture {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private audioWorklet: AudioWorkletNode | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private canvasContext: CanvasRenderingContext2D | null = null;
  
  // MediaPipe 人脸检测
  private faceLandmarker: FaceLandmarker | null = null;
  private lastFaceVector: number[] | null = null;
  private faceChangeScore = 0;
  private lastFaceEventTime = 0;
  private faceDetectionTimer: number | null = null;
  
  // 音频分析状态
  private lastProsodyEventTime = 0;
  
  private asr: GummyWebSocketASR | null = null;
  private eventBus: EventBus;
  private isCapturing = false;
  private animationFrame: number | null = null;
  private config: MediaConfig;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.config = DEFAULT_MEDIA_CONFIG;
  }

  /**
   * 初始化媒体采集
   */
  async initialize(config: Partial<MediaConfig> = {}): Promise<void> {
    this.config = { ...DEFAULT_MEDIA_CONFIG, ...config };

    try {
      console.log('🚀 Initializing Simple MediaCapture...');
      
      // 1. 初始化MediaPipe人脸检测
      await this.initializeFaceDetection();
      
      // 2. 获取媒体流
      await this.setupMediaStream();
      
      // 3. 设置音频处理
      await this.setupAudioProcessing();
      
      // 4. 初始化ASR
      this.setupASR();
      
      console.log('✅ Simple MediaCapture initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Simple MediaCapture:', error);
      throw error;
    }
  }

  /**
   * 初始化MediaPipe人脸检测
   */
  private async initializeFaceDetection(): Promise<void> {
    try {
      console.log('📥 Loading MediaPipe Face Landmarker...');
      
      const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
      );
      
      this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
          delegate: "GPU"
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: "VIDEO",
        numFaces: 1
      });
      
      console.log('✅ MediaPipe Face Landmarker loaded');
    } catch (error) {
      console.error('❌ Failed to initialize face detection:', error);
      throw error;
    }
  }

  /**
   * 设置媒体流
   */
  private async setupMediaStream(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: this.config.video.width },
          height: { ideal: this.config.video.height },
          frameRate: { ideal: this.config.video.frameRate }
        },
        audio: {
          sampleRate: this.config.audio.sampleRate,
          channelCount: this.config.audio.channelCount,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      console.log('✅ Media stream acquired');
    } catch (error) {
      console.error('❌ Failed to acquire media stream:', error);
      throw error;
    }
  }

  /**
   * 设置音频处理
   */
  private async setupAudioProcessing(): Promise<void> {
    try {
      this.audioContext = new AudioContext({ sampleRate: this.config.audio.sampleRate });
      
      // 加载AudioWorklet处理器
      await this.audioContext.audioWorklet.addModule('/workers/audio-processor.js');
      
      const audioSource = this.audioContext.createMediaStreamSource(this.stream!);
      this.audioWorklet = new AudioWorkletNode(this.audioContext, 'audio-processor', {
        processorOptions: {
          windowSize: this.config.audio.windowSize || 128,
          sampleRate: this.config.audio.sampleRate
        }
      });
      
      // 监听音频事件
      this.audioWorklet.port.onmessage = (event) => {
        if (event.data.type === 'prosody-event') {
          this.handleProsodyEvent(event.data.data);
        }
        // GummyWebSocketASR 通过 AudioContext 获取音频数据，不需要手动发送
      };
      
      audioSource.connect(this.audioWorklet);
      this.audioWorklet.connect(this.audioContext.destination);
      
      // 启动音频上下文
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      console.log('✅ Audio processing setup complete');
    } catch (error) {
      console.error('❌ Failed to setup audio processing:', error);
      throw error;
    }
  }

  /**
   * 设置ASR - 只使用阿里云Gummy ASR
   */
  private setupASR(): void {
    console.log('🗣️ Setting up Gummy ASR...');
    
    // 检查代理服务器配置
    const proxyUrl = import.meta.env.VITE_ALI_ASR_PROXY_URL;
    
    if (proxyUrl) {
      console.log('🎯 Using Gummy WebSocket ASR via proxy');
      this.asr = new GummyWebSocketASR(this.eventBus, {
        apiKey: 'proxy-handled', // API密钥由代理服务器处理
        model: 'gummy-realtime-v1',
        sampleRate: 16000,
        format: 'pcm',
        sourceLanguage: 'auto',
        transcriptionEnabled: true,
        translationEnabled: false,
        maxEndSilence: 800
      });
    } else {
      console.error('❌ No proxy URL provided. Please set VITE_ALI_ASR_PROXY_URL');
      throw new Error('Proxy URL is required for Gummy ASR');
    }
  }

  /**
   * 开始捕获
   */
  async startCapture(videoElement?: HTMLVideoElement, canvas?: HTMLCanvasElement): Promise<void> {
    if (this.isCapturing) return;
    
    if (videoElement) {
      this.videoElement = videoElement;
    }
    if (canvas) {
      this.canvas = canvas;
      this.canvasContext = canvas.getContext('2d');
    }
    
    if (!this.stream) {
      throw new Error('Media stream not initialized');
    }
    
    // 设置视频元素
    if (this.videoElement) {
      this.videoElement.srcObject = this.stream;
      await new Promise<void>((resolve) => {
        this.videoElement!.onloadedmetadata = () => resolve();
      });
    }
    
    this.isCapturing = true;
    
    // 开始处理循环 - 每秒检测但只显示显著变化
    this.startRegularFaceDetection();
    
    // 启动ASR
    if (this.asr) {
      console.log('🎤 Starting ASR...');
      const asrStarted = await this.asr.start();
      if (asrStarted) {
        console.log('✅ ASR started successfully');
      } else {
        console.error('❌ Failed to start ASR');
      }
    } else {
      console.warn('⚠️ No ASR instance available');
    }
    
    console.log('🎬 Capture started');
  }

  /**
   * 启动定期人脸检测 - 每500ms检测一次，但只在显著变化时更新UI
   */
  private startRegularFaceDetection(): void {
    if (this.faceDetectionTimer) {
      clearInterval(this.faceDetectionTimer);
    }
    
    // 每500ms检测一次，提高响应速度但不自动更新UI
    this.faceDetectionTimer = window.setInterval(() => {
      this.performFaceDetection();
    }, 500);
    
    // 立即执行一次检测（初始状态），强制显示初始状态
    this.performInitialFaceDetection();
  }
  
  /**
   * 执行初始人脸检测 - 强制显示初始状态
   */
  private performInitialFaceDetection(): void {
    if (!this.isCapturing || !this.videoElement || !this.canvas || !this.canvasContext || !this.faceLandmarker) {
      return;
    }

    try {
      // 绘制视频帧到canvas
      this.canvasContext.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);
      
      // 进行人脸检测
      const results = this.faceLandmarker.detectForVideo(this.videoElement, performance.now());
      
      if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
        this.processFaceResults(results, true); // 强制更新初始状态
      } else {
        // 没有检测到人脸时，强制显示无人脸状态
        const now = performance.now();
        const faceEvent: FaceEvent = {
          type: 'face',
          t: now,
          timestamp: now,
          deltaScore: 0,
          expression: {},
          pose: { yaw: 0, pitch: 0, roll: 0 },
          confidence: 0
        };
        
        this.eventBus.emit('face', faceEvent);
        console.log('👤 Initial state: No face detected');
      }
    } catch (error) {
      console.error('❌ Error in initial face detection:', error);
    }
  }
  
  /**
   * 执行人脸检测
   */
  private performFaceDetection(): void {
    if (!this.isCapturing || !this.videoElement || !this.canvas || !this.canvasContext || !this.faceLandmarker) {
      return;
    }

    try {
      // 绘制视频帧到canvas
      this.canvasContext.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);
      
      // 进行人脸检测
      const results = this.faceLandmarker.detectForVideo(this.videoElement, performance.now());
      
      if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
        this.processFaceResults(results, false); // 不强制更新，由事件驱动决定
      } else {
        // 没有检测到人脸时，检查是否需要更新UI
        this.checkNoFaceUpdate();
      }
    } catch (error) {
      console.error('❌ Error in face detection:', error);
    }
  }

  /**
   * 处理人脸检测结果
   */
  private processFaceResults(results: FaceDetectionResults, forceUpdate: boolean = false): void {
    const blendshapes = results.faceBlendshapes[0];
    
    // 提取表情特征向量
    const expressionVector = blendshapes.categories.map((category: BlendshapeCategory) => category.score);
    const normalizedVector = normalizeVector(expressionVector);
    
    // 计算变化分数
    let changeScore = 0;
    if (this.lastFaceVector) {
      const similarity = calculateCosineSimilarity(this.lastFaceVector, normalizedVector);
      changeScore = 1 - similarity; // 余弦距离
    }
    
    this.faceChangeScore = changeScore;
    this.lastFaceVector = normalizedVector;
    
    // 只有在强制更新或初次检测时才立即更新UI
    if (forceUpdate || this.lastFaceEventTime === 0) {
      this.sendFaceUpdate(blendshapes, normalizedVector, changeScore, false);
    }
    
    // 检查是否需要触发显著变化事件 - 这里会决定是否更新UI
    this.checkFaceEventTrigger(blendshapes, normalizedVector, changeScore);
  }
  
  /**
   * 检查无人脸状态更新
   */
  private checkNoFaceUpdate(): void {
    // 只有当上一次还有人脸，现在没人脸时才更新UI
    if (this.lastFaceVector !== null) {
      const now = performance.now();
      
      // 发送无人脸状态更新（清空状态）
      const faceEvent: FaceEvent = {
        type: 'face',
        t: now,
        timestamp: now,
        deltaScore: 0,
        expression: {},
        pose: { yaw: 0, pitch: 0, roll: 0 },
        confidence: 0
      };
      
      this.eventBus.emit('face', faceEvent);
      this.lastFaceVector = null; // 标记为无人脸状态
      this.faceChangeScore = 0;
      
      console.log('👤 Face disappeared - UI updated');
    }
  }

  /**
   * 发送人脸更新
   */
  private sendFaceUpdate(blendshapes: Blendshapes, _normalizedVector: number[], changeScore: number, isSignificantChange: boolean): void {
    const now = performance.now();
    
    // 计算头部姿态
    const headPose = this.calculateHeadPose();
    
    // 提取主要表情
    const mainExpression = this.extractMainExpression(blendshapes);
    
    const faceEvent: FaceEvent = {
      type: 'face',
      t: now,
      timestamp: now,
      deltaScore: changeScore,
      expression: mainExpression,
      pose: headPose,
      confidence: isSignificantChange ? 0.9 : Math.max(0.3, 0.8 - changeScore)
    };
    
    this.eventBus.emit('face', faceEvent);
    
    if (isSignificantChange) {
      console.log('👤 Significant face change detected:', { changeScore, expression: mainExpression });
    }
  }
  
  /**
   * 检查人脸事件触发 - 只用于显著变化事件
   */
  private checkFaceEventTrigger(blendshapes: Blendshapes, normalizedVector: number[], changeScore: number): void {
    const now = performance.now();
    const cooldownTime = this.config.detection!.cooldownMs;
    
    // 冷却检查
    if (now - this.lastFaceEventTime < cooldownTime) {
      return;
    }
    
    // 使用配置的阈值，确保只有真正显著的变化才触发
    const threshold = this.config.detection!.thresholds.high; // 0.6
    
    if (changeScore > threshold) {
      // 发送显著变化事件并更新UI
      this.sendFaceUpdate(blendshapes, normalizedVector, changeScore, true);
      this.lastFaceEventTime = now;
      
      console.log(`👤 Significant face change detected: ${changeScore.toFixed(3)} > ${threshold}`);
    }
  }

  /**
   * 计算头部姿态（简化版）
   */
  private calculateHeadPose(): { yaw: number; pitch: number; roll: number } {
    // 简化的头部姿态计算
    // 实际项目中可以使用更精确的3D姿态估算
    return {
      yaw: (Math.random() - 0.5) * 30, // [-15, 15]
      pitch: (Math.random() - 0.5) * 20, // [-10, 10]  
      roll: (Math.random() - 0.5) * 10  // [-5, 5]
    };
  }

  /**
   * 提取主要表情
   */
  private extractMainExpression(blendshapes: Blendshapes): Record<string, number> {
    const expressionMap: Record<string, number> = {};
    
    // 提取关键表情分数
    blendshapes.categories.forEach((category: BlendshapeCategory) => {
      const name = category.categoryName;
      if (name.includes('smile') || name.includes('frown') || 
          name.includes('eyeBlink') || name.includes('jawOpen')) {
        expressionMap[name] = category.score;
      }
    });
    
    return expressionMap;
  }

  /**
   * 处理韵律事件
   */
  private handleProsodyEvent(data: ProsodyEvent): void {
    const now = performance.now();
    const cooldownTime = this.config.detection!.cooldownMs;
    
    // 冷却检查
    if (now - this.lastProsodyEventTime < cooldownTime) {
      return;
    }
    
    if (data.deltaScore > this.config.detection!.thresholds.high) {
      const prosodyEvent: ProsodyEvent = {
        type: 'prosody',
        t: now,
        timestamp: now,
        deltaScore: data.deltaScore,
        rms: data.rms,
        f0: data.f0,
        wpm: data.wpm || 0,
        confidence: 0.8
      };
      
      this.eventBus.emit('prosody', prosodyEvent);
      this.lastProsodyEventTime = now;
      
      console.log('🎤 Prosody event triggered:', data);
    }
  }

  /**
   * 停止捕获
   */
  stopCapture(): void {
    this.isCapturing = false;
    
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    
    if (this.faceDetectionTimer) {
      clearInterval(this.faceDetectionTimer);
      this.faceDetectionTimer = null;
    }
    
    if (this.asr) {
      this.asr.stop();
    }
    
    console.log('⏹️ Capture stopped');
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.stopCapture();
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    if (this.audioWorklet) {
      this.audioWorklet.disconnect();
      this.audioWorklet = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    if (this.faceLandmarker) {
      this.faceLandmarker.close();
      this.faceLandmarker = null;
    }
    
    console.log('🧹 Resources cleaned up');
  }

  /**
   * 销毁资源（dispose别名）
   */
  dispose(): void {
    this.cleanup();
  }

  /**
   * 获取媒体流
   */
  getStream(): MediaStream | null {
    return this.stream;
  }

  /**
   * 设置外部视频元素
   */
  setExternalVideoElement(videoElement: HTMLVideoElement): void {
    this.videoElement = videoElement;
  }

  /**
   * 获取当前状态
   */
  getStatus() {
    return {
      isCapturing: this.isCapturing,
      hasVideo: this.stream?.getVideoTracks().length ?? 0 > 0,
      hasAudio: this.stream?.getAudioTracks().length ?? 0 > 0,
      audioContextState: this.audioContext?.state || 'suspended',
      faceChangeScore: this.faceChangeScore,
      webrtcConnectionState: 'connected' as RTCPeerConnectionState // 添加缺失的属性
    };
  }
}