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

console.log(`🚀 Ali ASR Proxy Server starting on port ${PORT}`);
console.log(`🔑 API Key configured: ${DASHSCOPE_API_KEY.substring(0, 8)}***`);

wss.on('connection', function connection(clientWs, request) {
  console.log('📱 Client connected from:', request.socket.remoteAddress);
  
  let aliWs = null;
  let isConnected = false;

  // 连接到阿里云ASR服务
  function connectToAli() {
    const aliUrl = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/';
    
    console.log('🔗 Connecting to Alibaba ASR...');
    aliWs = new WebSocket(aliUrl);

    aliWs.on('open', function() {
      console.log('✅ Connected to Alibaba ASR');
      isConnected = true;
    });

    aliWs.on('message', function(data) {
      // 转发阿里云的消息给客户端
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

  // 处理客户端消息
  clientWs.on('message', function(data) {
    try {
      const message = JSON.parse(data.toString());
      
      // 如果是run-task消息，需要添加认证头
      if (message.header && message.header.action === 'run-task') {
        console.log('🎯 Adding authorization to run-task message');
        message.header.authorization = `bearer ${DASHSCOPE_API_KEY}`;
      }
      
      // 转发到阿里云（如果连接可用）
      if (aliWs && aliWs.readyState === WebSocket.OPEN) {
        aliWs.send(JSON.stringify(message));
      } else if (!isConnected && !aliWs) {
        // 首次连接
        connectToAli();
        // 等待连接建立后再发送
        const checkConnection = () => {
          if (aliWs && aliWs.readyState === WebSocket.OPEN) {
            aliWs.send(JSON.stringify(message));
          } else if (aliWs && aliWs.readyState === WebSocket.CONNECTING) {
            setTimeout(checkConnection, 100);
          }
        };
        setTimeout(checkConnection, 100);
      }
      
    } catch (error) {
      console.error('❌ Error processing message:', error);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          header: { event: 'task-failed' },
          payload: { message: 'Message processing error: ' + error.message }
        }));
      }
    }
  });

  clientWs.on('close', function(code, reason) {
    console.log('📱 Client disconnected:', code, reason?.toString());
    if (aliWs) {
      aliWs.close();
    }
  });

  clientWs.on('error', function(error) {
    console.error('❌ Client WebSocket error:', error);
    if (aliWs) {
      aliWs.close();
    }
  });

  // 发送连接确认
  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(JSON.stringify({
      header: { event: 'proxy-connected' },
      payload: { message: 'Connected to Ali ASR proxy' }
    }));
  }
});

// 健康检查端点
server.on('request', (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  
  if (parsedUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      connections: wss.clients.size 
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Ali ASR Proxy Server - WebSocket endpoint: /ali-asr');
  }
});

server.listen(PORT, () => {
  console.log(`🎤 Ali ASR Proxy Server listening on port ${PORT}`);
  console.log(`📍 WebSocket endpoint: ws://localhost:${PORT}/ali-asr`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, closing server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, closing server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});