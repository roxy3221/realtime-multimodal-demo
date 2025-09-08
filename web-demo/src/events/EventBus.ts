/**
 * 事件总线系统
 * 基于BroadcastChannel实现跨Worker通信
 * 对应Python中的事件派发机制
 */

import type { MultiModalEvent, EventListener } from '../types';
import { DEBUG_CONFIG } from '../config/defaults';

export class EventBus {
  private channel: BroadcastChannel;
  private listeners: Map<string, Set<EventListener>> = new Map();
  private eventHistory: MultiModalEvent[] = [];
  private maxHistorySize = 1000;

  constructor(channelName: string = 'multimodal-events') {
    this.channel = new BroadcastChannel(channelName);
    this.channel.addEventListener('message', this.handleBroadcastMessage.bind(this));
    
    if (DEBUG_CONFIG.enable_logging) {
      console.log(`🚌 EventBus initialized: ${channelName}`);
    }
  }

  /**
   * 发布事件（跨Worker广播）
   */
  publish<T extends MultiModalEvent>(event: T): void {
    try {
      // 添加到历史记录
      this.addToHistory(event);
      
      // 本地分发
      this.notifyLocalListeners(event);
      
      // 跨Worker广播
      this.channel.postMessage({
        type: 'event',
        event,
        timestamp: Date.now()
      });

      if (DEBUG_CONFIG.enable_logging && DEBUG_CONFIG.log_level === 'debug') {
        console.log(`📢 Event published:`, event);
      }
    } catch (error) {
      console.error('❌ Event publish failed:', error);
    }
  }

  /**
   * 发出事件（别名方法）
   */
  emit<T extends MultiModalEvent>(_eventType: string, event: T): void {
    this.publish(event);
  }

  /**
   * 订阅事件类型
   */
  subscribe<T extends MultiModalEvent>(
    eventType: T['type'] | 'all',
    listener: EventListener<T>
  ): () => void {
    const key = eventType;
    
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    
    this.listeners.get(key)!.add(listener as EventListener);

    // 返回取消订阅函数
    return () => {
      const listenerSet = this.listeners.get(key);
      if (listenerSet) {
        listenerSet.delete(listener as EventListener);
        if (listenerSet.size === 0) {
          this.listeners.delete(key);
        }
      }
    };
  }

  /**
   * 获取事件历史
   */
  getHistory(filter?: {
    type?: MultiModalEvent['type'];
    since?: number;
    limit?: number;
  }): MultiModalEvent[] {
    let events = [...this.eventHistory];
    
    if (filter?.type) {
      events = events.filter(e => e.type === filter.type);
    }
    
    if (filter?.since) {
      events = events.filter(e => e.t >= filter.since!);
    }
    
    if (filter?.limit) {
      events = events.slice(-filter.limit);
    }
    
    return events;
  }

  /**
   * 导出事件数据
   */
  exportEvents(): {
    session_id: string;
    events: MultiModalEvent[];
    exported_at: number;
  } {
    return {
      session_id: `session_${Date.now()}`,
      events: [...this.eventHistory],
      exported_at: Date.now()
    };
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.channel.close();
    this.listeners.clear();
    this.eventHistory = [];
    
    if (DEBUG_CONFIG.enable_logging) {
      console.log('🧹 EventBus disposed');
    }
  }

  // 私有方法
  private handleBroadcastMessage(event: MessageEvent): void {
    if (event.data?.type === 'event') {
      const multiModalEvent = event.data.event as MultiModalEvent;
      this.notifyLocalListeners(multiModalEvent);
      this.addToHistory(multiModalEvent);
    }
  }

  private notifyLocalListeners(event: MultiModalEvent): void {
    // 通知特定类型监听器
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      typeListeners.forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          console.error(`❌ Event listener error for ${event.type}:`, error);
        }
      });
    }

    // 通知全局监听器
    const allListeners = this.listeners.get('all');
    if (allListeners) {
      allListeners.forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          console.error('❌ Global event listener error:', error);
        }
      });
    }
  }

  private addToHistory(event: MultiModalEvent): void {
    this.eventHistory.push(event);
    
    // 限制历史记录大小
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }
}

// 全局单例EventBus
export const globalEventBus = new EventBus('global-multimodal-events');