/**
 * MediaCapture - 媒体采集和处理管道
 * 基于事件驱动架构，实现高效的音视频流处理
 */

import type { FaceEvent, ProsodyEvent, MediaConfig } from '../types';
import { EventBus } from '../events/EventBus';
import { DEFAULT_MEDIA_CONFIG } from '../config/defaults';
import { WebSpeechASR } from '../asr/WebSpeechASR';

export class MediaCapture {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private audioContext: AudioContext | null = null;
  private audioWorklet: AudioWorkletNode | null = null;
  private videoWorker: Worker | null = null;
  private asr: WebSpeechASR | null = null;
  private eventBus: EventBus;
  private isCapturing = false;
  private animationFrame: number | null = null;
  private offscreenCanvas: OffscreenCanvas | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * 初始化媒体采集
   */
  async initialize(config: Partial<MediaConfig> = {}): Promise<void> {
    const finalConfig = {
      ...DEFAULT_MEDIA_CONFIG,
      ...config
    };

    try {
      // 1. 获取媒体流
      await this.setupMediaStream(finalConfig);
      
      // 2. 初始化音频处理管道
      await this.setupAudioPipeline(finalConfig);
      
      // 3. 初始化视频处理管道
      await this.setupVideoPipeline(finalConfig);
      
      // 4. 初始化ASR
      this.setupASR();
      
      console.log('✅ MediaCapture initialized successfully');
    } catch (error) {
      console.error('❌ MediaCapture initialization failed:', error);
      throw error;
    }
  }

  /**
   * 设置媒体流
   */
  private async setupMediaStream(config: MediaConfig): Promise<void> {
    const constraints: MediaStreamConstraints = {
      video: {
        width: { ideal: config.video.width },
        height: { ideal: config.video.height },
        frameRate: { ideal: config.video.frameRate },
        facingMode: config.video.facingMode
      },
      audio: {
        sampleRate: { ideal: config.audio.sampleRate },
        channelCount: { exact: config.audio.channelCount },
        echoCancellation: config.audio.echoCancellation,
        noiseSuppression: config.audio.noiseSuppression
      }
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    
    // 创建video元素用于预览和帧提取
    this.videoElement = document.createElement('video');
    this.videoElement.srcObject = this.stream;
    this.videoElement.autoplay = true;
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;
    
    // 等待视频准备就绪
    await new Promise<void>((resolve) => {
      this.videoElement!.onloadedmetadata = () => resolve();
    });
  }

  /**
   * 设置音频处理管道
   */
  private async setupAudioPipeline(config: MediaConfig): Promise<void> {
    if (!this.stream) throw new Error('Stream not initialized');

    const audioTrack = this.stream.getAudioTracks()[0];
    if (!audioTrack) {
      console.warn('⚠️ No audio track available');
      return;
    }

    // 创建AudioContext
    this.audioContext = new AudioContext({
      sampleRate: config.audio.sampleRate
    });

    // 加载AudioWorklet处理器
    await this.audioContext.audioWorklet.addModule('/workers/audio-processor.js');
    
    // 创建媒体源和处理节点
    const source = this.audioContext.createMediaStreamSource(this.stream);
    
    this.audioWorklet = new AudioWorkletNode(this.audioContext, 'audio-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: config.audio.channelCount,
      processorOptions: {
        sampleRate: config.audio.sampleRate,
        windowSize: config.audio.windowSize || 1024
      }
    });

    // 监听韵律事件
    this.audioWorklet.port.onmessage = (event) => {
      const { type, data } = event.data;
      
      switch (type) {
        case 'prosody-event':
          this.eventBus.publish({
            type: 'prosody',
            t: Date.now(),
            deltaScore: data.deltaScore,
            rms: data.rms,
            f0: data.f0,
            wpm: data.wpm || 0
          } as ProsodyEvent);
          break;
        
        case 'vad-change':
          // VAD状态变化，可用于ASR控制
          // 暂时只记录日志，不发送事件
          console.log('VAD状态变化:', data);
          break;
      }
    };

    // 连接音频管道
    source.connect(this.audioWorklet);
  }

