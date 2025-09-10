/**
 * RealtimeSTT WebSocket ASR 实现
 * 用于替换 Gummy ASR，基于本地 RealtimeSTT 服务器
 */

import type { ASREvent } from '../types';
import type { EventBus } from '../events/EventBus';

interface RealtimeSTTConfig {
  serverUrl?: string;
  model?: string;
  language?: string;
  sensitivity?: number;
  minRecordingLength?: number;
  postSpeechSilence?: number;
}

interface STTTranscriptionResult {
  sentence_id: number;
  begin_time: number;
  end_time: number;
  text: string;
  words: Array<any>;
  is_sentence_end: boolean;
}

interface STTResponse {
  header: {
    event: string;
    request_id: string;
    task_id: string;
  };
  payload: {
    transcription_result?: STTTranscriptionResult;
    usage?: {
      current_wpm?: number;
    };
    message?: string;
  };
}

export class RealtimeSTTWebSocketASR {
  private websocket: WebSocket | null = null;
  private eventBus: EventBus;
  private config: RealtimeSTTConfig;
  private isActive = false;
  private taskId = '';
  private requestId = '';
  
  // 语速计算
  private wordHistory: Array<{word: string, time: number}> = [];
  private readonly WPM_WINDOW_MS = 5000;

  constructor(eventBus: EventBus, config: RealtimeSTTConfig = {}) {
    this.eventBus = eventBus;
    this.config = {
      serverUrl: 'ws://localhost:8765',
      model: 'tiny.en',
      language: 'zh',
      sensitivity: 0.4,
      minRecordingLength: 0.5,
      postSpeechSilence: 0.7,
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
      console.warn('⚠️ RealtimeSTT ASR already active');
      return true;
    }

    try {
      console.log('🎤 Starting RealtimeSTT WebSocket ASR...');
      
      // 生成任务ID和请求ID
      this.taskId = this.generateUUID();
      this.requestId = this.generateUUID();
      
      // 建立WebSocket连接
      await this.connectWebSocket();
      
      // 发送任务启动指令
      await this.sendRunTask();
      
      this.isActive = true;
      
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta: '[RealtimeSTT ASR已启动，正在监听语音...]',
        isFinal: false,
        currentWPM: 0
      } as ASREvent);
      
