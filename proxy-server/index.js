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

// 创建WebSocket服务器，监听 /ali-asr 路径
const wss = new WebSocket.Server({
  server,
  path: '/ali-asr'
});

// ✅ 声明全局变量，防止 ReferenceError
let aliWs = null;
let isConnected = false;
let clientWs = null;

console.log(`🚀 Ali ASR Proxy Server starting on port ${PORT}`);
console.log(`🔑 API Key configured: ${DASHSCOPE_API_KEY.substring(0, 8)}***`);

wss.on('connection', function connection(ws, request) {
  console.log('📱 Client connected from:', request.socket.remoteAddress);

  // ✅ 绑定当前客户端
  clientWs = ws;
  aliWs = null;
  isConnected = false;

  // 连接到阿里云ASR服务
  function connectToAli() {
    // ✅ 使用正确的 NLS 网关地址 + token 认证（上海区域）
    const aliUrl = `wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1?token=${encodeURIComponent(DASHSCOPE_API_KEY)}`;

    console.log('🔗 Connecting to Alibaba ASR...');
    aliWs = new WebSocket(aliUrl);

    aliWs.on('open', function () {
      console.log('✅ Connected to Alibaba ASR');
      isConnected = true;
    });

    aliWs.on('message', function (data) {
      // 转发阿里云的消息给客户端
      if (clientWs && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data);
      }
    });

    aliWs.on('error', function (error) {
      console.error('❌ Alibaba WebSocket error:', error.message || error);
      if (clientWs && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          header: { event: 'task-failed' },
          payload: { message: 'Proxy connection error: ' + (error.message || 'Unknown') }
        }));
      }
    });

    aliWs.on('close', function (code, reason) {
      console.log('🔌 Alibaba WebSocket closed:', code, reason?.toString() || 'No reason');
      isConnected = false;
      if (clientWs && clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1000, 'Upstream connection closed');
      }
    });
  }

  // 处理客户端消息
  clientWs.on('message', function (data) {
    try {
      const message = JSON.parse(data.toString());

      // 转发到阿里云（如果连接可用）
      if (aliWs && aliWs.readyState === WebSocket.OPEN) {
        aliWs.send(JSON.stringify(message));
      } else if (!isConnected) {
        // 首次连接或重连
        connectToAli();
        // 简单延迟后重试发送（生产环境建议用队列）
        setTimeout(() => {
          if (aliWs && aliWs.readyState === WebSocket.OPEN) {
            aliWs.send(JSON.stringify(message));
          }
        }, 500);
      }

    } catch (error) {
      console.error('❌ Error processing client message:', error.message || error);
      if (clientWs && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          header: { event: 'task-failed' },
          payload: { message: 'Message processing error: ' + (error.message || 'Unknown') }
        }));
      }
    }
  });

  clientWs.on('close', function (code, reason) {
    console.log('📱 Client disconnected:', code, reason?.toString() || 'No reason');
    if (aliWs) {
      aliWs.close();
    }
  });

  clientWs.on('error', function (error) {
    console.error('❌ Client WebSocket error:', error.message || error);
    if (aliWs) {
      aliWs.close();
    }
  });

  // 发送连接确认给客户端
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

// 启动HTTP服务器
server.listen(PORT, () => {
  console.log(`🎤 Ali ASR Proxy Server listening on port ${PORT}`);
  console.log(`📍 WebSocket endpoint: wss://your-domain.onrender.com/ali-asr`);
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

// ✅ 捕获未处理的异常，防止静默退出
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  process.exit(1);
});

// ✅ 捕获未处理的 Promise 拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});