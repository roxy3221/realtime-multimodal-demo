#!/usr/bin/env python3
"""
RealtimeSTT WebSocket 服务器
用于实时语音转文字，替换 Gummy ASR 方案

依赖安装：
pip install RealtimeSTT websockets asyncio

使用方法：
python realtime_stt_server.py
"""

import asyncio
import websockets
import json
import logging
import time
from threading import Thread, Event
from queue import Queue, Empty
from typing import Optional, Dict, Any
import signal
import sys

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

try:
    from RealtimeSTT import AudioToTextRecorder
    logger.info("✅ RealtimeSTT imported successfully")
except ImportError as e:
    logger.error(f"❌ Failed to import RealtimeSTT: {e}")
    logger.error("Please install RealtimeSTT: pip install RealtimeSTT")
    sys.exit(1)


class RealtimeSTTServer:
    def __init__(self, host="localhost", port=8765):
        self.host = host
        self.port = port
        self.clients = set()
        self.recorder: Optional[AudioToTextRecorder] = None
        self.recording_thread: Optional[Thread] = None
        self.stop_event = Event()
        self.text_queue = Queue()
        
        # 语速计算
        self.word_history = []
        self.WPM_WINDOW_SEC = 5.0
        
        # 录音状态
        self.is_recording = False
        self.current_session_id = None
        
    async def register_client(self, websocket):
        """注册客户端"""
        self.clients.add(websocket)
        client_addr = websocket.remote_address
        logger.info(f"👤 Client connected: {client_addr}")
        
        # 发送连接确认
        await self.send_to_client(websocket, {
            "header": {
                "event": "proxy-connected",
                "request_id": "server",
                "task_id": "connection"
            },
            "payload": {
                "message": "RealtimeSTT server ready"
            }
        })
    
    async def unregister_client(self, websocket):
        """注销客户端"""
        self.clients.discard(websocket)
        client_addr = getattr(websocket, 'remote_address', 'unknown')
        logger.info(f"👋 Client disconnected: {client_addr}")
        
        # 如果没有客户端了，停止录音
        if not self.clients and self.is_recording:
            await self.stop_recording()
    
    async def send_to_client(self, websocket, message: Dict[str, Any]):
        """发送消息到客户端"""
        try:
            await websocket.send(json.dumps(message, ensure_ascii=False))
        except websockets.exceptions.ConnectionClosed:
            logger.warning("⚠️ Client connection closed during send")
        except Exception as e:
            logger.error(f"❌ Error sending message to client: {e}")
    
    async def broadcast_to_clients(self, message: Dict[str, Any]):
        """广播消息到所有客户端"""
        if self.clients:
            # 创建所有发送任务
            tasks = [self.send_to_client(client, message) for client in self.clients.copy()]
            # 并发执行所有发送任务
            await asyncio.gather(*tasks, return_exceptions=True)
    
    def text_callback(self, text: str):
        """RealtimeSTT的文本回调函数"""
        if text.strip():
            timestamp = time.time()
            
            # 简单的词计数（适用于英文，中文需要分词）
            words = text.split()
            word_count = len(words)
            
            # 更新词历史记录用于WPM计算
            self.word_history.append({
                'words': word_count,
                'timestamp': timestamp
            })
            
            # 清理旧记录
            cutoff_time = timestamp - self.WPM_WINDOW_SEC
            self.word_history = [
                entry for entry in self.word_history 
                if entry['timestamp'] > cutoff_time
            ]
            
            # 计算当前WPM
            current_wpm = self.calculate_wpm()
            
            # 添加到消息队列
            self.text_queue.put({
                'text': text,
                'timestamp': timestamp,
                'wpm': current_wpm,
                'word_count': word_count
            })
    
    def calculate_wpm(self) -> int:
        """计算当前语速 (Words Per Minute)"""
        if len(self.word_history) < 2:
            return 0
            
        total_words = sum(entry['words'] for entry in self.word_history)
        time_span = self.word_history[-1]['timestamp'] - self.word_history[0]['timestamp']
        
        if time_span <= 0:
            return 0
            
        wpm = (total_words / time_span) * 60
        return int(wpm)
    
    def start_callback(self):
        """录音开始回调"""
        logger.info("🎤 Recording started")
        asyncio.create_task(self.broadcast_to_clients({
            "header": {
                "event": "recording-started",
                "request_id": self.current_session_id or "unknown",
                "task_id": self.current_session_id or "unknown"
            },
            "payload": {
                "message": "Recording started"
            }
        }))
    
    def stop_callback(self):
        """录音结束回调"""
        logger.info("⏹️ Recording stopped")
        asyncio.create_task(self.broadcast_to_clients({
            "header": {
                "event": "recording-stopped", 
                "request_id": self.current_session_id or "unknown",
                "task_id": self.current_session_id or "unknown"
            },
            "payload": {
                "message": "Recording stopped"
            }
        }))
    
    async def start_recording(self, task_id: str, request_id: str, parameters: Dict[str, Any]):
        """启动录音和识别"""
        if self.is_recording:
            logger.warning("⚠️ Already recording")
            return False
            
        try:
            logger.info("🚀 Starting RealtimeSTT recording...")
            self.current_session_id = task_id
            
            # 配置录音器参数
            recorder_config = {
                'spinner': False,  # 禁用控制台spinner
                'model': 'tiny.en',  # 使用更快的模型
                'language': 'zh',  # 支持中文
                'on_recording_start': self.start_callback,
                'on_recording_stop': self.stop_callback,
                'silero_sensitivity': 0.4,  # VAD敏感度
                'post_speech_silence_duration': 0.7,  # 后静音时长
                'min_length_of_recording': 0.5,  # 最小录音长度
                'min_gap_between_recordings': 0.3,  # 录音间隔
                'enable_realtime_transcription': True,  # 启用实时转录
                'realtime_processing_pause': 0.02,  # 实时处理间隔
            }
            
            # 应用用户参数
            if parameters.get('language'):
                recorder_config['language'] = parameters['language']
            if parameters.get('model'):
                recorder_config['model'] = parameters['model']
                
            # 初始化录音器
            self.recorder = AudioToTextRecorder(**recorder_config)
            self.is_recording = True
            
            # 发送任务启动确认
            await self.broadcast_to_clients({
                "header": {
                    "event": "task-started",
                    "request_id": request_id,
                    "task_id": task_id
                },
                "payload": {
                    "message": "RealtimeSTT task started successfully"
                }
            })
            
            # 在单独线程中运行录音
            self.recording_thread = Thread(
                target=self.recording_worker, 
                args=(task_id, request_id),
                daemon=True
            )
            self.recording_thread.start()
            
            # 启动文本处理任务
            asyncio.create_task(self.text_processor())
            
            logger.info("✅ RealtimeSTT recording started successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to start recording: {e}")
            self.is_recording = False
            
            await self.broadcast_to_clients({
                "header": {
                    "event": "task-failed", 
                    "request_id": request_id,
                    "task_id": task_id
                },
                "payload": {
                    "message": f"Failed to start recording: {str(e)}"
                }
            })
            return False
    
    def recording_worker(self, task_id: str, request_id: str):
        """录音工作线程"""
        try:
            logger.info("🎯 Recording worker thread started")
            
            # 开始录音循环
            with self.recorder as recorder:
                while not self.stop_event.is_set() and self.is_recording:
                    try:
                        # 获取转录文本 (阻塞调用)
                        text = recorder.text(self.text_callback)
                        
                        if text and text.strip():
                            logger.info(f"📝 Transcribed: {text}")
                            
                    except Exception as e:
                        logger.error(f"❌ Error in recording loop: {e}")
                        if not self.stop_event.is_set():
                            time.sleep(0.1)  # 短暂等待后继续
                        
        except Exception as e:
            logger.error(f"❌ Recording worker error: {e}")
        finally:
            logger.info("🏁 Recording worker thread ended")
    
    async def text_processor(self):
        """处理转录文本的异步任务"""
        logger.info("📨 Text processor started")
        
        while self.is_recording or not self.text_queue.empty():
            try:
                # 非阻塞获取文本
                text_data = self.text_queue.get_nowait()
                
                # 构建并发送ASR事件
                asr_event = {
                    "header": {
                        "event": "result-generated",
                        "request_id": self.current_session_id or "unknown", 
                        "task_id": self.current_session_id or "unknown"
                    },
                    "payload": {
                        "transcription_result": {
                            "sentence_id": int(text_data['timestamp']),
                            "begin_time": int(text_data['timestamp'] * 1000),
                            "end_time": int(text_data['timestamp'] * 1000) + 1000,
                            "text": text_data['text'],
                            "is_sentence_end": True,  # RealtimeSTT通常返回完整句子
                            "words": []  # RealtimeSTT不提供词级时间戳
                        },
                        "usage": {
                            "current_wpm": text_data['wpm']
                        }
                    }
                }
                
                await self.broadcast_to_clients(asr_event)
                logger.info(f"📤 Sent transcription: {text_data['text']} (WPM: {text_data['wpm']})")
                
            except Empty:
                # 队列为空，等待一下
                await asyncio.sleep(0.1)
            except Exception as e:
                logger.error(f"❌ Error processing text: {e}")
                await asyncio.sleep(0.1)
        
        logger.info("📨 Text processor ended")
    
    async def stop_recording(self):
        """停止录音"""
        if not self.is_recording:
            return
            
        logger.info("🛑 Stopping recording...")
        self.is_recording = False
        self.stop_event.set()
        
        # 等待录音线程结束
        if self.recording_thread and self.recording_thread.is_alive():
            self.recording_thread.join(timeout=3.0)
            
        # 清理录音器
        if self.recorder:
            try:
                self.recorder = None
            except Exception as e:
                logger.warning(f"⚠️ Error cleaning up recorder: {e}")
        
        # 发送任务完成事件
        if self.current_session_id:
            await self.broadcast_to_clients({
                "header": {
                    "event": "task-finished",
                    "request_id": self.current_session_id,
                    "task_id": self.current_session_id
                },
                "payload": {
                    "message": "Recording finished"
                }
            })
        
        # 重置状态
        self.current_session_id = None
        self.stop_event.clear()
        self.word_history.clear()
        
        # 清空文本队列
        while not self.text_queue.empty():
            try:
                self.text_queue.get_nowait()
            except Empty:
                break
                
        logger.info("✅ Recording stopped")
    
    async def handle_client_message(self, websocket, message_str: str):
        """处理客户端消息"""
        try:
            message = json.loads(message_str)
            header = message.get('header', {})
            payload = message.get('payload', {})
            
            action = header.get('action')
            request_id = header.get('request_id', 'unknown')
            task_id = header.get('task_id', 'unknown')
            
            logger.info(f"📥 Received action: {action}")
            
            if action == 'run-task':
                # 启动录音任务
                parameters = payload.get('parameters', {})
                success = await self.start_recording(task_id, request_id, parameters)
                
                if not success:
                    await self.send_to_client(websocket, {
                        "header": {
                            "event": "task-failed",
                            "request_id": request_id,
                            "task_id": task_id
                        },
                        "payload": {
                            "message": "Failed to start recording task"
                        }
                    })
                    
            elif action == 'finish-task':
                # 结束录音任务
                await self.stop_recording()
                
            elif action == 'send-audio':
                # RealtimeSTT直接从麦克风采集，忽略客户端音频数据
                pass
                
            else:
                logger.warning(f"⚠️ Unknown action: {action}")
                
        except json.JSONDecodeError:
            logger.error("❌ Invalid JSON received from client")
        except Exception as e:
            logger.error(f"❌ Error handling client message: {e}")
    
    async def client_handler(self, websocket, path):
        """处理客户端连接"""
        await self.register_client(websocket)
        
        try:
            async for message in websocket:
                await self.handle_client_message(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            logger.info("👋 Client connection closed normally")
        except Exception as e:
            logger.error(f"❌ Error in client handler: {e}")
        finally:
            await self.unregister_client(websocket)
    
    async def start_server(self):
        """启动WebSocket服务器"""
        logger.info(f"🚀 Starting RealtimeSTT WebSocket server on {self.host}:{self.port}")
        
        server = await websockets.serve(
            self.client_handler,
            self.host,
            self.port,
            ping_interval=30,
            ping_timeout=10
        )
        
        logger.info(f"✅ RealtimeSTT server started on ws://{self.host}:{self.port}")
        logger.info("📡 Server ready to accept connections...")
        
        return server
    
    async def shutdown(self):
        """关闭服务器"""
        logger.info("🛑 Shutting down server...")
        
        # 停止录音
        await self.stop_recording()
        
        # 通知所有客户端
        if self.clients:
            await self.broadcast_to_clients({
                "header": {
                    "event": "server-shutdown",
                    "request_id": "server",
                    "task_id": "shutdown"
                },
                "payload": {
                    "message": "Server is shutting down"
                }
            })
        
        logger.info("✅ Server shutdown complete")


async def main():
    # 创建服务器实例
    server_instance = RealtimeSTTServer(host="localhost", port=8765)
    
    # 启动服务器
    server = await server_instance.start_server()
    
    # 设置信号处理
    def signal_handler():
        logger.info("📡 Received shutdown signal")
        asyncio.create_task(server_instance.shutdown())
        server.close()
    
    # 在Windows上使用不同的信号处理
    try:
        import signal
        for sig in [signal.SIGTERM, signal.SIGINT]:
            signal.signal(sig, lambda s, f: signal_handler())
    except AttributeError:
        # Windows doesn't support SIGTERM
        signal.signal(signal.SIGINT, lambda s, f: signal_handler())
    
    try:
        # 等待服务器运行
        await server.wait_closed()
    except KeyboardInterrupt:
        logger.info("⌨️ Keyboard interrupt received")
    finally:
        await server_instance.shutdown()
        logger.info("👋 Server stopped")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("👋 Goodbye!")
    except Exception as e:
        logger.error(f"❌ Server error: {e}")
        sys.exit(1)