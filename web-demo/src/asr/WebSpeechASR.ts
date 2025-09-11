/**
 * Web Speech API实现
 * 基于浏览器原生语音识别API的实时ASR
 */

import type { ASREvent } from '../types';
import type { EventBus } from '../events/EventBus';

export class WebSpeechASR {
  private recognition: SpeechRecognition | null = null;
  private eventBus: EventBus;
  private isActive = false;
  private currentTranscript = '';
  
  // 语速计算相关
  private wordHistory: Array<{word: string, time: number}> = [];
  private readonly WPM_WINDOW_MS = 5000; // 5秒窗口计算WPM

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.setupRecognition();
  }

  /**
   * 设置语音识别
   */
  private setupRecognition(): void {
    // 检查浏览器支持
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      console.error('❌ Speech Recognition not supported in this browser');
      console.error('💡 This browser does not support Web Speech API. Supported browsers: Chrome, Edge');
      return;
    }

    // 检查是否在安全上下文中（HTTPS或localhost）
    if (!window.isSecureContext) {
      console.error('❌ Speech Recognition requires HTTPS or localhost');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'zh-CN,en-US'; // 中英混合识别
    this.recognition.maxAlternatives = 1;

    // 处理识别开始
    this.recognition.onstart = () => {
      console.log('🎤 Speech recognition started successfully');
    };

    // 处理识别结果
    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      this.handleRecognitionResult(event);
    };

    // 改进的错误处理
    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      this.handleRecognitionError(event.error);
    };

    // 识别结束处理
    this.recognition.onend = () => {
      console.log('🔄 Speech recognition ended');
      if (this.isActive) {
        // 延迟重启，避免过于频繁
        setTimeout(() => {
          if (this.isActive) {
            this.restart();
          }
        }, 1000);
      }
    };
  }

  /**
   * 处理识别错误
   */
  private handleRecognitionError(error: string): void {
    console.error('❌ Speech recognition error:', error);
    
    switch (error) {
      case 'not-allowed':
        console.error('🚫 Microphone permission denied. Please allow microphone access.');
        this.eventBus.publish({
          type: 'asr',
          t: Date.now(),
          textDelta: '[麦克风权限被拒绝，请允许麦克风访问]',
          isFinal: true,
          currentWPM: 0
        } as any);
        this.stop();
        break;
        
      case 'network':
        console.error('🌐 Network error. Check internet connection.');
        this.eventBus.publish({
          type: 'asr',
          t: Date.now(),
          textDelta: '[网络错误，请检查网络连接]',
          isFinal: true,
          currentWPM: 0
        } as any);
        // 网络错误时尝试重启
        this.restart();
        break;
        
      case 'no-speech':
        console.warn('⚠️ No speech detected');
        // 无语音是正常情况，继续运行
        break;
        
      case 'aborted':
        console.warn('⚠️ Speech recognition aborted');
        // 被中止时不重启，等待用户操作
        break;
        
      case 'audio-capture':
        console.error('🎤 Failed to capture audio. Check microphone.');
        this.eventBus.publish({
          type: 'asr',
          t: Date.now(),
          textDelta: '[音频捕获失败，请检查麦克风]',
          isFinal: true,
          currentWPM: 0
        } as any);
        break;
        
      case 'service-not-allowed':
        console.error('🔒 Speech recognition service not allowed');
        this.eventBus.publish({
          type: 'asr',
          t: Date.now(),
          textDelta: '[语音识别服务被禁用]',
          isFinal: true,
          currentWPM: 0
        } as any);
        break;
        
      default:
        console.error('❓ Unknown error:', error);
        this.restart();
        break;
    }
  }

  /**
   * 处理识别结果
   */
  private handleRecognitionResult(event: SpeechRecognitionEvent): void {
    // 添加调试输出
    console.count('🎤 onresult');
    console.log('🎤 onresult payload:', event);
    
    // 使用推荐的稳妥写法：重新构建完整transcript
    let finalText = '';
    let interimText = '';

    // 遍历所有results重新构建完整文本
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result?.[0]?.transcript || '';
      
      if (transcript.trim()) {
        if (result.isFinal) {
          finalText += transcript + ' ';
        } else {
          interimText += transcript;
        }
      }
    }

    // 生成完整文本
    const fullText = (finalText + interimText).trim();
    
    // 只要有非空文本就发送更新
    if (fullText) {
      const asrEvent: ASREvent = {
        type: 'asr',
        t: Date.now(),
        textDelta: fullText, // 发送完整文本而不是增量
        isFinal: finalText.length > 0, // 是否包含final结果
        currentWPM: this.getCurrentWPM(),
        fullTranscript: fullText
      };
      
      // 发送前进行调试输出
      console.log('🎤 发送ASR事件:', asrEvent);
      
      // 发送ASR事件
      this.eventBus.publish(asrEvent);
      
      // 只在有final文本时处理单词
      if (finalText) {
        this.processNewWords(finalText);
      }
    }
  }

  /**
   * 处理新单词（用于WPM计算）
   */
  private processNewWords(transcript: string): void {
    // ✅ 多重安全检查
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
      console.warn('⚠️ Invalid transcript provided to processNewWords:', transcript);
      return;
    }
    
    try {
      const words = transcript.trim().split(/\s+/).filter(word => word && word.length > 0);
      const now = Date.now();
      
      words.forEach(word => {
        this.wordHistory.push({ word: word.trim(), time: now });
      });
      
      // 清理旧数据
      this.wordHistory = this.wordHistory.filter(
        entry => now - entry.time < this.WPM_WINDOW_MS
      );
    } catch (error) {
      // ✅ 捕获所有可能的错误
      console.error('❌ Error processing words:', error, 'transcript:', transcript);
    }
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
   * 启动语音识别
   */
  async start(): Promise<boolean> {
    if (!this.recognition) {
      console.error('❌ Speech Recognition not available');
      // 发送错误状态到UI
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta: '[语音识别不可用]',
        isFinal: true,
        currentWPM: 0
      } as any);
      return false;
    }

    if (this.isActive) {
      console.warn('⚠️ Speech recognition already active');
      return true;
    }

    try {
      console.log('🎤 Starting ASR - checking permissions...');
      
      // 首先检查麦克风权限
      const permissionStatus = await this.checkMicrophonePermission();
      if (!permissionStatus) {
        console.error('❌ Microphone permission denied');
        this.eventBus.publish({
          type: 'asr',
          t: Date.now(),
          textDelta: '[麦克风权限被拒绝]',
          isFinal: true,
          currentWPM: 0
        } as any);
        return false;
      }

      console.log('✅ Microphone permission OK - starting recognition...');
      this.recognition.start();
      this.isActive = true;
      this.currentTranscript = '';
      this.wordHistory = [];
      
      // 发送启动状态
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta: '[语音识别已启动，等待语音输入...]',
        isFinal: false,
        currentWPM: 0
      } as any);
      
      console.log('🎤 Speech recognition started successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to start speech recognition:', error);
      
      // 根据错误类型提供不同的提示
      let errorMessage = '[语音识别启动失败]';
      if (error instanceof Error) {
        if (error.message.includes('already started')) {
          console.warn('⚠️ Speech recognition already started elsewhere');
          errorMessage = '[语音识别已在其他地方启动]';
        } else if (error.message.includes('not-allowed')) {
          console.error('🚫 Microphone access denied');
          errorMessage = '[麦克风访问被拒绝]';
        } else {
          errorMessage = `[启动错误: ${error.message}]`;
        }
      }
      
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta: errorMessage,
        isFinal: true,
        currentWPM: 0
      } as any);
      
      return false;
    }
  }

  /**
   * 检查麦克风权限
   */
  private async checkMicrophonePermission(): Promise<boolean> {
    try {
      // 使用 navigator.permissions API 检查权限（如果可用）
      if ('permissions' in navigator) {
        const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        
        if (permission.state === 'denied') {
          console.error('🚫 Microphone permission explicitly denied');
          return false;
        }
        
        if (permission.state === 'granted') {
          console.log('✅ Microphone permission already granted');
          return true;
        }
        
        // 如果是 'prompt' 状态，继续尝试获取权限
      }

      // 尝试获取媒体流来测试权限
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // 立即停止
      console.log('✅ Microphone access granted');
      return true;
      
    } catch (error) {
      console.error('❌ Microphone permission check failed:', error);
      
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          console.error('🚫 User denied microphone access');
        } else if (error.name === 'NotFoundError') {
          console.error('🎤 No microphone found');
        } else if (error.name === 'NotReadableError') {
          console.error('🔧 Microphone is being used by another application');
        }
      }
      
      return false;
    }
  }

  /**
   * 停止语音识别
   */
  stop(): void {
    if (this.recognition && this.isActive) {
      this.isActive = false;
      this.recognition.stop();
      console.log('🛑 Speech recognition stopped');
    }
  }

  /**
   * 重启语音识别
   */
  private restart(): void {
    if (!this.isActive || !this.recognition) return;
    
    // 先停止当前识别
    try {
      this.recognition.stop();
    } catch {
      // 忽略停止时的错误
    }
    
    // 延迟重启避免状态冲突
    setTimeout(() => {
      if (this.isActive && this.recognition) {
        try {
          this.recognition.start();
        } catch (error) {
          console.error('❌ Failed to restart recognition:', error);
        }
      }
    }, 200);
  }

  /**
   * 获取状态
   */
  getStatus(): {
    isActive: boolean;
    currentWPM: number;
    transcriptLength: number;
  } {
    return {
      isActive: this.isActive,
      currentWPM: this.getCurrentWPM(),
      transcriptLength: this.currentTranscript.length
    };
  }
}