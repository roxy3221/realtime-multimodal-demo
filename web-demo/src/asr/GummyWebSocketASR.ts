/**
 * 阿里云DashScope Gummy实时语音识别WebSocket实现
 * 基于阿里云百炼平台的Gummy模型，支持实时语音识别和翻译
 */

import type { ASREvent } from '../types';
import type { EventBus } from '../events/EventBus';

interface GummyASRConfig {
  apiKey: string;
  model?: string;
  sampleRate?: number;
  format?: string;
  sourceLanguage?: string;
  transcriptionEnabled?: boolean;
  translationEnabled?: boolean;
  translationTargetLanguages?: string[];
  maxEndSilence?: number;
  vocabularyId?: string;
}

interface TranscriptionResult {
  sentence_id: number;
  begin_time: number;
  end_time: number;
  text: string;
  words: Array<{
    beginTime: number;
    endTime: number;
    text: string;
  }>;
  is_sentence_end: boolean;
}

interface TranslationResult {
  is_sentence_end: boolean;
  translations: Record<string, {
    sentence_id: number;
    language: string;
    begin_time: number;
    end_time: number;
    text: string;
    words: Array<{
      beginTime: number;
      endTime: number;
      text: string;
    }>;
    is_sentence_end: boolean;
  }>;
}

interface GummyResponse {
  header: {
    event: string;
    request_id: string;
    task_id: string;
  };
  payload: {
    transcription_result?: TranscriptionResult;
    translation_result?: TranslationResult;
    usage?: any;
  };
}

export class GummyWebSocketASR {
  private websocket: WebSocket | null = null;
  private eventBus: EventBus;
  private config: GummyASRConfig;
  private isActive = false;
  private currentTranscript = '';
  private taskId = '';
  private requestId = '';
  private audioContext: AudioContext | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  
  // 语速计算
  private wordHistory: Array<{word: string, time: number}> = [];
  private readonly WPM_WINDOW_MS = 5000;

  constructor(eventBus: EventBus, config: GummyASRConfig) {
    this.eventBus = eventBus;
    this.config = {
      model: 'gummy-realtime-v1',
      sampleRate: 16000,
      format: 'pcm',
      sourceLanguage: 'auto',
      transcriptionEnabled: true,
      translationEnabled: false,
      translationTargetLanguages: ['en'],
      maxEndSilence: 800,
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
      console.warn('⚠️ Gummy ASR already active');
      return true;
    }

    try {
      console.log('🎤 Starting Gummy WebSocket ASR...');
      
      // 生成任务ID和请求ID
      this.taskId = this.generateUUID();
      this.requestId = this.generateUUID();
      
      // 建立WebSocket连接
      await this.connectWebSocket();
      
      // 设置音频采集
      await this.setupAudioCapture();
      
      // 发送任务启动指令
      await this.sendRunTask();
      
      this.isActive = true;
      
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta: '[Gummy ASR已启动，等待语音输入...]',
        isFinal: false,
        currentWPM: 0
      } as ASREvent);
      