  /**
   * 创建传统Worker，使用Blob URL方式解决importScripts问题
   */
  private createTraditionalWorker(): Worker {
    const workerCode = `
      // 传统Worker代码，支持importScripts
      importScripts('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest');
      
      let faceLandmarker = null;
      let isInitialized = false;
      let canvas = null;
      let ctx = null;
      
      // 初始化MediaPipe Face Landmarker
      const initializeFaceLandmarker = async () => {
        try {
          const { FilesetResolver, FaceLandmarker } = self;
          
          const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
          );
          
          faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
              delegate: "GPU"
            },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true
          });
          
          isInitialized = true;
          self.postMessage({ type: 'ready' });
        } catch (error) {
          console.error('FaceLandmarker initialization failed:', error);
          self.postMessage({ 
            type: 'error', 
            error: error.message || 'Failed to initialize face detection' 
          });
        }
      };
      
      // 处理视频帧
      const processFrame = (imageData, timestamp, videoWidth, videoHeight) => {
        if (!isInitialized || !faceLandmarker) {
          return;
        }
        
        try {
          // 如果canvas尺寸发生变化，需要重新创建
          if (!canvas || canvas.width !== videoWidth || canvas.height !== videoHeight) {
            canvas = new OffscreenCanvas(videoWidth, videoHeight);
            ctx = canvas.getContext('2d');
          }
          
          // 将ImageData绘制到canvas
          ctx.putImageData(imageData, 0, 0);
          
          // MediaPipe处理
          const results = faceLandmarker.detectForVideo(canvas, timestamp);
          
          if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            // 提取第一个人脸的数据
            const landmarks = results.faceLandmarks[0];
            const blendshapes = results.faceBlendshapes && results.faceBlendshapes.length > 0
              ? results.faceBlendshapes[0]
              : null;
            
            // 计算基本表情分数
            const expr = {};
            if (blendshapes && blendshapes.categories) {
              blendshapes.categories.forEach(category => {
                expr[category.categoryName] = category.score;
              });
            }
            
            // 简单的姿态估计 (基于关键点)
            const pose = calculateSimplePose(landmarks);
            
            // 计算变化分数 (简化版本)
            const deltaScore = calculateDeltaScore(expr, pose, timestamp);
            
            // 如果变化显著，发送事件
            if (deltaScore > 0.3) {
              self.postMessage({
                type: 'face-event',
                data: {
                  deltaScore,
                  expr,
                  pose,
                  timestamp,
                  landmarks: landmarks.slice(0, 10) // 只发送前10个关键点减少数据量
                }
              });
            }
          }
        } catch (error) {
          console.error('Frame processing error:', error);
        }
      };
      
      // 简单的姿态计算
      const calculateSimplePose = (landmarks) => {
        // 使用关键点计算简单的头部姿态
        // 这里是简化版本，实际项目中应该使用更准确的算法
        const nose = landmarks[1];
        const leftEye = landmarks[33];
        const rightEye = landmarks[362];
        
        // 计算Roll角度
        const eyeDiff = {
          x: rightEye.x - leftEye.x,
          y: rightEye.y - leftEye.y
        };
        const roll = Math.atan2(eyeDiff.y, eyeDiff.x) * (180 / Math.PI);
        
        return {
          yaw: 0,   // 简化为0，实际需要更复杂计算
          pitch: 0, // 简化为0，实际需要更复杂计算
          roll: roll
        };
      };
      
      // 变化分数计算 (简化版本)
      let lastExpr = {};
      let lastPose = { yaw: 0, pitch: 0, roll: 0 };
      let lastTimestamp = 0;
      
      const calculateDeltaScore = (expr, pose, timestamp) => {
        if (timestamp - lastTimestamp < 100) { // 限制频率
          return 0;
        }
        
        let exprDelta = 0;
        let poseDelta = 0;
        
        // 表情变化
        Object.keys(expr).forEach(key => {
          const curr = expr[key] || 0;
          const prev = lastExpr[key] || 0;
          exprDelta += Math.abs(curr - prev);
        });
        
        // 姿态变化
        poseDelta = Math.abs(pose.roll - lastPose.roll) / 90; // 归一化到0-1
        
        // 更新历史
        lastExpr = { ...expr };
        lastPose = { ...pose };
        lastTimestamp = timestamp;
        
        return Math.min(exprDelta + poseDelta, 1.0);
      };
      
      // 消息处理
      self.onmessage = async (event) => {
        const { type, data } = event.data;
        
        switch (type) {
          case 'init':
            await initializeFaceLandmarker();
            break;
            
          case 'process-frame':
            if (data.imageData) {
              processFrame(
                data.imageData, 
                data.timestamp, 
                data.videoWidth, 
                data.videoHeight
              );
            }
            break;
            
          case 'destroy':
            // 清理资源
            faceLandmarker = null;
            isInitialized = false;
            canvas = null;
            ctx = null;
            break;
            
          default:
            console.warn('Unknown message type:', type);
        }
      };
    `;
    
    // 创建Blob URL
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    
    // 创建传统Worker
    const worker = new Worker(workerUrl);
    
    // 清理URL (可选，避免内存泄漏)
    worker.addEventListener('error', () => {
      URL.revokeObjectURL(workerUrl);
    });
    
    return worker;
  }

