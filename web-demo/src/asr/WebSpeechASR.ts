/**
 * Web Speech API实现
 * 基于浏览器原生语音识别API的实时ASR
 */

import type { ASREvent } from '../types';
import type { EventBus } from '../events/EventBus';

export class WebSpeechASR {
  private recognition: any = null;
  private eventBus: EventBus;
  private isActive = false;
  private currentTranscript = '';
  private lastTranscriptLength = 0;
  
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
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      console.error('❌ Speech Recognition not supported in this browser');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'zh-CN'; // 默认中文，可配置

    // 处理识别结果
    this.recognition.onresult = (event: any) => {
      this.handleRecognitionResult(event);
    };

    // 错误处理
    this.recognition.onerror = (event: any) => {
      console.error('❌ Speech recognition error:', event.error);
      if (event.error === 'no-speech' || event.error === 'aborted') {
        // 正常情况，重新启动
        this.restart();
      }
    };

    // 识别结束处理
    this.recognition.onend = () => {
      if (this.isActive) {
        console.log('🔄 Speech recognition ended, restarting...');
        this.restart();
      }
    };
  }

  /**
   * 处理识别结果
   */
  private handleRecognitionResult(event: any): void {
    let finalTranscript = '';
    let interimTranscript = '';

    // 处理结果
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result?.transcript;
      
      if (transcript && typeof transcript === 'string') {
        if (result.isFinal) {
          finalTranscript += transcript + ' ';
          this.processNewWords(transcript);
        } else {
          interimTranscript += transcript;
        }
      }
    }

    // 计算增量文本
    const newTranscript = finalTranscript || interimTranscript;
    const textDelta = newTranscript.slice(this.lastTranscriptLength);
    
    if (textDelta.trim().length > 0) {
      // 发送ASR事件
      this.eventBus.publish({
        type: 'asr',
        t: Date.now(),
        textDelta: textDelta.trim(),
        isFinal: event.results[event.resultIndex]?.isFinal || false,
        currentWPM: this.getCurrentWPM(),
        fullTranscript: this.currentTranscript
      } as ASREvent);
      
      this.currentTranscript = newTranscript;
      this.lastTranscriptLength = newTranscript.length;
    }
  }

  /**
   * 处理新单词（用于WPM计算）
   */
  private processNewWords(transcript: string): void {
    if (!transcript || typeof transcript !== 'string') {
      console.warn('⚠️ Invalid transcript provided to processNewWords:', transcript);
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
   * 启动语音识别
   */
  start(): boolean {
    if (!this.recognition) {
      console.error('❌ Speech Recognition not available');
      return false;
    }

    try {
      this.recognition.start();
      this.isActive = true;
      this.currentTranscript = '';
      this.lastTranscriptLength = 0;
      this.wordHistory = [];
      
      console.log('🎤 Speech recognition started');
      return true;
    } catch (error) {
      console.error('❌ Failed to start speech recognition:', error);
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
    } catch (error) {
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