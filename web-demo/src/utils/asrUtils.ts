/**
 * ASR工具函数 - 用于检查和调试语音识别状态
 */

export function checkASRSupport(): {
  webSpeechSupported: boolean;
  isSecureContext: boolean;
  browserInfo: string;
  recommendations: string[];
} {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const webSpeechSupported = !!SpeechRecognition;
  const isSecureContext = window.isSecureContext;
  
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
  
  const recommendations: string[] = [];
  
  if (!webSpeechSupported) {
    recommendations.push('请使用Chrome、Edge或其他支持Web Speech API的浏览器');
  }
  
  if (!isSecureContext) {
    recommendations.push('请使用HTTPS协议或localhost访问');
  }
  
  if (browserInfo === 'Firefox') {
    recommendations.push('Firefox对Web Speech API支持有限，建议使用Chrome');
  }
  
  if (browserInfo === 'Safari') {
    recommendations.push('Safari的Web Speech API支持可能不完整，建议使用Chrome');
  }
  
  return {
    webSpeechSupported,
    isSecureContext,
    browserInfo,
    recommendations
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
  console.group('🔍 ASR诊断信息');
  
  const support = checkASRSupport();
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