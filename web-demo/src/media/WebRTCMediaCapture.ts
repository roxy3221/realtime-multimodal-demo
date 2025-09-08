/**
 * WebRTCMediaCapture - 基于WebRTC的增强媒体采集
 * 解决摄像头黑屏、音频质量和设备管理问题
 */

import type { FaceEvent, ProsodyEvent, MediaConfig } from '../types';
import { EventBus } from '../events/EventBus';
import { DEFAULT_MEDIA_CONFIG } from '../config/defaults';
import { GummyWebSocketASR } from '../asr/GummyWebSocketASR';

export class WebRTCMediaCapture {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private externalVideoElement: HTMLVideoElement | null = null;
  private audioContext: AudioContext | null = null;
  private audioWorklet: AudioWorkletNode | null = null;
  private videoWorker: Worker | null = null;
  private videoCanvas: OffscreenCanvas | null = null;
  private videoCanvasContext: OffscreenCanvasRenderingContext2D | null = null;
  private frameProcessingRate = 15; // FPS for face detection
  private videoWorkerReady = false; // 添加Worker就绪状态
  private asr: GummyWebSocketASR | null = null;
  private eventBus: EventBus;
  private isCapturing = false;
  private animationFrame: number | null = null;

  // WebRTC增强功能
  private deviceManager: RTCDeviceManager;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.deviceManager = new RTCDeviceManager();
  }

  /**
   * 初始化WebRTC媒体采集
   */
  async initialize(config: Partial<MediaConfig> = {}): Promise<void> {
    const finalConfig = {
      ...DEFAULT_MEDIA_CONFIG,
      ...config
    };

    try {
      console.log('🚀 Initializing WebRTC MediaCapture...');
      
      // 1. 设置WebRTC连接（本地处理用）
      await this.setupWebRTCConnection();
      
      // 2. 获取优化后的媒体流
      await this.setupEnhancedMediaStream(finalConfig);
      
      // 3. 初始化音频处理管道（WebRTC增强）
      await this.setupEnhancedAudioPipeline(finalConfig);
      
      // 4. 初始化视频处理管道
      await this.setupVideoPipeline(finalConfig);
      
      // 5. 初始化ASR
      this.setupASR();
      
      console.log('✅ WebRTC MediaCapture initialized successfully');
    } catch (error) {
      console.error('❌ WebRTC MediaCapture initialization failed:', error);
      throw this.createDetailedError(error);
    }
  }

  /**
   * 设置WebRTC连接（用于本地音视频优化）
   */
  private async setupWebRTCConnection(): Promise<void> {
    // 创建PeerConnection（本地处理不需要ICE服务器）
    this.peerConnection = new RTCPeerConnection({
      iceServers: [] // 本地处理
    });

    // 监听连接状态
    this.peerConnection.onconnectionstatechange = () => {
      console.log('WebRTC Connection State:', this.peerConnection?.connectionState);
    };

    // 监听ICE连接状态
    this.peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE Connection State:', this.peerConnection?.iceConnectionState);
    };
  }

  /**
   * 获取WebRTC优化的媒体流
   */
  private async setupEnhancedMediaStream(config: MediaConfig): Promise<void> {
    try {
      // 更强壮的 MediaDevices API 检查
      if (typeof navigator === 'undefined') {
        throw new Error('Navigator not available. Are you running in a browser environment?');
      }
      
      if (!navigator.mediaDevices) {
        throw new Error('MediaDevices API not available. This application requires HTTPS or localhost.');
      }
      
      if (!navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia not supported. Please use a modern browser.');
      }

      // 先检查可用设备（添加错误处理）
      let devices;
      try {
        devices = await this.deviceManager.enumerateDevices();
        console.log('Available devices:', devices);
      } catch (deviceError) {
        console.warn('⚠️ Device enumeration failed:', deviceError);
        // 继续执行，不让设备枚举失败阻止整个流程
      }

      // WebRTC优化的约束
      const enhancedConstraints: MediaStreamConstraints = {
        video: {
          width: { ideal: config.video.width },
          height: { ideal: config.video.height },
          frameRate: { ideal: config.video.frameRate },
          facingMode: config.video.facingMode,
          // WebRTC视频增强
          aspectRatio: { ideal: 4/3 }
        },
        audio: {
          // WebRTC音频增强 - 关键改进
          sampleRate: { ideal: 48000 }, // 提升采样率
          channelCount: { exact: 1 },
          echoCancellation: true,       // 回声消除
          noiseSuppression: true,       // 噪声抑制  
          autoGainControl: true,        // 自动增益
          googEchoCancellation: true,   // Google增强回声消除
          googAutoGainControl: true,    // Google自动增益
          googNoiseSuppression: true,   // Google噪声抑制
          googHighpassFilter: true,     // 高通滤波
          googTypingNoiseDetection: true // 键盘噪音检测
        } as Record<string, unknown> // 允许Google特定约束
      };

      this.localStream = await navigator.mediaDevices.getUserMedia(enhancedConstraints);
      
      // 注意：不创建内部video元素，使用外部提供的元素
      
      // 添加到PeerConnection（启用WebRTC处理）
      this.localStream.getTracks().forEach(track => {
        this.peerConnection?.addTrack(track, this.localStream!);
      });
      
      // 等待流准备就绪（如果有外部video元素）
      if (this.externalVideoElement) {
        await new Promise<void>((resolve) => {
          if (this.externalVideoElement!.readyState >= 2) {
            resolve();
          } else {
            this.externalVideoElement!.onloadedmetadata = () => {
              console.log('✅ WebRTC Video stream ready:', {
                width: this.externalVideoElement!.videoWidth,
                height: this.externalVideoElement!.videoHeight
              });
              resolve();
            };
          }
        });
      }

      // 验证音频轨道质量
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        const settings = audioTrack.getSettings();
        console.log('✅ WebRTC Audio settings:', settings);
      }

    } catch (error) {
      console.error('❌ Enhanced media stream setup failed:', error);
      throw error;
    }
  }

  /**
   * 设置WebRTC增强的音频处理管道
   */
  private async setupEnhancedAudioPipeline(config: MediaConfig): Promise<void> {
    if (!this.localStream) throw new Error('Stream not initialized');

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (!audioTrack) {
      console.warn('⚠️ No audio track available');
      return;
    }

    // 创建高采样率AudioContext
    this.audioContext = new AudioContext({
      sampleRate: 48000, // WebRTC优化采样率
      latencyHint: 'interactive'
    });

    // 加载增强的AudioWorklet处理器
    await this.audioContext.audioWorklet.addModule('/workers/enhanced-audio-processor.js');
    
    // 创建WebRTC优化的媒体源
    const source = this.audioContext.createMediaStreamSource(this.localStream);
    
    this.audioWorklet = new AudioWorkletNode(this.audioContext, 'enhanced-audio-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      processorOptions: {
        sampleRate: 48000,
        windowSize: config.audio.windowSize || 2048, // 增大窗口提升质量
        useWebRTCEnhancements: true
      }
    });

    // 监听增强的韵律事件
    this.audioWorklet.port.onmessage = (event) => {
      const { type, data } = event.data;
      
      switch (type) {
        case 'enhanced-prosody-event':
          this.eventBus.publish({
            type: 'prosody',
            t: Date.now(),
            deltaScore: data.deltaScore,
            rms: data.rms,
            f0: data.f0, // WebRTC处理后更稳定的F0
            wpm: data.wpm || 0
          } as ProsodyEvent);
          break;
          
        case 'webrtc-vad-change':
          console.log('WebRTC VAD状态变化:', data);
          break;
          
        case 'audio-data':
          // GummyWebSocketASR 通过 AudioContext 获取音频数据，不需要手动发送
          // 保留此处理器以备将来使用其他ASR服务
          break;
      }
    };

    // 连接音频管道
    source.connect(this.audioWorklet);
    
    console.log('✅ Enhanced WebRTC audio pipeline initialized');
  }

  /**
   * 设置视频处理管道（复用现有逻辑）
   */
  private async setupVideoPipeline(config: MediaConfig): Promise<void> {
    try {
      // 创建 MediaPipe 面部识别 Worker
      this.videoWorker = new Worker('/workers/mediapipe-face-detector.js');
      
      // 设置画布用于帧捕获（优化性能）
      this.videoCanvas = new OffscreenCanvas(config.video.width, config.video.height);
      this.videoCanvasContext = this.videoCanvas.getContext('2d', { 
        willReadFrequently: true,  // 优化频繁读取性能
        alpha: false              // 禁用透明度以提升性能
      });
      
      this.frameProcessingRate = config.video.frameRate || 15;
      
      // 初始化 Worker，传递 OffscreenCanvas
      this.videoWorker.postMessage({
        type: 'init',
        data: {
          canvas: this.videoCanvas, // 传递 OffscreenCanvas
          config: {
            width: config.video.width,
            height: config.video.height,
            processingRate: this.frameProcessingRate
          }
        }
      }, [this.videoCanvas]); // ✅ 必须作为 transferable 对象传递

      // 监听 Worker 消息
      this.videoWorker.onmessage = (event) => {
        const { type, data } = event.data;
        
        switch (type) {
          case 'face-event':
            this.eventBus.publish({
              type: 'face',
              t: Date.now(),
              timestamp: Date.now(),
              deltaScore: data.deltaScore,
              expression: data.expr,
              pose: data.pose,
              confidence: data.confidence || 0.8
            } as FaceEvent);
            break;
            
          case 'status':
            if (data.initialized) {
              this.videoWorkerReady = true;
              console.log('✅ Face detection worker ready');
            }
            console.log('🎭 Face detection worker status:', data);
            break;
            
          case 'error':
            console.error('❌ Face detection worker error:', data);
            this.videoWorkerReady = false;
            break;
        }
      };
      
      console.log('✅ Video pipeline with MediaPipe initialized');
    } catch (error) {
      console.error('❌ Video pipeline setup failed:', error);
      throw error;
    }
  }

  /**
   * 设置ASR - 只使用阿里云Gummy ASR
   */
  private setupASR(): void {
    console.log('🗣️ Setting up Gummy ASR...');
    
    // 检查环境变量中的阿里云配置
    const gummyApiKey = import.meta.env?.VITE_ALIBABA_API_KEY || import.meta.env?.VITE_DASHSCOPE_API_KEY;
    
    if (gummyApiKey) {
      console.log('🎯 Using Gummy WebSocket ASR');
      this.asr = new GummyWebSocketASR(this.eventBus, {
        apiKey: gummyApiKey,
        model: 'gummy-realtime-v1',
        sampleRate: 16000,
        format: 'pcm',
        sourceLanguage: 'auto',
        transcriptionEnabled: true,
        translationEnabled: false,
        maxEndSilence: 800
      });
    } else {
      console.error('❌ No Alibaba Cloud API key provided. Please set VITE_ALIBABA_API_KEY or VITE_DASHSCOPE_API_KEY');
      throw new Error('Alibaba Cloud API key is required for Gummy ASR');
    }
  }

  /**
   * 开始采集
   */
  async startCapture(): Promise<void> {
    if (this.isCapturing) return;
    
    this.isCapturing = true;
    
    // 启动音频上下文
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }
    
    // 启动ASR
    if (this.asr) {
      try {
        await this.asr.start();
      } catch (error) {
        console.error('❌ Failed to start ASR:', error);
      }
    }
    
    // 启动视频帧处理循环
    this.startVideoFrameLoop();
    
    console.log('🎥 WebRTC Media capture started');
  }

  /**
   * 真实视频帧处理循环
   */
  private startVideoFrameLoop(): void {
    if (!this.isCapturing || !this.videoWorker || !this.externalVideoElement) return;

    let lastFrameTime = 0;
    const frameInterval = 1000 / this.frameProcessingRate; // ms per frame

    const processFrame = (currentTime: number) => {
      if (!this.isCapturing || !this.videoWorker || !this.externalVideoElement) return;

      // 只在 Worker 准备就绪时处理帧
      if (this.videoWorkerReady && currentTime - lastFrameTime >= frameInterval) {
        this.captureAndProcessFrame();
        lastFrameTime = currentTime;
      }

      // 下一帧
      this.animationFrame = requestAnimationFrame(processFrame);
    };

    this.animationFrame = requestAnimationFrame(processFrame);
  }

  /**
   * 捕获并处理当前视频帧
   */
  private captureAndProcessFrame(): void {
    if (!this.externalVideoElement || !this.videoCanvasContext || !this.videoCanvas) return;
    
    const video = this.externalVideoElement;
    
    // 检查视频是否准备就绪
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }
    
    try {
      // 绘制当前视频帧到画布
      this.videoCanvasContext.drawImage(video, 0, 0, this.videoCanvas.width, this.videoCanvas.height);
      
      // 获取图像数据
      const imageData = this.videoCanvasContext.getImageData(0, 0, this.videoCanvas.width, this.videoCanvas.height);
      
      // 发送帧数据到 Worker 处理
      this.videoWorker?.postMessage({
        type: 'process-frame',
        data: {
          imageData,
          timestamp: performance.now()
        }
      });
    } catch (error) {
      console.warn('⚠️ Frame capture failed:', error);
    }
  }

  /**
   * 停止采集
   */
  stopCapture(): void {
    this.isCapturing = false;
    
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    
    if (this.asr) {
      this.asr.stop();
    }
    
    console.log('⏹️ WebRTC Media capture stopped');
  }

  /**
   * 设置外部视频元素（用于预览）
   */
  setExternalVideoElement(videoElement: HTMLVideoElement): void {
    this.externalVideoElement = videoElement;
  }
  
  /**
   * 获取预览元素
   */
  getPreviewElement(): HTMLVideoElement | null {
    return this.externalVideoElement;
  }

  /**
   * 获取媒体流
   */
  getStream(): MediaStream | null {
    return this.localStream;
  }

  /**
   * 获取媒体流状态
   */
  getStatus() {
    return {
      isCapturing: this.isCapturing,
      hasVideo: !!this.localStream?.getVideoTracks().length,
      hasAudio: !!this.localStream?.getAudioTracks().length,
      audioContextState: this.audioContext?.state,
      webrtcConnectionState: this.peerConnection?.connectionState
    };
  }

  /**
   * 创建详细错误信息
   */
  private createDetailedError(error: unknown): Error {
    // Type guard for error-like objects
    const errorObj = error as { name?: string; message?: string };
    
    if (errorObj.name === 'NotAllowedError') {
      return new Error('摄像头/麦克风权限被拒绝。请允许访问并刷新页面。');
    } else if (errorObj.name === 'NotFoundError') {
      return new Error('未找到摄像头或麦克风设备。');
    } else if (errorObj.name === 'NotReadableError') {
      return new Error('设备被其他应用程序占用。');
    } else if (errorObj.message?.includes('MediaDevices API not available') || 
               errorObj.message?.includes('mediaDevices not available') ||
               errorObj.message?.includes('requires HTTPS')) {
      return new Error('需要 HTTPS 连接才能访问摄像头和麦克风。请使用 "npm run https-dev" 启动 HTTPS 开发服务器，或访问 https://localhost:5174');
    } else if (errorObj.message?.includes('Navigator not available')) {
      return new Error('浏览器环境不可用。请确保在现代浏览器中运行此应用程序。');
    } else if (errorObj.message?.includes('enumerateDevices') || errorObj.message?.includes('undefined')) {
      return new Error('无法检测媒体设备。请确保使用 HTTPS 连接，或在 localhost 环境下运行。建议使用 "npm run https-dev"。');
    }
    
    // If it's already an Error, return it; otherwise create a new Error
    return error instanceof Error ? error : new Error(String(error));
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.stopCapture();
    
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }
    
    if (this.peerConnection) {
      this.peerConnection.close();
    }
    
    if (this.audioContext) {
      this.audioContext.close();
    }
    
    if (this.videoWorker) {
      this.videoWorker.terminate();
    }
  }
}

/**
 * WebRTC设备管理器
 */
class RTCDeviceManager {
  async enumerateDevices() {
    try {
      // 更强壮的检查顺序
      if (typeof navigator === 'undefined') {
        throw new Error('Navigator not available in this environment');
      }
      
      if (!navigator.mediaDevices) {
        throw new Error('mediaDevices not available - requires HTTPS or localhost');
      }
      
      if (typeof navigator.mediaDevices.enumerateDevices !== 'function') {
        throw new Error('enumerateDevices method not supported in this browser');
      }
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      return {
        videoInputs: devices.filter(d => d.kind === 'videoinput'),
        audioInputs: devices.filter(d => d.kind === 'audioinput'),
        audioOutputs: devices.filter(d => d.kind === 'audiooutput')
      };
    } catch (error) {
      console.error('❌ Device enumeration failed:', error);
      // 返回空设备列表，让应用继续运行
      return {
        videoInputs: [],
        audioInputs: [],
        audioOutputs: []
      };
    }
  }
}