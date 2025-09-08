/**
 * ASR工具函数 - 用于检查和调试语音识别状态
 */

export function checkGummyASRSupport(): {
  isSecureContext: boolean;
  hasApiKey: boolean;
  browserInfo: string;
  recommendations: string[];
} {
  const isSecureContext = window.isSecureContext;
  const hasApiKey = !!(import.meta.env?.VITE_ALIBABA_API_KEY || import.meta.env?.VITE_DASHSCOPE_API_KEY);
  
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
  
  if (!hasApiKey) {
    recommendations.push('请配置阿里云API密钥：设置VITE_ALIBABA_API_KEY或VITE_DASHSCOPE_API_KEY环境变量');
  }
  
  if (!isSecureContext) {
    recommendations.push('请使用HTTPS协议或localhost访问');
  }
  
  return {
    isSecureContext,
    hasApiKey,
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