      console.log('✅ Gummy ASR started successfully');
      return true;
      
    } catch (error) {
      console.error('❌ Failed to start Gummy ASR:', error);
      
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta: `[Gummy ASR启动失败: ${error instanceof Error ? error.message : '未知错误'}]`,
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
      // 使用代理服务器URL而不是直连阿里云
      const proxyUrl = import.meta.env.VITE_ALI_ASR_PROXY_URL;
      if (!proxyUrl) {
        reject(new Error('VITE_ALI_ASR_PROXY_URL environment variable not configured'));
        return;
      }
      
      console.log('🔗 Connecting to Ali ASR proxy:', proxyUrl);
      this.websocket = new WebSocket(proxyUrl);
      
      this.websocket.onopen = () => {
        console.log('✅ WebSocket connected to Ali ASR proxy');
        resolve();
      };
      
      this.websocket.onmessage = (event) => {
        this.handleWebSocketMessage(event);
      };
      
      this.websocket.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        reject(new Error('WebSocket connection failed - check proxy server'));
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
      const response: GummyResponse = JSON.parse(event.data);
      const { header, payload } = response;
      
      switch (header.event) {
        case 'task-started':
          console.log('🎤 Task started, task_id:', header.task_id);
          break;
          
        case 'result-generated':
          this.handleResult(payload);
          break;
          
        case 'task-finished':
          console.log('✅ Task finished');
          break;
          
        case 'task-failed':
          console.error('❌ Task failed:', payload);
          this.handleError(payload);
          break;
          
        default:
          console.log('📨 Unknown event:', header.event);
      }
      
    } catch (error) {
      console.error('❌ Error parsing WebSocket message:', error);
    }
  }

  /**
   * 处理识别结果
   */
  private handleResult(payload: any): void {
    const { transcription_result, translation_result } = payload;
    
    // 处理转录结果
    if (transcription_result && this.config.transcriptionEnabled) {
      this.handleTranscriptionResult(transcription_result);
    }
    
    // 处理翻译结果
    if (translation_result && this.config.translationEnabled) {
      this.handleTranslationResult(translation_result);
    }
  }

  /**
   * 处理转录结果
   */
  private handleTranscriptionResult(result: TranscriptionResult): void {
    if (result.text && result.text.trim()) {
      // 处理词信息用于WPM计算
      if (result.words && Array.isArray(result.words)) {
        result.words.forEach((word) => {
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
      
      // 发送ASR事件
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta: result.is_sentence_end ? result.text + ' ' : result.text,
        isFinal: result.is_sentence_end,
        currentWPM: this.getCurrentWPM(),
        confidence: 0.9,
        words: result.words?.map(word => ({
          w: word.text,
          s: word.beginTime,
          e: word.endTime,
          confidence: 0.9
        }))
      } as ASREvent);
      
      const logType = result.is_sentence_end ? 'Final' : 'Partial';
      console.log(`📝 ${logType} transcription:`, result.text);
    }
  }

  /**
   * 处理翻译结果
   */
  private handleTranslationResult(result: TranslationResult): void {
    if (result.translations) {
      Object.values(result.translations).forEach(translation => {
        if (translation.text && translation.text.trim()) {
          this.eventBus.publish({
            type: 'asr',
            t: Date.now(),
            textDelta: `[${translation.language}] ${translation.text}${translation.is_sentence_end ? ' ' : ''}`,
            isFinal: translation.is_sentence_end,
            currentWPM: this.getCurrentWPM(),
            confidence: 0.8,
            words: translation.words?.map(word => ({
              w: word.text,
              s: word.beginTime,
              e: word.endTime,
              confidence: 0.8
            }))
          } as ASREvent);
          
          const logType = translation.is_sentence_end ? 'Final' : 'Partial';
          console.log(`🌐 ${logType} translation [${translation.language}]:`, translation.text);
        }
      });
    }
  }

  /**
   * 处理错误
   */
  private handleError(payload: any): void {
    const errorMessage = payload.message || '未知错误';
    
    this.eventBus.publish({
      type: 'asr',
      t: Date.now(),
      textDelta: `[Gummy ASR错误: ${errorMessage}]`,
      isFinal: true,
      currentWPM: 0
    } as ASREvent);
  }

  /**
   * 设置音频采集
   */
  private async setupAudioCapture(): Promise<void> {
    try {
      // 获取麦克风权限
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      // 创建AudioContext
      this.audioContext = new AudioContext({ 
        sampleRate: this.config.sampleRate 
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
          this.sendAudioData(pcmData);
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
   * 发送任务启动指令
   */
  private sendRunTask(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const message = {
        header: {
          action: 'run-task',
          request_id: this.requestId,
          task_id: this.taskId,
          // API密钥由代理服务器添加，前端不需要发送
          'data-inspection': 'enable'
        },
        payload: {
          model: this.config.model,
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          parameters: {
            sample_rate: this.config.sampleRate,
            format: this.config.format,
            source_language: this.config.sourceLanguage,
            transcription_enabled: this.config.transcriptionEnabled,
            translation_enabled: this.config.translationEnabled,
            translation_target_languages: this.config.translationTargetLanguages,
            max_end_silence: this.config.maxEndSilence,
            ...(this.config.vocabularyId && { vocabulary_id: this.config.vocabularyId })
          }
        }
      };

      this.websocket.send(JSON.stringify(message));
      
      // 等待task-started事件
      setTimeout(() => resolve(), 1000);
      setTimeout(() => reject(new Error('Run task timeout')), 10000);
    });
  }

  /**
   * 发送音频数据
   */
  private sendAudioData(audioData: ArrayBuffer): void {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      header: {
        action: 'send-audio',
        request_id: this.requestId,
        task_id: this.taskId
      },
      payload: {
        audio: Array.from(new Uint8Array(audioData))
      }
    };

    this.websocket.send(JSON.stringify(message));
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
    
    console.log('🛑 Stopping Gummy ASR...');
    
    // 发送任务结束指令
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const stopMessage = {
        header: {
          action: 'finish-task',
          request_id: this.requestId,
          task_id: this.taskId
        }
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
    
    console.log('🧹 Gummy ASR cleaned up');
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