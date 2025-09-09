/**
 * ASR工具函数 - 用于检查和调试语音识别状态
 */

export function checkGummyASRSupport(): {
  isSecureContext: boolean;
  hasProxyUrl: boolean;
  browserInfo: string;
  recommendations: string[];
  canUseCloudASR: boolean;
  webSpeechSupported: boolean;
} {
  const isSecureContext = window.isSecureContext;
  const hasProxyUrl = !!(import.meta.env?.VITE_ALI_ASR_PROXY_URL);
  
  // 检测浏览器
  const userAgent = navigator.userAgent;
  let browserInfo = 'Unknown';
  if (userAgent.includes('Chrome')) {
    browserInfo = 'Chrome';
  } else if (userAgent.includes('Firefox')) {
    browserInfo = 'Firefox';
  } else if (userAgent.includes('Safari')) {
    browserInfo = 'Safari';
  } else if (userAgent.includes('Edge')) {
    browserInfo = 'Edge';
  }
  
  // 检查Web Speech API支持
  const webSpeechSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  
  // 通过代理服务器使用云端ASR
  const canUseCloudASR = hasProxyUrl && isSecureContext;
  
  const recommendations: string[] = [];
  
  if (!hasProxyUrl) {
    recommendations.push('请配置阿里云ASR代理服务器：设置VITE_ALI_ASR_PROXY_URL环境变量');
  }
  
  if (!isSecureContext) {
    recommendations.push('请使用HTTPS协议或localhost访问');
  }
  
  if (!canUseCloudASR && !webSpeechSupported) {
    recommendations.push('当前环境不支持语音识别，请检查代理服务器配置或使用Chrome浏览器');
  }
  
  return {
    isSecureContext,
    hasProxyUrl,
    browserInfo,
    recommendations,
    canUseCloudASR,
    webSpeechSupported
  };
}

export async function testMicrophonePermission(): Promise<{
  hasPermission: boolean;
  error?: string;
  devices?: MediaDeviceInfo[];
}> {
  try {
    // 检查是否有音频设备
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');
    
    if (audioInputs.length === 0) {
      return {
        hasPermission: false,
        error: '未找到音频输入设备',
        devices: audioInputs
      };
    }
    
    // 尝试获取麦克风权限
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop()); // 立即停止
    
    return {
      hasPermission: true,
      devices: audioInputs
    };
  } catch (error) {
    let errorMessage = '未知错误';
    
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        errorMessage = '麦克风权限被拒绝';
      } else if (error.name === 'NotFoundError') {
        errorMessage = '未找到麦克风设备';
      } else if (error.name === 'NotReadableError') {
        errorMessage = '麦克风被其他应用占用';
      } else {
        errorMessage = error.message;
      }
    }
    
    return {
      hasPermission: false,
      error: errorMessage
    };
  }
}

export function logASRDiagnostics(): void {
  console.group('🔍 Gummy ASR诊断信息');
  
  const support = checkGummyASRSupport();
  console.log('🌐 浏览器支持:', support);
  
  testMicrophonePermission().then(permission => {
    console.log('🎤 麦克风权限:', permission);
    
    if (support.recommendations.length > 0) {
      console.warn('💡 建议:', support.recommendations);
    }
    
    console.groupEnd();
  }).catch(err => {
    console.error('❌ 诊断过程出错:', err);
    console.groupEnd();
  });
}