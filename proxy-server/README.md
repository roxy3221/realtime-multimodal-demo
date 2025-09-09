# Ali ASR Proxy Server

阿里云语音识别WebSocket代理服务器，解决浏览器环境下的CORS和认证问题。

## 部署到Render

1. 将此目录推送到GitHub仓库
2. 在Render创建新的Web Service
3. 连接你的GitHub仓库
4. 设置环境变量：
   - `DASHSCOPE_API_KEY`: 你的阿里云DashScope API密钥

## 本地开发

```bash
npm install
DASHSCOPE_API_KEY=your-api-key npm start
```

## 端点

- WebSocket: `wss://your-domain/ali-asr`
- 健康检查: `https://your-domain/health`

## 环境变量

- `PORT`: 服务器端口 (默认: 8080)
- `DASHSCOPE_API_KEY`: 阿里云DashScope API密钥 (必需)