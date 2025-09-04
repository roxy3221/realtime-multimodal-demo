#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MultiModalAnalyzer_Optimized.py - 优化的多模态分析系统
采用事件驱动+触发式分析架构，大幅提升性能
修复版本 - 解决了变量作用域和依赖问题
"""

import json
import os
import cv2
import numpy as np
from typing import Dict, List, Optional, Tuple
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
import subprocess
import traceback

# 尝试导入可选依赖
try:
    import librosa
    HAS_LIBROSA = True
except ImportError:
    HAS_LIBROSA = False
    print("⚠️ librosa未安装，音频分析功能受限")

try:
    from AliyunASRClient import QwenASRClient
    HAS_ASR_CLIENT = True
except ImportError:
    HAS_ASR_CLIENT = False
    print("⚠️ AliyunASRClient未找到，使用模拟ASR")

try:
    from FacialAnalyzer import FacialAnalyzer
    HAS_FACIAL_ANALYZER = True
except ImportError:
    HAS_FACIAL_ANALYZER = False
    print("⚠️ FacialAnalyzer未找到，使用简化人脸分析")

try:
    from ProsodyAnalyzer_Pro import ProsodyAnalyzer
    HAS_PROSODY_ANALYZER = True
except ImportError:
    HAS_PROSODY_ANALYZER = False
    print("⚠️ ProsodyAnalyzer未找到，使用简化韵律分析")

try:
    from PauseDetector import PauseDetector
    HAS_PAUSE_DETECTOR = True
except ImportError:
    HAS_PAUSE_DETECTOR = False
    print("⚠️ PauseDetector未找到，使用简化VAD")

try:
    from EventDrivenDetector import LightweightDetector, EventDrivenCache
    HAS_EVENT_DETECTOR = True
except ImportError:
    HAS_EVENT_DETECTOR = False
    print("⚠️ EventDrivenDetector未找到，使用默认实现")

try:
    from TimeAlignment import snap_to_silence
    HAS_TIME_ALIGNMENT = True
except ImportError:
    HAS_TIME_ALIGNMENT = False
    print("⚠️ TimeAlignment未找到，跳过时间对齐")

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# =============================================================================
# 默认实现类（当依赖不可用时使用）
# =============================================================================

class MockASRClient:
    """模拟ASR客户端"""
    def transcribe_and_segment(self, audio_path: str) -> List[Dict]:
        logger.info("🤖 使用模拟ASR分段")
        # 模拟分段：假设每3秒一个段落
        try:
            if HAS_LIBROSA:
                y, sr = librosa.load(audio_path, sr=None)
                duration = len(y) / sr
            else:
                # 使用ffprobe获取时长
                duration = self._get_duration_ffprobe(audio_path)
        except:
            duration = 30.0  # 默认30秒
        
        segments = []
        for i in range(0, int(duration), 3):
            segments.append({
                "text": f"模拟语音段落{len(segments)+1}",
                "start_ms": i * 1000,
                "end_ms": min((i + 3) * 1000, int(duration * 1000)),
                "source": "MOCK_ASR",
                "punct": "。"
            })
        
        return segments
    
    def _get_duration_ffprobe(self, audio_path: str) -> float:
        """使用ffprobe获取音频时长"""
        try:
            cmd = [
                'ffprobe', '-i', audio_path, '-show_entries', 
                'format=duration', '-v', 'quiet', '-of', 'csv=p=0'
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            return float(result.stdout.strip())
        except:
            return 30.0

class MockFacialAnalyzer:
    """模拟面部分析器"""
    @staticmethod
    def analyze_segment(video_path: str, start_ms: int, end_ms: int) -> Dict:
        logger.debug(f"🎭 模拟面部分析 {start_ms}-{end_ms}ms")
        return {
            "Smile": [0.5, 0.1],
            "Mouth": [0.3, 0.1],
            "EAR": [0.25, 0.05],
            "Brow": [0.1, 0.02],
            "Yaw": [0.0, 2.0],
            "Pitch": [0.0, 2.0],
            "Roll": [0.0, 1.0],
            "FaceSize": [0.2, 0.05]
        }

class MockProsodyAnalyzer:
    """模拟韵律分析器"""
    @staticmethod
    def analyze_segment(audio_path: str, start_ms: int, end_ms: int, n_points: int = 15) -> Dict:
        logger.debug(f"🎵 模拟韵律分析 {start_ms}-{end_ms}ms")
        # 生成模拟的韵律数据
        duration_s = (end_ms - start_ms) / 1000.0
        time_points = np.linspace(0, duration_s, n_points)
        
        # 模拟基频变化
        pitch = 200 + 50 * np.sin(2 * np.pi * time_points / duration_s * 2)
        # 模拟语速变化
        rate = 1.0 + 0.2 * np.sin(2 * np.pi * time_points / duration_s * 3)
        # 模拟音量变化
        level = 0.7 + 0.2 * np.sin(2 * np.pi * time_points / duration_s * 1.5)
        
        return {
            "pitch": pitch.tolist(),
            "rate": rate.tolist(),
            "level": level.tolist()
        }

class MockPauseDetector:
    """模拟暂停检测器"""
    def detect_pauses_from_file(self, audio_path: str) -> Dict:
        logger.info("⏸️ 模拟VAD检测")
        try:
            if HAS_LIBROSA:
                y, sr = librosa.load(audio_path, sr=None)
                duration = len(y) / sr
            else:
                duration = self._get_duration_ffprobe(audio_path)
        except:
            duration = 30.0
        
        # 模拟语音段和暂停段
        speech_segments = []
        pause_segments = []
        
        current_time = 0
        while current_time < duration:
            # 语音段：2-4秒
            speech_duration = np.random.uniform(2.0, 4.0)
            speech_end = min(current_time + speech_duration, duration)
            speech_segments.append({
                'start_time': current_time,
                'end_time': speech_end
            })
            current_time = speech_end
            
            # 暂停段：0.3-0.8秒
            if current_time < duration:
                pause_duration = np.random.uniform(0.3, 0.8)
                pause_end = min(current_time + pause_duration, duration)
                pause_segments.append({
                    'start_time': current_time,
                    'end_time': pause_end
                })
                current_time = pause_end
        
        return {
            'speech_segments': speech_segments,
            'pause_segments': pause_segments
        }
    
    def _get_duration_ffprobe(self, audio_path: str) -> float:
        """使用ffprobe获取音频时长"""
        try:
            cmd = [
                'ffprobe', '-i', audio_path, '-show_entries', 
                'format=duration', '-v', 'quiet', '-of', 'csv=p=0'
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            return float(result.stdout.strip())
        except:
            return 30.0

class LightweightDetector:
    """轻量级事件检测器的默认实现"""
    
    def precompute_audio_features(self, audio_path: str) -> Dict:
        """预计算音频特征"""
        logger.info("🎯 预计算音频特征（轻量版）")
        return {
            "features": "lightweight_computed",
            "timestamp": time.time()
        }
    
    def detect_audio_events(self, precomputed_audio: Dict, start_s: float, end_s: float) -> List[Dict]:
        """检测音频事件"""
        # 简单的随机事件生成
        events = []
        if np.random.random() > 0.7:  # 30%概率有事件
            events.append({
                "type": "audio_change",
                "timestamp": (start_s + end_s) / 2,
                "confidence": 0.8
            })
        return events
    
    def detect_video_events(self, video_path: str, start_frame: int, end_frame: int) -> List[Dict]:
        """检测视频事件"""
        events = []
        if np.random.random() > 0.6:  # 40%概率有事件
            events.append({
                "type": "visual_change",
                "frame": (start_frame + end_frame) // 2,
                "confidence": 0.7
            })
        return events
    
    def should_trigger_analysis(self, events: List[Dict], timestamp: float) -> Dict:
        """判断是否触发分析"""
        # 简单策略：有事件就触发
        should_trigger = len(events) > 0 or np.random.random() > 0.5  # 50%概率触发
        
        reasons = []
        if len(events) > 0:
            reasons.append(f"detected_{len(events)}_events")
        if should_trigger and not reasons:
            reasons.append("random_trigger")
        
        return {
            "should_trigger": should_trigger,
            "reasons": reasons
        }

class EventDrivenCache:
    """事件驱动缓存的默认实现"""
    
    def __init__(self):
        self.audio_cache = {}
        self.video_cache = {}
        logger.info("💾 初始化事件驱动缓存")
    
    def get_interpolated_audio(self, timestamp: float, n_points: int) -> Optional[Dict]:
        """获取插值音频特征"""
        # 简单的最近邻插值
        if not self.audio_cache:
            return None
        
        closest_time = min(self.audio_cache.keys(), key=lambda t: abs(t - timestamp))
        if abs(closest_time - timestamp) < 2.0:  # 2秒内的缓存有效
            cached_features = self.audio_cache[closest_time].copy()
            logger.debug(f"📋 使用缓存音频特征 {closest_time:.2f}s -> {timestamp:.2f}s")
            return cached_features
        
        return None
    
    def get_interpolated_video(self, timestamp: float) -> Optional[Dict]:
        """获取插值视频特征"""
        if not self.video_cache:
            return None
        
        closest_time = min(self.video_cache.keys(), key=lambda t: abs(t - timestamp))
        if abs(closest_time - timestamp) < 2.0:  # 2秒内的缓存有效
            cached_features = self.video_cache[closest_time].copy()
            logger.debug(f"📋 使用缓存视频特征 {closest_time:.2f}s -> {timestamp:.2f}s")
            return cached_features
        
        return None
    
    def store_audio_features(self, timestamp: float, features: Dict):
        """存储音频特征"""
        if features and "sound" in features:
            self.audio_cache[timestamp] = features["sound"]
            logger.debug(f"💾 缓存音频特征 {timestamp:.2f}s")
    
    def store_video_features(self, timestamp: float, features: Dict):
        """存储视频特征"""
        if features and "face" in features:
            self.video_cache[timestamp] = features["face"]
            logger.debug(f"💾 缓存视频特征 {timestamp:.2f}s")
    
    def cleanup_old_cache(self, current_time: float, max_age: float):
        """清理过期缓存"""
        cutoff_time = current_time - max_age
        
        # 清理音频缓存
        old_audio_count = len(self.audio_cache)
        self.audio_cache = {t: f for t, f in self.audio_cache.items() if t >= cutoff_time}
        
        # 清理视频缓存
        old_video_count = len(self.video_cache)
        self.video_cache = {t: f for t, f in self.video_cache.items() if t >= cutoff_time}
        
        cleaned_audio = old_audio_count - len(self.audio_cache)
        cleaned_video = old_video_count - len(self.video_cache)
        
        if cleaned_audio > 0 or cleaned_video > 0:
            logger.info(f"🧹 清理缓存: 音频{cleaned_audio}个, 视频{cleaned_video}个")

# =============================================================================
# 主分析器类
# =============================================================================

class MultiModalAnalyzer_Optimized:
    """优化的多模态分析系统 - 事件驱动架构（完整修复版）"""
    
    def __init__(self, api_key: str = None, enable_segmentation: bool = True, 
                 segmentation_mode: str = "ASR_PUNCT_FIRST"):
        """
        初始化优化的多模态分析器
        
        Args:
            api_key: 阿里云ASR API密钥
            enable_segmentation: 是否启用分段模式
            segmentation_mode: 分段模式
        """
        logger.info("🚀 初始化优化的多模态分析器...")
        
        # 核心组件初始化（使用可用的实现）
        if HAS_ASR_CLIENT and api_key:
            self.asr_client = QwenASRClient()
        else:
            self.asr_client = MockASRClient()
            logger.info("使用模拟ASR客户端")
        
        if HAS_FACIAL_ANALYZER:
            self.facial_analyzer = FacialAnalyzer()
        else:
            self.facial_analyzer = MockFacialAnalyzer()
            logger.info("使用模拟面部分析器")
        
        if HAS_PROSODY_ANALYZER:
            self.prosody_analyzer = ProsodyAnalyzer()
        else:
            self.prosody_analyzer = MockProsodyAnalyzer()
            logger.info("使用模拟韵律分析器")
        
        if HAS_PAUSE_DETECTOR and enable_segmentation:
            self.pause_detector = PauseDetector()
        else:
            self.pause_detector = MockPauseDetector() if enable_segmentation else None
            if enable_segmentation:
                logger.info("使用模拟暂停检测器")
        
        # 优化组件
        if HAS_EVENT_DETECTOR:
            self.detector = LightweightDetector()
            self.cache = EventDrivenCache()
        else:
            self.detector = LightweightDetector()
            self.cache = EventDrivenCache()
            logger.info("使用默认事件检测和缓存")
        
        self.enable_segmentation = enable_segmentation
        self.segmentation_mode = segmentation_mode
        
        # 初始化人脸级联分类器（避免重复创建）
        try:
            self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
            if self.face_cascade.empty():
                raise ValueError("人脸级联分类器加载失败")
        except Exception as e:
            logger.warning(f"人脸检测器初始化失败: {e}")
            self.face_cascade = None
        
        # 优化配置
        self.CFG = {
            "max_segment_s": 12.0,
            "max_chars": 30,
            "vad_pause_cut_s": 0.4,
            "snap_tolerance_ms": 120,
            "prosody_points": 15,
            
            # 事件驱动配置
            "analysis_window_s": 2.0,           # 分析窗口时长
            "trigger_threshold": 0.5,           # 触发阈值
            "cache_max_age_s": 300.0,           # 缓存最大年龄
            "min_recompute_interval_s": 0.5,    # 最小重计算间隔
            "parallel_precompute": True,        # 并行预计算
        }
        
        # 预计算缓存
        self._precomputed_audio = None
        self._precomputed_face_cache = {}
        self._precomputed_vad = None
        
        logger.info("✅ 多模态分析器初始化完成")
        
    def analyze_video_audio(self, video_path: str, audio_path: str = None, 
                           extract_audio: bool = True) -> Dict:
        """
        优化的多模态分析主流程
        采用: P0预计算 + P1ASR并行 + P2事件驱动 + P3缓存聚合
        """
        logger.info("🚀 启动优化的多模态分析...")
        start_time = time.time()
        
        try:
            # 验证文件
            if not os.path.exists(video_path):
                raise FileNotFoundError(f"视频文件不存在: {video_path}")
            
            # 准备音频路径
            if audio_path is None and extract_audio:
                audio_path = self._extract_audio(video_path)
            elif audio_path is None:
                audio_path = video_path
                
            # **阶段P0: 并行预计算**
            logger.info("📊 P0: 启动并行预计算...")
            precompute_start = time.time()
            
            if self.CFG["parallel_precompute"]:
                # 并行执行预计算和ASR
                with ThreadPoolExecutor(max_workers=3) as executor:
                    # 提交预计算任务
                    audio_future = executor.submit(self._precompute_audio, audio_path)
                    video_future = executor.submit(self._precompute_video, video_path)
                    asr_future = executor.submit(self._run_asr_segmentation, audio_path)
                    
                    # 等待预计算完成
                    precomputed_audio = audio_future.result()
                    precomputed_video = video_future.result() 
                    asr_segments = asr_future.result()
            else:
                # 串行执行（回退模式）
                precomputed_audio = self._precompute_audio(audio_path)
                precomputed_video = self._precompute_video(video_path)
                asr_segments = self._run_asr_segmentation(audio_path)
                
            precompute_time = time.time() - precompute_start
            logger.info(f"✅ P0预计算完成，耗时: {precompute_time:.2f}s")
            
            # **阶段P1+P2: 事件驱动的段落处理**
            logger.info("🎯 P1+P2: 事件驱动分段处理...")
            segments = self._process_segments_event_driven(
                asr_segments, video_path, audio_path, 
                precomputed_audio, precomputed_video
            )
            
            # **阶段P3+P4: 汇总输出**
            total_time = time.time() - start_time
            
            result = {
                "segments": segments,
                "summary": {
                    "total_duration": precomputed_audio.get("duration", 0),
                    "segment_count": len(segments),
                    "asr_segments": len([s for s in segments if s.get("meta", {}).get("source") == "ASR_PUNCT"]),
                    "vad_fallback_segments": len([s for s in segments if s.get("meta", {}).get("source") == "VAD_FALLBACK"]),
                    "segmentation_mode": self.segmentation_mode,
                    "performance": {
                        "total_time_s": total_time,
                        "precompute_time_s": precompute_time,
                        "processing_time_s": total_time - precompute_time,
                        "speedup_ratio": f"{precomputed_audio.get('duration', 1) / total_time:.2f}x"
                    }
                }
            }
            
            logger.info(f"🎉 优化分析完成! 总耗时: {total_time:.2f}s, 加速比: {result['summary']['performance']['speedup_ratio']}")
            return result
            
        except Exception as e:
            logger.error(f"❌ 多模态分析失败: {e}")
            logger.error(traceback.format_exc())
            # 返回错误结果
            return {
                "segments": [],
                "summary": {
                    "total_duration": 0,
                    "segment_count": 0,
                    "error": str(e),
                    "performance": {
                        "total_time_s": time.time() - start_time,
                        "status": "failed"
                    }
                }
            }
    
    def _precompute_audio(self, audio_path: str) -> Dict:
        """P0: 预计算音频特征（修复版）"""
        logger.info("🔊 预计算音频特征...")
        
        try:
            # 使用轻量级探测器预计算基础特征
            audio_features = self.detector.precompute_audio_features(audio_path)
            
            # 预计算VAD信息
            if self.pause_detector:
                vad_info = self._precompute_vad(audio_path)
                audio_features["vad"] = vad_info
                
            # 获取时长（避免重复加载音频）
            duration = self._get_audio_duration(audio_path)
            audio_features["duration"] = duration
            
            # 如果需要缓存原始音频
            if HAS_LIBROSA:
                y, sr = librosa.load(audio_path, sr=None)
                audio_features["raw_audio"] = (y, sr)
            
            self._precomputed_audio = audio_features
            return audio_features
            
        except Exception as e:
            logger.error(f"音频预计算失败: {e}")
            # 返回默认音频特征
            return {
                "duration": 30.0,
                "features": {},
                "error": str(e)
            }
    
    def _precompute_video(self, video_path: str) -> Dict:
        """P0: 预计算视频特征（稀疏采样，修复版）"""
        logger.info("📹 预计算视频特征...")
        
        cap = None
        try:
            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                raise ValueError(f"无法打开视频文件: {video_path}")
                
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            duration = total_frames / fps if fps > 0 else 0
            
            # 稀疏采样：每1秒采样一帧（提高效率）
            sample_interval = max(int(fps * 1.0), 1) if fps > 0 else 30
            face_cache = {}
            
            for frame_idx in range(0, total_frames, sample_interval):
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
                ret, frame = cap.read()
                if not ret:
                    break
                    
                timestamp = frame_idx / fps if fps > 0 else frame_idx / 30
                
                # 快速人脸检测+特征提取
                face_features = self._extract_face_features_fast(frame)
                if face_features is not None:
                    face_cache[timestamp] = face_features
                    
            video_features = {
                "face_cache": face_cache,
                "fps": fps,
                "total_frames": total_frames,
                "duration": duration
            }
            
            self._precomputed_face_cache = face_cache
            logger.info(f"✅ 预计算视频特征完成，采样{len(face_cache)}个关键帧")
            return video_features
            
        except Exception as e:
            logger.error(f"视频预计算失败: {e}")
            return {
                "face_cache": {},
                "fps": 30,
                "total_frames": 0,
                "duration": 0,
                "error": str(e)
            }
        finally:
            if cap is not None:
                cap.release()
    
    def _precompute_vad(self, audio_path: str) -> Dict:
        """P0: 预计算VAD信息"""
        logger.info("🎙️ 预计算VAD信息...")
        
        try:
            result = self.pause_detector.detect_pauses_from_file(audio_path)
            speech_segments = result['speech_segments']
            pause_segments = result['pause_segments']
            
            vad_info = {
                "speech_segments": speech_segments,
                "pause_segments": pause_segments,
                "timeline": self._build_vad_timeline(speech_segments, pause_segments)
            }
            
            self._precomputed_vad = vad_info
            return vad_info
            
        except Exception as e:
            logger.error(f"VAD预计算失败: {e}")
            return {
                "speech_segments": [],
                "pause_segments": [],
                "timeline": {}
            }
    
    def _run_asr_segmentation(self, audio_path: str) -> List[Dict]:
        """P1: ASR分段（可并行执行）"""
        logger.info("🗣️ P1: 执行ASR分段...")
        
        try:
            segments = self.asr_client.transcribe_and_segment(audio_path)
            logger.info(f"✅ ASR分段完成，获得{len(segments)}个初始段落")
            return segments
        except Exception as e:
            logger.warning(f"ASR分段失败: {e}，使用VAD兜底")
            return self._fallback_vad_segmentation(audio_path)
    
    def _process_segments_event_driven(self, asr_segments: List[Dict], video_path: str, 
                                     audio_path: str, precomputed_audio: Dict, 
                                     precomputed_video: Dict) -> List[Dict]:
        """P2: 事件驱动的段落处理（完全修复版）"""
        logger.info("🎯 开始事件驱动处理...")
        
        processed_segments = []
        analysis_window = self.CFG["analysis_window_s"]
        
        # 🔧 修复1: 初始化 total_end_s，避免 UnboundLocalError
        total_end_s = 0.0
        
        # 🔧 修复2: 处理空段落列表的情况
        if not asr_segments:
            logger.warning("⚠️ ASR段落列表为空，使用音频总时长")
            total_end_s = precomputed_audio.get("duration", 0.0)
            self.cache.cleanup_old_cache(total_end_s, self.CFG["cache_max_age_s"])
            return processed_segments
        
        try:
            for seg_idx, asr_seg in enumerate(asr_segments):
                start_ms = asr_seg.get("start_ms", 0)
                end_ms = asr_seg.get("end_ms", start_ms + 3000)
                start_s = start_ms / 1000.0
                end_s = end_ms / 1000.0
                
                # 🔧 修复3: 跟踪最大结束时间
                total_end_s = max(total_end_s, end_s)
                
                logger.info(f"处理段落 {seg_idx+1}/{len(asr_segments)}: {start_s:.2f}-{end_s:.2f}s")
                
                try:
                    # 检查是否超长需要VAD细分
                    if ((end_s - start_s) > self.CFG["max_segment_s"] or 
                        len(asr_seg.get("text", "")) > self.CFG["max_chars"]):
                        sub_segments = self._vad_split_segment_cached(start_s, end_s, asr_seg)
                    else:
                        sub_segments = [asr_seg]
                    
                    # 处理每个子段落
                    for sub_seg in sub_segments:
                        sub_start_s = sub_seg.get("start_ms", 0) / 1000.0
                        sub_end_s = sub_seg.get("end_ms", sub_start_s * 1000 + 3000) / 1000.0
                        
                        # 🔧 修复4: 更新总结束时间
                        total_end_s = max(total_end_s, sub_end_s)
                        
                        try:
                            # **事件驱动检测**
                            events = self._detect_events_in_segment(
                                sub_start_s, sub_end_s, video_path, precomputed_audio, precomputed_video
                            )
                            
                            trigger_info = self.detector.should_trigger_analysis(events, sub_start_s)
                            
                            # 根据触发结果决定处理策略
                            if trigger_info["should_trigger"]:
                                logger.info(f"🔥 触发重运算 {sub_start_s:.2f}s: {trigger_info['reasons']}")
                                # 执行完整分析并缓存
                                segment_result = self._analyze_segment_full(
                                    sub_seg, audio_path, video_path, sub_start_s, sub_end_s
                                )
                                self._cache_segment_features(sub_start_s, segment_result)
                            else:
                                logger.info(f"📋 使用缓存插值 {sub_start_s:.2f}s")
                                # 使用缓存插值
                                segment_result = self._analyze_segment_cached(
                                    sub_seg, sub_start_s, sub_end_s
                                )
                            
                            processed_segments.append(segment_result)
                            
                        except Exception as e:
                            logger.error(f"❌ 处理子段落 {sub_start_s:.2f}-{sub_end_s:.2f}s 失败: {e}")
                            # 🔧 修复5: 添加容错机制，创建默认段落
                            default_segment = self._create_default_segment(sub_seg, sub_start_s, sub_end_s)
                            processed_segments.append(default_segment)
                            
                except Exception as e:
                    logger.error(f"❌ 处理段落 {seg_idx+1} 失败: {e}")
                    # 创建默认段落继续处理
                    default_segment = self._create_default_segment(asr_seg, start_s, end_s)
                    processed_segments.append(default_segment)
        
        except Exception as e:
            logger.error(f"❌ 段落处理循环失败: {e}")
            logger.error(traceback.format_exc())
        
        # 🔧 修复6: 使用正确的变量名进行清理
        logger.info(f"🧹 清理缓存，总时长: {total_end_s:.2f}s")
        try:
            self.cache.cleanup_old_cache(total_end_s, self.CFG["cache_max_age_s"])
        except Exception as e:
            logger.warning(f"缓存清理失败: {e}")
        
        return processed_segments
    
    def _detect_events_in_segment(self, start_s: float, end_s: float, video_path: str,
                                precomputed_audio: Dict, precomputed_video: Dict) -> List[Dict]:
        """检测段落内的事件"""
        events = []
        
        try:
            # 检测音频事件
            audio_events = self.detector.detect_audio_events(precomputed_audio, start_s, end_s)
            events.extend(audio_events)
            
            # 检测视频事件（转换为帧）
            fps = precomputed_video.get("fps", 30)
            start_frame = int(start_s * fps)
            end_frame = int(end_s * fps)
            video_events = self.detector.detect_video_events(video_path, start_frame, end_frame)
            events.extend(video_events)
            
        except Exception as e:
            logger.warning(f"事件检测失败: {e}")
        
        return events
    
    def _analyze_segment_full(self, segment: Dict, audio_path: str, video_path: str,
                            start_s: float, end_s: float) -> Dict:
        """执行完整的段落分析"""
        start_ms = int(start_s * 1000)
        end_ms = int(end_s * 1000)
        
        try:
            # 韵律分析
            if hasattr(self.prosody_analyzer, 'analyze_segment'):
                sound_features = self.prosody_analyzer.analyze_segment(
                    audio_path, start_ms, end_ms, n_points=self.CFG["prosody_points"]
                )
            else:
                sound_features = MockProsodyAnalyzer.analyze_segment(
                    audio_path, start_ms, end_ms, self.CFG["prosody_points"]
                )
            
            # 面部分析
            if hasattr(self.facial_analyzer, 'analyze_segment'):
                face_features = self.facial_analyzer.analyze_segment(video_path, start_ms, end_ms)
            else:
                face_features = MockFacialAnalyzer.analyze_segment(video_path, start_ms, end_ms)
            
        except Exception as e:
            logger.error(f"完整分析失败: {e}")
            sound_features = self._get_default_sound_features()
            face_features = self._get_default_face_features()
        
        # 构建结果
        result = {
            "segment_id": f"seg_{start_ms:06d}_{end_ms:06d}",
            "word": segment.get("text", ""),
            "start_ms": start_ms,
            "end_ms": end_ms,
            "sound": sound_features,
            "face": face_features,
            "meta": {
                "schema_version": "1.2.0",
                "source": segment.get("source", "ASR_PUNCT"),
                "fallback_vad": False,
                "original_punct": segment.get("punct", ""),
                "analysis_mode": "full_compute"
            }
        }
        
        return result
    
    def _analyze_segment_cached(self, segment: Dict, start_s: float, end_s: float) -> Dict:
        """使用缓存插值分析段落"""
        start_ms = int(start_s * 1000)
        end_ms = int(end_s * 1000)
        
        # 从缓存获取插值特征
        sound_features = self.cache.get_interpolated_audio(start_s, self.CFG["prosody_points"])
        face_features = self.cache.get_interpolated_video(start_s)
        
        # 如果缓存为空，使用默认值
        if sound_features is None:
            sound_features = self._get_default_sound_features()
        if face_features is None:
            face_features = self._get_default_face_features()
        
        result = {
            "segment_id": f"seg_{start_ms:06d}_{end_ms:06d}",
            "word": segment.get("text", ""),
            "start_ms": start_ms,
            "end_ms": end_ms,
            "sound": sound_features,
            "face": face_features,
            "meta": {
                "schema_version": "1.2.0",
                "source": segment.get("source", "ASR_PUNCT"),
                "fallback_vad": False,
                "original_punct": segment.get("punct", ""),
                "analysis_mode": "cached_interpolation"
            }
        }
        
        return result
    
    def _create_default_segment(self, segment: Dict, start_s: float, end_s: float) -> Dict:
        """🔧 新增: 创建默认段落（容错机制）"""
        start_ms = int(start_s * 1000)
        end_ms = int(end_s * 1000)
        
        return {
            "segment_id": f"seg_{start_ms:06d}_{end_ms:06d}",
            "word": segment.get("text", "处理失败的段落"),
            "start_ms": start_ms,
            "end_ms": end_ms,
            "sound": self._get_default_sound_features(),
            "face": self._get_default_face_features(),
            "meta": {
                "schema_version": "1.2.0",
                "source": segment.get("source", "ERROR_FALLBACK"),
                "fallback_vad": False,
                "original_punct": segment.get("punct", ""),
                "analysis_mode": "error_fallback"
            }
        }
    
    def _cache_segment_features(self, timestamp: float, segment_result: Dict):
        """缓存段落特征"""
        try:
            sound_features = segment_result.get("sound", {})
            face_features = segment_result.get("face", {})
            
            if sound_features:
                self.cache.store_audio_features(timestamp, {"sound": sound_features})
            if face_features:
                self.cache.store_video_features(timestamp, {"face": face_features})
        except Exception as e:
            logger.warning(f"特征缓存失败: {e}")
    
    def _vad_split_segment_cached(self, start_s: float, end_s: float, segment: Dict) -> List[Dict]:
        """使用预计算的VAD信息分割长段落"""
        if not self._precomputed_vad:
            return [segment]
        
        try:
            vad_timeline = self._precomputed_vad["timeline"]
            
            # 在VAD时间线中找到分割点
            split_points = []
            for t, vad_type in vad_timeline.items():
                if start_s < t < end_s and vad_type == "pause":
                    split_points.append(t)
            
            if not split_points:
                return [segment]
            
            # 创建子段落
            sub_segments = []
            prev_start = start_s
            
            for split_point in split_points:
                if split_point - prev_start > 1.0:  # 至少1秒
                    sub_seg = segment.copy()
                    sub_seg["start_ms"] = int(prev_start * 1000)
                    sub_seg["end_ms"] = int(split_point * 1000)
                    sub_seg["source"] = "VAD_SPLIT"
                    sub_segments.append(sub_seg)
                    prev_start = split_point
            
            # 最后一段
            if end_s - prev_start > 1.0:
                sub_seg = segment.copy()
                sub_seg["start_ms"] = int(prev_start * 1000)
                sub_seg["end_ms"] = int(end_s * 1000)
                sub_seg["source"] = "VAD_SPLIT"
                sub_segments.append(sub_seg)
            
            return sub_segments
            
        except Exception as e:
            logger.warning(f"VAD分割失败: {e}")
            return [segment]
    
    def _extract_face_features_fast(self, frame: np.ndarray) -> Optional[Dict]:
        """快速提取人脸特征（简化版）"""
        if self.face_cascade is None:
            return None
            
        try:
            # 缩小帧以提高速度
            small_frame = cv2.resize(frame, (320, 240))
            
            # 使用已初始化的级联分类器
            faces = self.face_cascade.detectMultiScale(small_frame, 1.1, 4)
            
            if len(faces) == 0:
                return None
            
            # 简化特征：只提取基础信息
            (x, y, w, h) = faces[0]  # 使用第一个人脸
            
            # 计算基础特征
            face_center_x = (x + w/2) / small_frame.shape[1]
            face_center_y = (y + h/2) / small_frame.shape[0]
            face_size = (w * h) / (small_frame.shape[0] * small_frame.shape[1])
            
            # 简化的特征字典（mean, std格式）
            features = {
                "Smile": [0.5, 0.1],      # 默认值，需要实际计算
                "Mouth": [0.3, 0.1], 
                "EAR": [0.25, 0.05],
                "Brow": [0.1, 0.02],
                "Yaw": [face_center_x * 20 - 10, 2.0],
                "Pitch": [face_center_y * 20 - 10, 2.0],
                "Roll": [0.0, 1.0],
                "FaceSize": [face_size, 0.1]
            }
            
            return features
            
        except Exception as e:
            logger.warning(f"快速人脸特征提取失败: {e}")
            return None
    
    def _get_default_sound_features(self) -> Dict:
        """获取默认音频特征"""
        n_points = self.CFG["prosody_points"]
        return {
            "pitch": [0.0] * n_points,
            "rate": [0.0] * n_points, 
            "level": [0.0] * n_points
        }
    
    def _get_default_face_features(self) -> Dict:
        """获取默认面部特征"""
        return {
            "Smile": [0.0, 0.0],
            "Mouth": [0.0, 0.0],
            "EAR": [0.0, 0.0],
            "Brow": [0.0, 0.0],
            "Yaw": [0.0, 0.0],
            "Pitch": [0.0, 0.0],
            "Roll": [0.0, 0.0]
        }
    
    def _build_vad_timeline(self, speech_segments: List, pause_segments: List) -> Dict:
        """构建VAD时间线（优化版）"""
        timeline = {}
        
        try:
            # 降低时间线精度以节省内存（从0.1s改为0.5s）
            time_step = 0.5
            
            for speech_seg in speech_segments:
                start = speech_seg['start_time']
                end = speech_seg['end_time']
                for t in np.arange(start, end, time_step):
                    timeline[round(t, 1)] = "speech"
            
            for pause_seg in pause_segments:
                start = pause_seg['start_time']
                end = pause_seg['end_time']
                for t in np.arange(start, end, time_step):
                    timeline[round(t, 1)] = "pause"
                    
        except Exception as e:
            logger.warning(f"VAD时间线构建失败: {e}")
                
        return timeline
    
    def _get_audio_duration(self, audio_path: str) -> float:
        """获取音频时长（避免重复加载）"""
        try:
            if HAS_LIBROSA:
                y, sr = librosa.load(audio_path, sr=None)
                return len(y) / sr
            else:
                # 使用ffprobe获取时长
                return self._get_duration_ffprobe(audio_path)
        except Exception as e:
            logger.warning(f"获取音频时长失败: {e}")
            return 30.0  # 默认30秒
    
    def _get_duration_ffprobe(self, audio_path: str) -> float:
        """使用ffprobe获取音频时长"""
        try:
            cmd = [
                'ffprobe', '-i', audio_path, '-show_entries', 
                'format=duration', '-v', 'quiet', '-of', 'csv=p=0'
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=10)
            return float(result.stdout.strip())
        except Exception as e:
            logger.warning(f"ffprobe获取时长失败: {e}")
            return 30.0
    
    def _extract_audio(self, video_path: str) -> str:
        """从视频提取音频"""
        logger.info("🎬 从视频提取音频...")
        audio_path = video_path.rsplit('.', 1)[0] + "_extracted.wav"
        
        # 检查是否已存在
        if os.path.exists(audio_path):
            logger.info(f"音频文件已存在: {audio_path}")
            return audio_path
        
        try:
            # 先验证视频文件
            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                raise ValueError(f"无法打开视频文件: {video_path}")
            cap.release()
            
            # 使用ffmpeg提取音频
            cmd = [
                "ffmpeg", "-i", video_path, "-acodec", "pcm_s16le", 
                "-ar", "16000", "-ac", "1", "-y", audio_path
            ]
            
            result = subprocess.run(cmd, check=True, capture_output=True, timeout=60)
            logger.info(f"✅ 音频提取完成: {audio_path}")
            return audio_path
            
        except subprocess.TimeoutExpired:
            logger.error("音频提取超时")
            raise
        except subprocess.CalledProcessError as e:
            logger.error(f"音频提取失败: {e}")
            logger.error(f"stderr: {e.stderr.decode() if e.stderr else 'No error message'}")
            raise
        except Exception as e:
            logger.error(f"音频提取失败: {e}")
            raise
    
    def _fallback_vad_segmentation(self, audio_path: str) -> List[Dict]:
        """VAD兜底分段"""
        logger.info("🔄 使用VAD兜底分段...")
        
        try:
            if not self.pause_detector:
                # 创建默认段落
                duration = self._get_audio_duration(audio_path)
                return [{
                    "text": "无法识别音频内容",
                    "start_ms": 0,
                    "end_ms": int(duration * 1000),
                    "source": "FALLBACK"
                }]
            
            result = self.pause_detector.detect_pauses_from_file(audio_path)
            speech_segments = result['speech_segments']
            
            segments = []
            for i, speech_seg in enumerate(speech_segments):
                segments.append({
                    "text": f"语音段落{i+1}",
                    "start_ms": int(speech_seg['start_time'] * 1000),
                    "end_ms": int(speech_seg['end_time'] * 1000), 
                    "source": "VAD_FALLBACK"
                })
            
            return segments
            
        except Exception as e:
            logger.error(f"VAD兜底分段失败: {e}")
            # 最终兜底：创建单个默认段落
            duration = self._get_audio_duration(audio_path)
            return [{
                "text": "分段失败，使用整个音频",
                "start_ms": 0,
                "end_ms": int(duration * 1000),
                "source": "ULTIMATE_FALLBACK"
            }]


# =============================================================================
# 便利函数和测试接口
# =============================================================================

def create_analyzer(api_key: str = None, **kwargs) -> MultiModalAnalyzer_Optimized:
    """便利函数：创建分析器实例"""
    return MultiModalAnalyzer_Optimized(api_key=api_key, **kwargs)

def analyze_video(video_path: str, api_key: str = None, **kwargs) -> Dict:
    """便利函数：直接分析视频"""
    analyzer = create_analyzer(api_key, **kwargs)
    return analyzer.analyze_video_audio(video_path, extract_audio=True)

if __name__ == "__main__":
    # 简单测试
    import sys
    
    if len(sys.argv) < 2:
        print("用法: python MultiModalAnalyzer_Optimized.py <视频文件路径>")
        sys.exit(1)
    
    video_path = sys.argv[1]
    
    try:
        print("🚀 开始分析...")
        result = analyze_video(video_path)
        
        print(f"✅ 分析完成!")
        print(f"   总时长: {result['summary']['total_duration']:.2f}s")
        print(f"   段落数: {result['summary']['segment_count']}")
        print(f"   处理时间: {result['summary']['performance']['total_time_s']:.2f}s")
        print(f"   加速比: {result['summary']['performance']['speedup_ratio']}")
        
        # 保存结果
        output_path = video_path.rsplit('.', 1)[0] + "_analysis_result.json"
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        
        print(f"📄 结果已保存到: {output_path}")
        
    except Exception as e:
        print(f"❌ 分析失败: {e}")
        traceback.print_exc()
        sys.exit(1)