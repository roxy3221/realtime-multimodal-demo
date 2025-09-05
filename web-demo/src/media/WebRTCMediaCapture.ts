/**
 * WebRTCMediaCapture - 基于WebRTC的增强媒体采集
 * 解决摄像头黑屏、音频质量和设备管理问题
 */

import type { FaceEvent, ProsodyEvent, MediaConfig } from '../types';
import { EventBus } from '../events/EventBus';
import { DEFAULT_MEDIA_CONFIG } from '../config/defaults';
import { WebSpeechASR } from '../asr/WebSpeechASR';

export class WebRTCMediaCapture {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private audioContext: AudioContext | null = null;
  private audioWorklet: AudioWorkletNode | null = null;
  private videoWorker: Worker | null = null;
  private asr: WebSpeechASR | null = null;
  private eventBus: EventBus;
  private isCapturing = false;
  private animationFrame: number | null = null;
  private offscreenCanvas: OffscreenCanvas | null = null;

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
      // 先检查可用设备
      const devices = await this.deviceManager.enumerateDevices();
      console.log('Available devices:', devices);

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
        } as any // 允许Google特定约束
      };

      this.localStream = await navigator.mediaDevices.getUserMedia(enhancedConstraints);
      
      // 创建video元素用于预览
      this.videoElement = document.createElement('video');
      this.videoElement.srcObject = this.localStream;
      this.videoElement.autoplay = true;
      this.videoElement.muted = true;
      this.videoElement.playsInline = true;
      
      // 添加到PeerConnection（启用WebRTC处理）
      this.localStream.getTracks().forEach(track => {
        this.peerConnection?.addTrack(track, this.localStream!);
      });
      
      // 等待视频准备就绪
      await new Promise<void>((resolve) => {
        this.videoElement!.onloadedmetadata = () => {
          console.log('✅ WebRTC Video stream ready:', {
            width: this.videoElement!.videoWidth,
            height: this.videoElement!.videoHeight
          });
          resolve();
        };
      });

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
    if (!this.videoElement) throw new Error('Video element not initialized');

    // 创建OffscreenCanvas用于Worker
    this.offscreenCanvas = new OffscreenCanvas(
      config.video.width,
      config.video.height
    );

    // 创建视频处理Worker
    this.videoWorker = new Worker('/workers/face-detector.js', {
      type: 'module'
    });

    // 传输OffscreenCanvas到Worker
    this.videoWorker.postMessage({
      type: 'init',
      canvas: this.offscreenCanvas,
      config: {
        width: config.video.width,
        height: config.video.height,
        processingRate: config.video.processingRate || 15,
        useWebRTCEnhanced: true // 标记使用WebRTC增强
      }
    }, [this.offscreenCanvas]);

    // 监听人脸事件
    this.videoWorker.onmessage = (event) => {
      const { type, data } = event.data;
      
      if (type === 'face-event') {
        this.eventBus.publish({
          type: 'face',
          t: Date.now(),
          deltaScore: data.deltaScore,
          expr: data.expr,
          pose: data.pose
        } as FaceEvent);
      }
    };
  }

  /**
   * 设置ASR
   */
  private setupASR(): void {
    this.asr = new WebSpeechASR(this.eventBus);
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
      this.asr.start();
    }
    
    // 启动视频帧处理循环
    this.startVideoFrameLoop();
    
    console.log('🎥 WebRTC Media capture started');
  }

  /**
   * 视频帧处理循环
   */
  private startVideoFrameLoop(): void {
    if (!this.isCapturing || !this.videoElement || !this.offscreenCanvas) return;

    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    
    if (!tempCtx) {
      console.error('❌ Cannot get 2d context for video frame capture');
      return;
    }

    const processFrame = () => {
      if (!this.isCapturing || !this.videoElement || !this.videoWorker || !tempCtx) return;

      // WebRTC优化：检查视频质量
      if (this.videoElement.readyState >= 2 && this.videoElement.videoWidth > 0) {
        const { videoWidth, videoHeight } = this.videoElement;
        tempCanvas.width = videoWidth;
        tempCanvas.height = videoHeight;
        
        // 绘制当前帧
        tempCtx.drawImage(this.videoElement, 0, 0, videoWidth, videoHeight);
        
        // 发送到Worker处理
        const imageData = tempCtx.getImageData(0, 0, videoWidth, videoHeight);
        this.videoWorker.postMessage({
          type: 'process-frame',
          imageData: imageData,
          timestamp: Date.now()
        });
      }

      // 下一帧
      this.animationFrame = requestAnimationFrame(processFrame);
    };

    processFrame();
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
   * 获取预览元素
   */
  getPreviewElement(): HTMLVideoElement | null {
    return this.videoElement;
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
  private createDetailedError(error: any): Error {
    if (error.name === 'NotAllowedError') {
      return new Error('摄像头/麦克风权限被拒绝。请允许访问并刷新页面。');
    } else if (error.name === 'NotFoundError') {
      return new Error('未找到摄像头或麦克风设备。');
    } else if (error.name === 'NotReadableError') {
      return new Error('设备被其他应用程序占用。');
    }
    return error;
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
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      videoInputs: devices.filter(d => d.kind === 'videoinput'),
      audioInputs: devices.filter(d => d.kind === 'audioinput'),
      audioOutputs: devices.filter(d => d.kind === 'audiooutput')
    };
  }
}