/**
 * 阿里云WebSocket实时语音识别实现
 * 基于阿里云智能语音交互WebSocket协议
 */

import type { ASREvent } from '../types';
import type { EventBus } from '../events/EventBus';

interface AlibabaASRConfig {
  token: string;
  appkey: string;
  format?: string;
  sample_rate?: number;
  enable_intermediate_result?: boolean;
  enable_punctuation_prediction?: boolean;
  enable_inverse_text_normalization?: boolean;
  enable_words?: boolean;
}

interface Header {
  message_id: string;
  task_id: string;
  namespace: string;
  name: string;
  appkey: string;
  status?: number;
  status_message?: string;
}

interface StartTranscriptionPayload {
  format: string;
  sample_rate: number;
  enable_intermediate_result: boolean;
  enable_punctuation_prediction: boolean;
  enable_inverse_text_normalization: boolean;
  enable_words: boolean;
}

interface WordInfo {
  text: string;
  startTime: number;
  endTime: number;
}

export class AlibabaWebSocketASR {
  private websocket: WebSocket | null = null;
  private eventBus: EventBus;
  private config: AlibabaASRConfig;
  private isActive = false;
  private currentTranscript = '';
  private taskId = '';
  private audioContext: AudioContext | null = null;
  private mediaStreamSource: MediaStreamSourceNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  
  // 语速计算
  private wordHistory: Array<{word: string, time: number}> = [];
  private readonly WPM_WINDOW_MS = 5000;

  constructor(eventBus: EventBus, config: AlibabaASRConfig) {
    this.eventBus = eventBus;
    this.config = {
      format: 'pcm',
      sample_rate: 16000,
      enable_intermediate_result: true,
      enable_punctuation_prediction: true,
      enable_inverse_text_normalization: true,
      enable_words: true,
      ...config
    };
  }

  /**
   * 生成UUID
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 启动语音识别
   */
  async start(): Promise<boolean> {
    if (this.isActive) {
      console.warn('⚠️ Alibaba ASR already active');
      return true;
    }

    try {
      console.log('🎤 Starting Alibaba WebSocket ASR...');
      
      // 生成任务ID
      this.taskId = this.generateUUID().replace(/-/g, '');
      
      // 建立WebSocket连接
      await this.connectWebSocket();
      
      // 设置音频采集
      await this.setupAudioCapture();
      
      // 发送启动指令
      await this.sendStartTranscription();
      
      this.isActive = true;
      
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta: '[阿里云ASR已启动，等待语音输入...]',
        isFinal: false,
        currentWPM: 0
      } as ASREvent);
      
