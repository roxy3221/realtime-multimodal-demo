import { useState, useEffect, useRef } from 'react';
import { checkBrowserSupport } from './utils';
import { globalEventBus } from './events/EventBus';
import { SimpleMediaCapture } from './media/SimpleMediaCapture';
import type { MultiModalEvent, ProsodyEvent } from './types';
import './App.css';

function App() {
  const [isSupported, setIsSupported] = useState(false);
  const [, setEvents] = useState([] as MultiModalEvent[]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [mediaStatus, setMediaStatus] = useState({
    hasVideo: false,
    hasAudio: false,
    audioContextState: 'suspended' as AudioContextState
  });
  
  // 新增状态
  const [faceMetrics, setFaceMetrics] = useState({
    headPose: { yaw: 0, pitch: 0 },
    expression: { type: '中性', confidence: 0 },
    eyeState: { state: '正常', ear: 0.30 },
    faceStability: { state: '稳定', score: 100 }
  });
  
  const [speechMetrics, setSpeechMetrics] = useState({
    frequency: { value: 0, change: 0 },
    energy: { value: 0.00, activity: '静默' },
    wpm: { value: 0, zeroCrossing: 0.0 },
    quality: { state: '正常', spectralCentroid: 0 }
  });
  
  const [features, setFeatures] = useState({
    faceDetection: false,
    prosodyAnalysis: false,
    realtimeChart: false
  });

  // ASR状态
  const [transcriptText, setTranscriptText] = useState('');
  const [currentWPM, setCurrentWPM] = useState(0);
  
  const mediaCaptureRef = useRef<SimpleMediaCapture | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    // 检查浏览器支持
    const support = checkBrowserSupport();
    const criticalSupported = support.webWorkers && support.broadcastChannel;
    setIsSupported(criticalSupported);

    console.log('🔍 Browser support check:', support);
    if (!criticalSupported) {
      console.warn('⚠️ Some features may not work due to browser limitations');
    }

    if (criticalSupported) {
      // 初始化SimpleMediaCapture
      mediaCaptureRef.current = new SimpleMediaCapture(globalEventBus);
      
      // 订阅所有事件用于调试和UI更新
      const unsubscribe = globalEventBus.subscribe('all', (event) => {
        // setEvents(prev => [...prev.slice(-9), event]); // 保留最近10个事件
        
        // 根据事件类型更新UI数据
        if (event.type === 'face') {
          console.log('🎭 Face event received:', event);
          setFaceMetrics({
            headPose: {
              yaw: event.pose.yaw,
              pitch: event.pose.pitch
            },
            expression: {
              type: String(event.expression?.type || '中性'),
              confidence: Math.round((event.confidence || 0) * 100)
            },
            eyeState: {
              state: String(event.expression?.type) === '疲劳' ? '疲劳' : '正常',
              ear: event.expression?.ear || 0.30
            },
            faceStability: {
              state: event.deltaScore > 0.6 ? '不稳定' : '稳定',
              score: Math.round((1 - event.deltaScore) * 100)
            }
          });
        }
        
        if (event.type === 'prosody') {
          // WebRTC优化的prosody事件处理
          const prosodyEvent = event as ProsodyEvent;
          
          setSpeechMetrics({
            frequency: {
              value: Math.round(prosodyEvent.f0 || 0), // 格式化为整数Hz
              change: prosodyEvent.f0Stability ? Math.round((1 - prosodyEvent.f0Stability) * 100) : 0
            },
            energy: {
              value: Number((prosodyEvent.rms || 0).toFixed(3)), // 3位小数
              activity: prosodyEvent.vadActive ? '说话中' : '静默'
            },
            wpm: {
              value: prosodyEvent.wpm || 0,
              zeroCrossing: Number((prosodyEvent.zeroCrossingRate || 0).toFixed(2))
            },
            quality: {
              state: (prosodyEvent.f0Stability && prosodyEvent.f0Stability > 0.5) ? '正常' : '不稳定',
              spectralCentroid: Math.round(prosodyEvent.spectralCentroid || 0)
            }
          });
        }

        if (event.type === 'asr') {
          // 更新转录文本
          setTranscriptText(prev => prev + event.textDelta + ' ');
          
          // 更新语速
          if (event.currentWPM !== undefined) {
            setCurrentWPM(event.currentWPM);
            setSpeechMetrics(prev => ({
              ...prev,
              wpm: {
                value: event.currentWPM || 0,
                zeroCrossing: prev.wpm.zeroCrossing
              }
            }));
          }
        }
      });

      setIsInitialized(true);

      return () => {
        unsubscribe();
        if (mediaCaptureRef.current) {
          mediaCaptureRef.current.dispose();
        }
      };
    }
  }, []);

  const handleStartDemo = async () => {
    if (!mediaCaptureRef.current) return;
    
    try {
      console.log('🚀 Starting WebRTC multimodal demo...');
      
      // WebRTC初始化（包含设备检查和优化）
      await mediaCaptureRef.current.initialize();
      
      // 设置视频预览 - 改进的稳定方式
      const stream = mediaCaptureRef.current.getStream();
      
      if (stream && videoPreviewRef.current) {
        console.log('🎥 Setting up video preview with stream:', stream);
        
        const video = videoPreviewRef.current;
        
        // 将video元素注册到MediaCapture
        mediaCaptureRef.current.setExternalVideoElement(video);
        
        // 先设置属性，再设置stream
        video.muted = true;
        video.setAttribute('playsinline', 'true');
        video.autoplay = true;
        video.srcObject = stream;
        
        // 等待视频metadata加载完成
        await new Promise<void>((resolve) => {
          if (video.readyState >= 2) {
            resolve();
          } else {
            video.onloadedmetadata = () => {
              console.log('✅ Video metadata loaded:', {
                width: video.videoWidth,
                height: video.videoHeight,
                readyState: video.readyState
              });
              resolve();
            };
          }
        });
        
        // 在用户手势上下文中播放视频
        try {
          await video.play();
          console.log('✅ Video playback started successfully');
        } catch (playError) {
          console.warn('⚠️ Video autoplay failed (expected for browser security):', playError);
          // 这是正常的，用户点击后会自动播放
        }
        
        // 添加错误处理
        video.onerror = (e) => {
          console.error('❌ Video preview error:', e);
        };
      } else {
        console.warn('⚠️ No stream or video ref available');
      }
      
      // 开始采集
      await mediaCaptureRef.current.startCapture(videoPreviewRef.current || undefined);
      
      // 更新状态
      setIsCapturing(true);
      const status = mediaCaptureRef.current.getStatus();
      setMediaStatus({
        hasVideo: !!status.hasVideo,
        hasAudio: !!status.hasAudio,
        audioContextState: status.audioContextState
      });
      
      console.log('✅ Demo started successfully');
    } catch (error) {
      console.error('❌ Demo start failed:', error);
      alert(`启动失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleStopDemo = () => {
    if (!mediaCaptureRef.current) return;
    
    mediaCaptureRef.current.stopCapture();
    setIsCapturing(false);
    const status = mediaCaptureRef.current.getStatus();
    setMediaStatus({
      hasVideo: !!status.hasVideo,
      hasAudio: !!status.hasAudio,
      audioContextState: status.audioContextState
    });
    
    console.log('⏹️ Demo stopped');
  };

  const handleReset = () => {
    setFaceMetrics({
      headPose: { yaw: 0, pitch: 0 },
      expression: { type: '中性', confidence: 0 },
      eyeState: { state: '正常', ear: 0.30 },
      faceStability: { state: '稳定', score: 100 }
    });
    
    setSpeechMetrics({
      frequency: { value: 0, change: 0 },
      energy: { value: 0.00, activity: '静默' },
      wpm: { value: 0, zeroCrossing: 0.0 },
      quality: { state: '正常', spectralCentroid: 0 }
    });
    
    setEvents([]);
    setTranscriptText('');
    setCurrentWPM(0);
  };

  const toggleFeature = (feature: keyof typeof features) => {
    setFeatures(prev => ({
      ...prev,
      [feature]: !prev[feature]
    }));
  };

  if (!isSupported) {
    return (
      <div className="app">
        <h1>⚠️ 浏览器功能受限</h1>
        <p>部分高级功能可能无法使用，但您仍可以查看界面演示。建议使用最新版Chrome、Firefox或Edge并启用HTTPS。</p>
        <details>
          <summary>详细支持情况</summary>
          <pre>{JSON.stringify(checkBrowserSupport(), null, 2)}</pre>
        </details>
        <p style={{ marginTop: '20px' }}>
          <button onClick={() => setIsSupported(true)} style={{ 
            padding: '10px 20px', 
            background: '#4CAF50', 
            color: 'white', 
            border: 'none', 
            borderRadius: '5px' 
          }}>
            仍要继续查看界面
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎯 实时多模态分析演示</h1>
        <p>基于事件驱动架构的智能触发系统</p>
      </header>

      <main className="app-main">
        {/* 顶部分析面板区域 */}
        <div className="analysis-panels">
          {/* 左侧面板：视频采集与面部分析 */}
          <div className="video-analysis-panel">
            <div className="panel-title">视频采集与面部分析</div>
            
            <div className="video-preview">
              <video 
                ref={videoPreviewRef}
                autoPlay
                muted
                playsInline
                className="preview-video"
                onClick={async (e) => {
                  // 确保视频在用户点击时播放（解决autoplay限制）
                  const video = e.currentTarget;
                  if (video.paused) {
                    try {
                      await video.play();
                      console.log('✅ Video started playing after user click');
                    } catch (err) {
                      console.warn('Failed to play video after click:', err);
                    }
                  }
                }}
              />
              <div className="video-overlay">
                {!isCapturing && <div>点击开始预览</div>}
                {isCapturing && !mediaStatus.hasVideo && <div>点击视频区域开始播放</div>}
              </div>
              <div className={`connection-status ${mediaStatus.hasVideo ? 'connected' : ''}`}>
                {mediaStatus.hasVideo ? '已连接' : '未连接'}
              </div>
            </div>
            
            <div className="face-metrics">
              <div className="metric-item">
                <div className="metric-value">{faceMetrics.headPose.yaw}°, {faceMetrics.headPose.pitch}°</div>
                <div className="metric-label">偏航角, 俯仰角</div>
              </div>
              <div className="metric-item">
                <div className="metric-value">{faceMetrics.expression.type}</div>
                <div className="metric-label">置信度: {faceMetrics.expression.confidence}%</div>
              </div>
              <div className="metric-item">
                <div className="metric-value">{faceMetrics.eyeState.state}</div>
                <div className="metric-label">EAR: {faceMetrics.eyeState.ear.toFixed(2)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-value">{faceMetrics.faceStability.state}</div>
                <div className="metric-label">得分: {faceMetrics.faceStability.score}%</div>
              </div>
            </div>
          </div>
          
          {/* 右侧面板：语音识别与韵律分析 */}
          <div className="speech-analysis-panel">
            <div className="panel-title">语音识别与韵律分析</div>
            
            <div className={`speech-input-status ${speechMetrics.energy.activity === '说话中' ? 'listening' : ''}`}>
              {speechMetrics.energy.activity === '说话中' ? '正在识别语音...' : '等待语音输入...'}
            </div>
            
            <div className="speech-metrics">
              <div className="metric-item">
                <div className="metric-value">{speechMetrics.frequency.value}</div>
                <div className="metric-label">变化: ±{speechMetrics.frequency.change}</div>
              </div>
              <div className="metric-item">
                <div className="metric-value">{speechMetrics.energy.value.toFixed(2)}</div>
                <div className="metric-label">活动: {speechMetrics.energy.activity}</div>
              </div>
              <div className="metric-item">
                <div className="metric-value">{speechMetrics.wpm.value}</div>
                <div className="metric-label">过零率: {speechMetrics.wpm.zeroCrossing.toFixed(1)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-value">{speechMetrics.quality.state}</div>
                <div className="metric-label">频谱重心: {speechMetrics.quality.spectralCentroid} Hz</div>
              </div>
            </div>
            
            {/* 实时转录显示 */}
            <div className="transcript-display">
              <div className="transcript-title">实时语音转录</div>
              <div className="transcript-content">
                {transcriptText || '等待语音输入...'}
              </div>
              <div className="transcript-stats">
                当前语速: {currentWPM} WPM
              </div>
            </div>
            
            {/* 实时图表区域 */}
            <div className="chart-container">
              <div className="chart-title">实时图表</div>
              <div className="chart-axes">时间</div>
              <div className="chart-legend">
                <div className="legend-item">
                  <div className="legend-color frequency"></div>
                  <span>基频 (Hz)</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color energy"></div>
                  <span>能量</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 控制按钮区域 */}
        <div className="controls">
          {!isCapturing ? (
            <button 
              className="start-button"
              onClick={handleStartDemo}
              disabled={!isInitialized}
            >
              开始分析
            </button>
          ) : (
            <button 
              className="stop-button"
              onClick={handleStopDemo}
            >
              停止分析
            </button>
          )}
          <button 
            className="reset-button"
            onClick={handleReset}
          >
            重置
          </button>
        </div>

        {/* 功能开关区域 */}
        <div className="feature-toggles">
          <div className="toggles-container">
            <div className="toggle-item">
              <span className="toggle-label">启用面部检测</span>
              <div 
                className={`toggle-switch ${features.faceDetection ? 'active' : ''}`}
                onClick={() => toggleFeature('faceDetection')}
              ></div>
            </div>
            <div className="toggle-item">
              <span className="toggle-label">启用韵律分析</span>
              <div 
                className={`toggle-switch ${features.prosodyAnalysis ? 'active' : ''}`}
                onClick={() => toggleFeature('prosodyAnalysis')}
              ></div>
            </div>
            <div className="toggle-item">
              <span className="toggle-label">显示实时图表</span>
              <div 
                className={`toggle-switch ${features.realtimeChart ? 'active' : ''}`}
                onClick={() => toggleFeature('realtimeChart')}
              ></div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
