const WebSocket = require('ws');
const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 8080;
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;

if (!DASHSCOPE_API_KEY) {
  console.error('❌ DASHSCOPE_API_KEY environment variable is required');
  process.exit(1);
}

// 创建HTTP服务器
const server = http.createServer();

// 创建WebSocket服务器
const wss = new WebSocket.Server({ 
  server,
  path: '/ali-asr'
});

function connectToAli() {
  // ✅ 修正：使用正确的 NLS 网关 + token 认证
  const aliUrl = `wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1?token=${encodeURIComponent(DASHSCOPE_API_KEY)}`;
  
  console.log('🔗 Connecting to Alibaba ASR...');
  aliWs = new WebSocket(aliUrl);

  aliWs.on('open', function() {
    console.log('✅ Connected to Alibaba ASR');
    isConnected = true;
  });

  aliWs.on('message', function(data) {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
    }
  });

  aliWs.on('error', function(error) {
    console.error('❌ Alibaba WebSocket error:', error);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({
        header: { event: 'task-failed' },
        payload: { message: 'Proxy connection error: ' + error.message }
      }));
    }
  });

  aliWs.on('close', function(code, reason) {
    console.log('🔌 Alibaba WebSocket closed:', code, reason?.toString());
    isConnected = false;
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1000, 'Upstream connection closed');
    }
  });
}