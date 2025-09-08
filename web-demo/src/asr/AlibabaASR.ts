/**
 * 阿里云实时语音识别
 * 基于阿里云DashScope API的流式ASR
 */

import type { ASREvent } from '../types';
import type { EventBus } from '../events/EventBus';

// Alibaba ASR API类型定义
interface AlibabaWord {
  text: string;
  begin_time?: number;
  end_time?: number;
}

interface AlibabaSentence {
  text?: string;
  words?: AlibabaWord[];
  is_final?: boolean;
  end_time?: number;
}

interface AlibabaASRConfig {
  apiKey: string;
  model: string;
  sampleRate?: number;
  format?: string;
  enableWordsInfo?: boolean;
}

interface ASRMessage {
  header: {
    action: string;
    streaming: string;
    task_id?: string;
    event?: string;
    attributes?: Record<string, unknown>;
  };
  payload: {
    model: string;
    task: string;
    function_call?: Record<string, unknown>;
    input?: {
      audio?: string;
      sample_rate?: number;
      format?: string;
    };
    parameters?: {
      incremental_output?: boolean;
      enable_words_info?: boolean;
    };
  };
}

interface ASRResponse {
  header: {
    task_id: string;
    event: string;
    streaming: string;
    attributes?: Record<string, unknown>;
  };
  payload: {
    output: {
      sentence: {
        text: string;
        begin_time?: number;
        end_time?: number;
        words?: Array<{
          text: string;
          begin_time: number;
          end_time: number;
        }>;
      };
    };
    usage?: {
      duration: number;
    };
  };
}

export class AlibabaASR {
  private websocket: WebSocket | null = null;
  private eventBus: EventBus;
  private config: AlibabaASRConfig;
  private isActive = false;
  private taskId: string | null = null;
  private currentTranscript = '';
  
  // 语速计算相关
  private wordHistory: Array<{word: string, time: number}> = [];
  private readonly WPM_WINDOW_MS = 5000; // 5秒窗口计算WPM

  constructor(eventBus: EventBus, config: AlibabaASRConfig) {
    this.eventBus = eventBus;
    this.config = {
      sampleRate: 16000,
      format: 'pcm',
      enableWordsInfo: true,
      ...config
    };
  }

  /**
   * 启动语音识别
   */
  async start(): Promise<boolean> {
    if (this.isActive) {
      console.warn('⚠️ ASR already active');
      return false;
    }

    try {
      await this.connectWebSocket();
      await this.sendStartMessage();
      this.isActive = true;
      console.log('🎤 Alibaba ASR started');
      return true;
    } catch (error) {
      console.error('❌ Failed to start Alibaba ASR:', error);
      return false;
    }
  }

  /**
   * 停止语音识别
   */
  stop(): void {
    if (!this.isActive) return;

    this.isActive = false;
    
    if (this.websocket) {
      // 发送结束消息
      this.sendFinishMessage();
      
      setTimeout(() => {
        if (this.websocket) {
          this.websocket.close();
          this.websocket = null;
        }
      }, 100);
    }
    
    this.taskId = null;
    this.currentTranscript = '';
    this.wordHistory = [];
    console.log('🛑 Alibaba ASR stopped');
  }