      console.log('✅ Alibaba ASR started successfully');
      return true;
      
    } catch (error) {
      console.error('❌ Failed to start Alibaba ASR:', error);
      
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta: `[阿里云ASR启动失败: ${error instanceof Error ? error.message : '未知错误'}]`,
        isFinal: true,
        currentWPM: 0
      } as ASREvent);
      
      return false;
    }
  }

  /**
   * 建立WebSocket连接
   */
  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1?token=${this.config.token}`;
      
      this.websocket = new WebSocket(wsUrl);
      
      this.websocket.onopen = () => {
        console.log('✅ WebSocket connected to Alibaba ASR');
        resolve();
      };
      
      this.websocket.onmessage = (event) => {
        this.handleWebSocketMessage(event);
      };
      
      this.websocket.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        reject(new Error('WebSocket connection failed'));
      };
      
      this.websocket.onclose = (event) => {
        console.log('🔌 WebSocket connection closed:', event.code, event.reason);
        if (this.isActive) {
          // 连接意外关闭，尝试重连
          setTimeout(() => {
            if (this.isActive) {
              this.reconnect();
            }
          }, 1000);
        }
      };
    });
  }

  /**
   * 处理WebSocket消息
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);
      const { header, payload } = message;
      
      switch (header.name) {
        case 'TranscriptionStarted':
          console.log('🎤 Transcription started, session_id:', payload.session_id);
          break;
          
        case 'SentenceBegin':
          console.log('📝 Sentence begin:', payload.index);
          break;
          
        case 'TranscriptionResultChanged':
          this.handleIntermediateResult(payload);
          break;
          
        case 'SentenceEnd':
          this.handleFinalResult(payload);
          break;
          
        case 'TranscriptionCompleted':
          console.log('✅ Transcription completed');
          break;
          
        default:
          console.log('📨 Unknown message:', header.name);
      }
      
    } catch (error) {
      console.error('❌ Error parsing WebSocket message:', error);
    }
  }

  /**
   * 处理中间识别结果
   */
  private handleIntermediateResult(payload: any): void {
    if (payload.result && payload.result.trim()) {
      // 发送中间结果
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta: payload.result,
        isFinal: false,
        currentWPM: this.getCurrentWPM(),
        confidence: 0.7
      } as ASREvent);
    }
  }

  /**
   * 处理最终识别结果
   */
  private handleFinalResult(payload: any): void {
    if (payload.result && payload.result.trim()) {
      const result = payload.result.trim();
      
      // 处理词信息用于WPM计算
      if (payload.words && Array.isArray(payload.words)) {
        payload.words.forEach((word: WordInfo) => {
          this.wordHistory.push({ 
            word: word.text, 
            time: Date.now() 
          });
        });
        
        // 清理旧数据
        const now = Date.now();
        this.wordHistory = this.wordHistory.filter(
          entry => now - entry.time < this.WPM_WINDOW_MS
        );
      }
      
      // 发送最终结果
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta: result + ' ',
        isFinal: true,
        currentWPM: this.getCurrentWPM(),
        confidence: payload.confidence || 0.9,
        words: payload.words
      } as ASREvent);
      
      console.log('📝 Final result:', result);
    }
  }

  /**
   * 设置音频采集
   */
  private async setupAudioCapture(): Promise<void> {
    try {
      // 获取麦克风权限
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: this.config.sample_rate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      // 创建AudioContext
      this.audioContext = new AudioContext({ 
        sampleRate: this.config.sample_rate 
      });
      
      // 创建媒体源
      this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.stream);
      
      // 创建ScriptProcessor用于音频处理
      this.scriptProcessor = this.audioContext.createScriptProcessor(1024, 1, 1);
      
      this.scriptProcessor.onaudioprocess = (event) => {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
          const inputBuffer = event.inputBuffer.getChannelData(0);
          
          // 转换为PCM16格式
          const pcmData = this.float32ToPCM16(inputBuffer);
          
          // 发送音频数据
          this.websocket.send(pcmData);
        }
      };
      
      // 连接音频处理链
      this.mediaStreamSource.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);
      
      console.log('✅ Audio capture setup complete');
      
    } catch (error) {
      console.error('❌ Failed to setup audio capture:', error);
      throw error;
    }
  }

  /**
   * Float32转PCM16
   */
  private float32ToPCM16(float32Array: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    
    return buffer;
  }

  /**
   * 发送开始转录指令
   */
  private sendStartTranscription(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const message = {
        header: {
          message_id: this.generateUUID().replace(/-/g, ''),
          task_id: this.taskId,
          namespace: 'SpeechTranscriber',
          name: 'StartTranscription',
          appkey: this.config.appkey
        } as Header,
        payload: {
          format: this.config.format,
          sample_rate: this.config.sample_rate,
          enable_intermediate_result: this.config.enable_intermediate_result,
          enable_punctuation_prediction: this.config.enable_punctuation_prediction,
          enable_inverse_text_normalization: this.config.enable_inverse_text_normalization,
          enable_words: this.config.enable_words
        } as StartTranscriptionPayload
      };

      this.websocket.send(JSON.stringify(message));
      
      // 等待TranscriptionStarted事件
      const checkStarted = () => {
        if (this.isActive) {
          resolve();
        } else {
          setTimeout(checkStarted, 100);
        }
      };
      
      setTimeout(checkStarted, 100);
      setTimeout(() => reject(new Error('Start transcription timeout')), 10000);
    });
  }

  /**
   * 计算当前语速
   */
  private getCurrentWPM(): number {
    const now = Date.now();
    const recentWords = this.wordHistory.filter(
      entry => now - entry.time < this.WPM_WINDOW_MS
    );
    
    if (recentWords.length < 2) return 0;
    
    const timeSpanMs = now - recentWords[0].time;
    const timeSpanMinutes = timeSpanMs / 60000;
    
    return Math.round(recentWords.length / timeSpanMinutes);
  }

  /**
   * 重连
   */
  private async reconnect(): Promise<void> {
    console.log('🔄 Attempting to reconnect...');
    
    try {
      this.cleanup(false);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.start();
    } catch (error) {
      console.error('❌ Reconnection failed:', error);
    }
  }

  /**
   * 停止语音识别
   */
  stop(): void {
    if (!this.isActive) return;
    
    console.log('🛑 Stopping Alibaba ASR...');
    
    // 发送停止指令
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const stopMessage = {
        header: {
          message_id: this.generateUUID().replace(/-/g, ''),
          task_id: this.taskId,
          namespace: 'SpeechTranscriber',
          name: 'StopTranscription',
          appkey: this.config.appkey
        } as Header
      };
      
      this.websocket.send(JSON.stringify(stopMessage));
    }
    
    this.cleanup(true);
  }

  /**
   * 清理资源
   */
  private cleanup(stopFlag: boolean = true): void {
    if (stopFlag) {
      this.isActive = false;
    }
    
    // 断开WebSocket
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    
    // 停止音频处理
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    
    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }
    
    // 停止媒体流
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    // 关闭AudioContext
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    console.log('🧹 Alibaba ASR cleaned up');
  }

  /**
   * 获取状态
   */
  getStatus(): {
    isActive: boolean;
    currentWPM: number;
    transcriptLength: number;
    connectionState: string;
  } {
    return {
      isActive: this.isActive,
      currentWPM: this.getCurrentWPM(),
      transcriptLength: this.currentTranscript.length,
      connectionState: this.websocket ? 
        ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.websocket.readyState] : 
        'DISCONNECTED'
    };
  }
}