import { useState, useEffect, useRef } from 'react';
import { checkBrowserSupport } from './utils';
import { globalEventBus } from './events/EventBus';
import { MediaCapture } from './media/MediaCapture';
import type { MultiModalEvent } from './types';
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
  
  const mediaCaptureRef = useRef<MediaCapture | null>(null);
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
      // 初始化MediaCapture
      mediaCaptureRef.current = new MediaCapture(globalEventBus);
      
      // 订阅所有事件用于调试和UI更新
      const unsubscribe = globalEventBus.subscribe('all', (event) => {
        // setEvents(prev => [...prev.slice(-9), event]); // 保留最近10个事件
        
        // 根据事件类型更新UI数据
        if (event.type === 'face') {
          setFaceMetrics({
            headPose: {
              yaw: event.pose.yaw,
              pitch: event.pose.pitch
            },
            expression: {
              type: String(event.expr.type),
              confidence: Math.round(event.expr.confidence * 100)
            },
            eyeState: {
              state: String(event.expr.type) === '疲劳' ? '疲劳' : '正常',
              ear: event.expr.ear || 0.30
            },
            faceStability: {
              state: event.deltaScore > 0.6 ? '不稳定' : '稳定',
              score: Math.round((1 - event.deltaScore) * 100)
            }
          });
        }
        
        if (event.type === 'prosody') {
          setSpeechMetrics({
            frequency: {
              value: event.f0,
              change: Math.floor(Math.random() * 20 - 10) // 模拟变化
            },
            energy: {
              value: event.rms,
              activity: event.rms > 0.1 ? '说话中' : '静默'
            },
            wpm: {
              value: event.wpm,
              zeroCrossing: Math.random() * 2
            },
            quality: {
              state: event.rms > 0.2 ? '异常' : '正常',
              spectralCentroid: Math.floor(Math.random() * 2000)
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
      console.log('🚀 Starting multimodal demo...');
      
      // 初始化媒体采集
      await mediaCaptureRef.current.initialize();
      
      // 设置视频预览
      const previewElement = mediaCaptureRef.current.getPreviewElement();
      if (previewElement && videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = previewElement.srcObject;
      }
      
      // 开始采集
      await mediaCaptureRef.current.startCapture();
      
      // 更新状态
      setIsCapturing(true);
      const status = mediaCaptureRef.current.getStatus();
      setMediaStatus({
        hasVideo: status.hasVideo,
        hasAudio: status.hasAudio,
        audioContextState: status.audioContextState || 'suspended'
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
      hasVideo: status.hasVideo,
      hasAudio: status.hasAudio,
      audioContextState: status.audioContextState || 'suspended'
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
              />
              <div className="video-overlay">
                {!isCapturing && <div>点击开始预览</div>}
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