      console.log('✅ RealtimeSTT ASR started successfully');
      return true;
      
    } catch (error) {
      console.error('❌ Failed to start RealtimeSTT ASR:', error);
      
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta: `[RealtimeSTT ASR启动失败: ${error instanceof Error ? error.message : '未知错误'}]`,
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
      const serverUrl = this.config.serverUrl || 'ws://localhost:8765';
      
      console.log('🔗 Connecting to RealtimeSTT server:', serverUrl);
      this.websocket = new WebSocket(serverUrl);
      
      // 设置连接超时
      const connectionTimeout = setTimeout(() => {
        if (this.websocket && this.websocket.readyState === WebSocket.CONNECTING) {
          this.websocket.close();
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000);
      
      this.websocket.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('✅ WebSocket connected to RealtimeSTT server');
        
        // 等待proxy-connected消息
        const proxyConnectedHandler = (event: MessageEvent) => {
          try {
            const response = JSON.parse(event.data);
            if (response.header?.event === 'proxy-connected') {
              console.log('🔗 RealtimeSTT server ready');
              this.websocket!.removeEventListener('message', proxyConnectedHandler);
              resolve();
            }
          } catch (error) {
            // 忽略JSON解析错误
          }
        };
        
        if (this.websocket) {
          this.websocket.addEventListener('message', proxyConnectedHandler);
        }
        
        // 5秒超时，认为连接成功
        setTimeout(() => {
          if (this.websocket) {
            this.websocket.removeEventListener('message', proxyConnectedHandler);
            resolve();
          }
        }, 5000);
      };
      
      this.websocket.onmessage = (event) => {
        this.handleWebSocketMessage(event);
      };
      
      this.websocket.onerror = (error) => {
        clearTimeout(connectionTimeout);
        console.error('❌ WebSocket error:', error);
        reject(new Error('WebSocket connection failed - check RealtimeSTT server'));
      };
      
      this.websocket.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log('🔌 WebSocket connection closed:', event.code, event.reason);
        
        if (this.isActive) {
          // 连接意外关闭，尝试重连
          setTimeout(() => {
            if (this.isActive) {
              this.reconnect();
            }
          }, 2000);
        }
      };
    });
  }

  /**
   * 处理WebSocket消息
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    try {
      const response: STTResponse = JSON.parse(event.data);
      const { header, payload } = response;
      
      switch (header.event) {
        case 'proxy-connected':
          console.log('🔗 RealtimeSTT server connected:', payload?.message || 'Connected');
          break;
          
        case 'task-started':
          console.log('🎤 RealtimeSTT task started, task_id:', header.task_id);
          this.eventBus.publish({
            type: 'asr',
            t: Date.now(),
            textDelta: '[RealtimeSTT 开始监听，请说话...]',
            isFinal: false,
            currentWPM: 0
          } as ASREvent);
          break;
          
        case 'recording-started':
          console.log('🎙️ Recording started');
          this.eventBus.publish({
            type: 'asr',
            t: Date.now(),
            textDelta: '[🎙️ 检测到语音，开始录音...]',
            isFinal: false,
            currentWPM: 0
          } as ASREvent);
          break;
          
        case 'recording-stopped':
          console.log('⏹️ Recording stopped');
          break;
          
        case 'result-generated':
          this.handleResult(payload);
          break;
          
        case 'task-finished':
          console.log('✅ RealtimeSTT task finished');
          break;
          
        case 'task-failed':
          console.error('❌ RealtimeSTT task failed:', payload);
          this.handleError(payload);
          break;
          
        case 'server-shutdown':
          console.log('🛑 RealtimeSTT server shutting down');
          this.eventBus.publish({
            type: 'asr',
            t: Date.now(),
            textDelta: '[RealtimeSTT 服务器关闭]',
            isFinal: true,
            currentWPM: 0
          } as ASREvent);
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
    const { transcription_result, usage } = payload;
    
    if (transcription_result && transcription_result.text && transcription_result.text.trim()) {
      const result = transcription_result as STTTranscriptionResult;
      
      // 简单的词计数（适用于英文，中文需要改进）
      const words = result.text.split(/\s+/).filter(word => word.length > 0);
      words.forEach(word => {
        this.wordHistory.push({ 
          word: word, 
          time: Date.now() 
        });
      });
      
      // 清理旧数据
      const now = Date.now();
      this.wordHistory = this.wordHistory.filter(
        entry => now - entry.time < this.WPM_WINDOW_MS
      );
      
      // 获取当前WPM（优先使用服务器计算的值）
      const currentWPM = usage?.current_wpm || this.getCurrentWPM();
      
      // 发送ASR事件
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta: result.text + (result.is_sentence_end ? ' ' : ''),
        isFinal: result.is_sentence_end,
        currentWPM: currentWPM,
        confidence: 0.9,
        words: result.words?.map(word => ({
          w: word.text || '',
          s: word.beginTime || 0,
          e: word.endTime || 0,
          confidence: 0.9
        }))
      } as ASREvent);
      
      const logType = result.is_sentence_end ? 'Final' : 'Partial';
      console.log(`📝 ${logType} transcription [WPM: ${currentWPM}]:`, result.text);
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
      textDelta: `[RealtimeSTT错误: ${errorMessage}]`,
      isFinal: true,
      currentWPM: 0
    } as ASREvent);
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
          task_id: this.taskId
        },
        payload: {
          model: this.config.model,
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          parameters: {
            language: this.config.language,
            model: this.config.model,
            silero_sensitivity: this.config.sensitivity,
            min_length_of_recording: this.config.minRecordingLength,
            post_speech_silence_duration: this.config.postSpeechSilence,
            enable_realtime_transcription: true,
            realtime_processing_pause: 0.02
          }
        }
      };

      console.log('📤 Sending RealtimeSTT run-task command');
      this.websocket.send(JSON.stringify(message));
      
      // 监听task-started事件
      let taskStartedReceived = false;
      const taskStartedHandler = (event: MessageEvent) => {
        try {
          const response = JSON.parse(event.data);
          if (response.header?.event === 'task-started' && response.header?.task_id === this.taskId) {
            console.log('✅ RealtimeSTT task started successfully');
            taskStartedReceived = true;
            this.websocket!.removeEventListener('message', taskStartedHandler);
            resolve();
          } else if (response.header?.event === 'task-failed') {
            console.error('❌ RealtimeSTT task start failed:', response.payload);
            this.websocket!.removeEventListener('message', taskStartedHandler);
            reject(new Error(`Task failed: ${response.payload?.message || 'Unknown error'}`));
          }
        } catch (error) {
          // 忽略JSON解析错误
        }
      };
      
      this.websocket.addEventListener('message', taskStartedHandler);
      
      // 10秒超时
      setTimeout(() => {
        if (!taskStartedReceived) {
          this.websocket!.removeEventListener('message', taskStartedHandler);
          reject(new Error('RealtimeSTT task start timeout'));
        }
      }, 10000);
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
    console.log('🔄 Attempting to reconnect to RealtimeSTT server...');
    
    try {
      this.cleanup(false);
      await new Promise(resolve => setTimeout(resolve, 2000));
      await this.start();
    } catch (error) {
      console.error('❌ RealtimeSTT reconnection failed:', error);
    }
  }

  /**
   * 停止语音识别
   */
  stop(): void {
    if (!this.isActive) return;
    
    console.log('🛑 Stopping RealtimeSTT ASR...');
    
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
    
    // 清理数据
    this.wordHistory = [];
    
    console.log('🧹 RealtimeSTT ASR cleaned up');
  }

  /**
   * 获取状态
   */
  getStatus(): {
    isActive: boolean;
    currentWPM: number;
    connectionState: string;
    serverUrl: string;
  } {
    return {
      isActive: this.isActive,
      currentWPM: this.getCurrentWPM(),
      connectionState: this.websocket ? 
        ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.websocket.readyState] : 
        'DISCONNECTED',
      serverUrl: this.config.serverUrl || 'ws://localhost:8765'
    };
  }
}