  /**
   * 设置视频处理管道
   */
  private async setupVideoPipeline(_config: MediaConfig): Promise<void> {
    if (!this.videoElement) throw new Error('Video element not initialized');

    // 创建传统Worker而不是模块Worker
    this.videoWorker = this.createTraditionalWorker();

    // 初始化Worker
    this.videoWorker.postMessage({
      type: 'init'
    });

    // 监听Worker消息
    this.videoWorker.onmessage = (event) => {
      const { type, data } = event.data;
      
      switch (type) {
        case 'ready':
          console.log('✅ Face detection worker ready');
          break;
          
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
          
        case 'error':
          console.error('❌ Face detection worker error:', data.error);
          break;
      }
    };

    this.videoWorker.onerror = (error) => {
      console.error('❌ Face detection worker error:', error);
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
    
    console.log('🎥 Media capture started');
  }

  /**
   * 视频帧处理循环
   */
  private startVideoFrameLoop(): void {
    if (!this.isCapturing || !this.videoElement || !this.offscreenCanvas) return;

    // 创建主线程canvas用于帧捕获
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    
    if (!tempCtx) {
      console.error('❌ Cannot get 2d context for video frame capture');
      return;
    }

    const processFrame = () => {
      if (!this.isCapturing || !this.videoElement || !this.videoWorker || !tempCtx) return;

      // 检查视频是否有新帧
      if (this.videoElement.readyState >= 2 && this.videoElement.videoWidth > 0) {
        const { videoWidth, videoHeight } = this.videoElement;
        
        // 调整临时canvas大小
        if (tempCanvas.width !== videoWidth || tempCanvas.height !== videoHeight) {
          tempCanvas.width = videoWidth;
          tempCanvas.height = videoHeight;
        }
        
        // 将视频帧绘制到临时canvas
        tempCtx.drawImage(this.videoElement, 0, 0, videoWidth, videoHeight);
        
        // 获取ImageData
        const imageData = tempCtx.getImageData(0, 0, videoWidth, videoHeight);
        
        // 发送ImageData到Worker处理
        this.videoWorker.postMessage({
          type: 'process-frame',
          timestamp: Date.now(),
          imageData: imageData,
          videoWidth,
          videoHeight
        });
      }

      if (this.isCapturing) {
        this.animationFrame = requestAnimationFrame(processFrame);
      }
    };

    processFrame();
  }

  /**
   * 停止采集
   */
  stopCapture(): void {
    this.isCapturing = false;
    
    // 停止动画帧循环
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    
    // 停止ASR
    if (this.asr) {
      this.asr.stop();
    }
    
    // 暂停音频上下文
    this.audioContext?.suspend();
    
    console.log('⏹️ Media capture stopped');
  }

  /**
   * 获取预览元素
   */
  getPreviewElement(): HTMLVideoElement | null {
    return this.videoElement;
  }

  /**
   * 获取媒体流状态
   */
  getStatus(): {
    isCapturing: boolean;
    hasVideo: boolean;
    hasAudio: boolean;
    audioContextState?: AudioContextState;
  } {
    return {
      isCapturing: this.isCapturing,
      hasVideo: !!this.stream?.getVideoTracks().length,
      hasAudio: !!this.stream?.getAudioTracks().length,
      audioContextState: this.audioContext?.state
    };
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.stopCapture();
    
    // 停止所有媒体轨道
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    
    // 清理音频资源
    this.audioWorklet?.disconnect();
    this.audioContext?.close();
    this.audioContext = null;
    this.audioWorklet = null;
    
    // 清理视频资源
    if (this.videoWorker) {
      this.videoWorker.postMessage({ type: 'destroy' });
      this.videoWorker.terminate();
      this.videoWorker = null;
    }
    
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }
    
    this.offscreenCanvas = null;
    
    console.log('🧹 MediaCapture disposed');
  }
}