  /**
   * 发送音频数据
   */
  sendAudio(audioData: ArrayBuffer): void {
    if (!this.isActive || !this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ Cannot send audio: ASR not active or WebSocket not ready', {
        isActive: this.isActive,
        wsReady: this.websocket?.readyState === WebSocket.OPEN,
        taskId: this.taskId
      });
      return;
    }

    try {
      // 将 ArrayBuffer 转换为 base64
      const audioBase64 = this.arrayBufferToBase64(audioData);
      console.log('🎵 Sending audio data, size:', audioData.byteLength, 'bytes, task_id:', this.taskId);
      
      const message: ASRMessage = {
        header: {
          action: 'run-task',
          streaming: 'duplex',
          task_id: this.taskId || undefined
        },
        payload: {
          model: this.config.model,
          task: 'asr',
          input: {
            audio: audioBase64,
            sample_rate: this.config.sampleRate,
            format: this.config.format
          }
        }
      };

      this.websocket.send(JSON.stringify(message));
    } catch (error) {
      console.error('❌ Failed to send audio data:', error);
    }
  }

  /**
   * 连接WebSocket
   */
  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // 构建阿里云ASR WebSocket URL - 使用正确的格式
        const wsUrl = `wss://dashscope.aliyuncs.com/api/v1/services/aigc/asr/realtime-transcription`;
        
        console.log('🔗 Attempting to connect to Alibaba ASR WebSocket...');
        console.log('🔑 API Key:', this.config.apiKey.substring(0, 8) + '***');
        
        // 创建WebSocket连接
        this.websocket = new WebSocket(wsUrl);

        this.websocket.onopen = () => {
          console.log('✅ Alibaba ASR WebSocket connected successfully');
          resolve();
        };

        this.websocket.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.websocket.onerror = (error) => {
          console.error('❌ Alibaba ASR WebSocket error:', error);
          console.error('💡 This may be due to CORS or authentication issues.');
          console.error('💡 Consider using a proxy server or different ASR service.');
          reject(error);
        };

        this.websocket.onclose = (event) => {
          console.log('🔌 Alibaba ASR WebSocket closed:', event.code, event.reason);
          if (event.code === 1006) {
            console.error('💡 Connection failed - this is likely due to CORS policy or missing authentication.');
          }
          if (this.isActive) {
            // 异常关闭时尝试重连
            setTimeout(() => this.reconnect(), 1000);
          }
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 发送开始消息
   */
  private async sendStartMessage(): Promise<void> {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const message: ASRMessage = {
      header: {
        action: 'start-task',
        streaming: 'duplex',
        attributes: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-WorkSpace': 'default'
        }
      },
      payload: {
        model: this.config.model,
        task: 'asr',
        parameters: {
          incremental_output: true,
          enable_words_info: this.config.enableWordsInfo,
          sample_rate: this.config.sampleRate,
          format: this.config.format
        }
      }
    };

    console.log('📤 Sending start message:', message);
    this.websocket.send(JSON.stringify(message));
  }

  /**
   * 发送结束消息
   */
  private sendFinishMessage(): void {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const message: ASRMessage = {
      header: {
        action: 'finish-task',
        streaming: 'duplex',
        task_id: this.taskId || undefined
      },
      payload: {
        model: this.config.model,
        task: 'asr'
      }
    };

    this.websocket.send(JSON.stringify(message));
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(data: string): void {
    try {
      console.log('📥 Received ASR message:', data);
      const response: ASRResponse = JSON.parse(data);
      
      // 保存任务ID
      if (response.header.task_id) {
        this.taskId = response.header.task_id;
        console.log('📋 Task ID saved:', this.taskId);
      }

      // 处理不同类型的事件
      console.log('🎯 Event type:', response.header.event);
      
      if (response.header.event === 'task-started') {
        console.log('✅ ASR task started successfully');
      }
      
      // 处理识别结果
      if (response.header.event === 'result-generated' && response.payload.output?.sentence) {
        console.log('📝 Recognition result:', response.payload.output.sentence);
        this.handleRecognitionResult(response.payload.output.sentence);
      }
      
      // 处理错误
      if (response.header.event === 'task-failed') {
        console.error('❌ ASR task failed:', response);
      }

    } catch (error) {
      console.error('❌ Failed to parse ASR response:', error);
      console.error('📄 Raw data:', data);
    }
  }

  /**
   * 处理识别结果
   */
  private handleRecognitionResult(sentence: AlibabaSentence): void {
    const text = sentence.text?.trim();
    if (!text) return;

    // 判断是否为最终结果
    const isFinal = sentence.end_time !== undefined;
    
    // 计算文本增量
    const textDelta = text.replace(this.currentTranscript, '').trim();
    
    if (textDelta.length > 0) {
      // 处理词级别信息（如果可用）
      if (sentence.words && Array.isArray(sentence.words)) {
        this.processWordsInfo(sentence.words);
      } else if (isFinal) {
        // 没有词级别信息时，简单处理
        this.processNewWords(textDelta);
      }

      // 发送ASR事件
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta,
        isFinal,
        currentWPM: this.getCurrentWPM(),
        words: sentence.words?.map((word: AlibabaWord) => ({
          w: word.text,
          s: word.begin_time || 0,
          e: word.end_time || 0
        }))
      } as ASREvent);

      if (isFinal) {
        this.currentTranscript = text;
      }
    }
  }

  /**
   * 处理词级别信息
   */
  private processWordsInfo(words: AlibabaWord[]): void {
    const now = Date.now();
    
    words.forEach(wordInfo => {
      this.wordHistory.push({ 
        word: wordInfo.text, 
        time: wordInfo.end_time ? now - (Date.now() - wordInfo.end_time) : now // 根据词的结束时间调整
      });
    });
    
    // 清理旧数据
    this.wordHistory = this.wordHistory.filter(
      entry => now - entry.time < this.WPM_WINDOW_MS
    );
  }

  /**
   * 处理新单词（无词级别信息时的回退方案）
   */
  private processNewWords(transcript: string): void {
    if (!transcript || typeof transcript !== 'string') {
      return;
    }
    
    const words = transcript.split(/\s+/).filter(word => word.length > 0);
    const now = Date.now();
    
    words.forEach(word => {
      this.wordHistory.push({ word, time: now });
    });
    
    // 清理旧数据
    this.wordHistory = this.wordHistory.filter(
      entry => now - entry.time < this.WPM_WINDOW_MS
    );
  }

  /**
   * 计算当前语速(WPM)
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
   * 重连WebSocket
   */
  private async reconnect(): Promise<void> {
    if (!this.isActive) return;

    try {
      console.log('🔄 Reconnecting Alibaba ASR...');
      await this.connectWebSocket();
      await this.sendStartMessage();
      console.log('✅ Alibaba ASR reconnected');
    } catch (error) {
      console.error('❌ Failed to reconnect Alibaba ASR:', error);
      // 继续尝试重连
      setTimeout(() => this.reconnect(), 2000);
    }
  }

  /**
   * 将 ArrayBuffer 转换为 base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * 获取状态
   */
  getStatus(): {
    isActive: boolean;
    currentWPM: number;
    transcriptLength: number;
    taskId: string | null;
  } {
    return {
      isActive: this.isActive,
      currentWPM: this.getCurrentWPM(),
      transcriptLength: this.currentTranscript.length,
      taskId: this.taskId
    };
  }
}