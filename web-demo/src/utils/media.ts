/**
 * 媒体处理工具函数
 * 处理音频/视频流的获取、转换和基础处理
 */

import type { MediaConfig } from '../types';
import { DEFAULT_MEDIA_CONFIG } from '../config/defaults';

/**
 * 获取用户媒体流
 */
export async function getUserMedia(
  config: Partial<MediaConfig> = {}
): Promise<MediaStream> {
  const finalConfig = {
    ...DEFAULT_MEDIA_CONFIG,
    ...config
  };

  try {
    const constraints: MediaStreamConstraints = {
      video: {
        width: { ideal: finalConfig.video.width },
        height: { ideal: finalConfig.video.height },
        frameRate: { ideal: finalConfig.video.frameRate },
        facingMode: finalConfig.video.facingMode
      },
      audio: {
        sampleRate: { ideal: finalConfig.audio.sampleRate },
        channelCount: { exact: finalConfig.audio.channelCount },
        echoCancellation: finalConfig.audio.echoCancellation,
        noiseSuppression: finalConfig.audio.noiseSuppression
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('✅ MediaStream acquired:', {
      video: stream.getVideoTracks().length > 0,
      audio: stream.getAudioTracks().length > 0
    });

    return stream;
  } catch (error) {
    console.error('❌ Failed to get user media:', error);
    throw new Error(`Media access denied: ${error}`);
  }
}

/**
 * 检查浏览器支持情况
 */
export function checkBrowserSupport(): {
  webrtc: boolean;
  mediaDevices: boolean;
  audioWorklet: boolean;
  broadcastChannel: boolean;
  webWorkers: boolean;
  wasm: boolean;
} {
  const support = {
    webrtc: 'RTCPeerConnection' in window,
    mediaDevices: 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices,
    audioWorklet: 'AudioWorklet' in window,
    broadcastChannel: 'BroadcastChannel' in window,
    webWorkers: 'Worker' in window,
    wasm: 'WebAssembly' in window,
  };
  
  // 临时放宽检查 - 让用户先看到界面
  console.log('🔍 Browser support check:', support);
  console.log('📝 Note: Some features may require HTTPS for full functionality');
  
  return support;
}

/**
 * VideoFrame到ImageData转换
 */
export function videoFrameToImageData(
  video: HTMLVideoElement,
  canvas?: HTMLCanvasElement
): ImageData {
  const canvasElement = canvas || document.createElement('canvas');
  const ctx = canvasElement.getContext('2d')!;
  
  canvasElement.width = video.videoWidth || 640;
  canvasElement.height = video.videoHeight || 480;
  
  ctx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
  
  return ctx.getImageData(0, 0, canvasElement.width, canvasElement.height);
}

/**
 * VideoFrame到OffscreenCanvas转换（用于Worker）
 */
export function videoFrameToOffscreenCanvas(
  video: HTMLVideoElement,
  offscreenCanvas?: OffscreenCanvas
): OffscreenCanvas {
  const canvas = offscreenCanvas || new OffscreenCanvas(
    video.videoWidth || 640,
    video.videoHeight || 480
  );
  
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  return canvas;
}

/**
 * 音频缓冲区重采样（如果需要）
 */
export function resampleAudioBuffer(
  inputBuffer: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array {
  if (inputSampleRate === outputSampleRate) {
    return inputBuffer;
  }
  
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(inputBuffer.length / ratio);
  const outputBuffer = new Float32Array(outputLength);
  
  for (let i = 0; i < outputLength; i++) {
    const inputIndex = i * ratio;
    const inputIndexFloor = Math.floor(inputIndex);
    const inputIndexCeil = Math.min(inputIndexFloor + 1, inputBuffer.length - 1);
    const fraction = inputIndex - inputIndexFloor;
    
    // 线性插值
    outputBuffer[i] = inputBuffer[inputIndexFloor] * (1 - fraction) + 
                      inputBuffer[inputIndexCeil] * fraction;
  }
  
  return outputBuffer;
}

/**
 * PCM数据转换为Web Audio API格式
 */
export function pcmToFloat32Array(
  pcmData: ArrayBuffer,
  bitDepth: 16 | 24 | 32 = 16
): Float32Array {
  let samples: Float32Array;
  
  switch (bitDepth) {
    case 16:
      const int16Array = new Int16Array(pcmData);
      samples = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        samples[i] = int16Array[i] / 32768.0; // 归一化到 [-1, 1]
      }
      break;
    case 24:
      // 24-bit处理稍复杂，简化实现
      const uint8Array = new Uint8Array(pcmData);
      samples = new Float32Array(uint8Array.length / 3);
      for (let i = 0, j = 0; i < uint8Array.length; i += 3, j++) {
        const sample = (uint8Array[i] | (uint8Array[i + 1] << 8) | (uint8Array[i + 2] << 16));
        samples[j] = (sample > 0x7FFFFF ? sample - 0x1000000 : sample) / 8388608.0;
      }
      break;
    case 32:
      samples = new Float32Array(pcmData);
      break;
    default:
      throw new Error(`Unsupported bit depth: ${bitDepth}`);
  }
  
  return samples;
}

/**
 * 媒体流管理器
 */
export class MediaStreamManager {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;

  async initialize(config?: Partial<MediaConfig>): Promise<MediaStream> {
    if (this.stream) {
      this.dispose();
    }

    this.stream = await getUserMedia(config);
    return this.stream;
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  getVideoElement(): HTMLVideoElement {
    if (!this.videoElement) {
      this.videoElement = document.createElement('video');
      this.videoElement.autoplay = true;
      this.videoElement.muted = true;
      this.videoElement.playsInline = true;
      
      if (this.stream) {
        this.videoElement.srcObject = this.stream;
      }
    }
    
    return this.videoElement;
  }

  getAudioTrack(): MediaStreamTrack | null {
    return this.stream?.getAudioTracks()[0] || null;
  }

  getVideoTrack(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] || null;
  }

  dispose(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }
  }
}