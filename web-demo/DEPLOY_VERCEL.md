# Vercel 部署说明 (更新版 - 使用代理服务器)

## 重要更新：阿里云ASR修复

由于浏览器环境的CORS和认证限制，现在使用代理服务器方案：

### 修复前的问题
- ❌ 浏览器不能直连阿里云ASR WebSocket
- ❌ 无法在WebSocket中添加Authorization头
- ❌ CORS策略阻止跨域连接

### 修复后的架构
✅ **浏览器** → **代理服务器(Render)** → **阿里云ASR**
- 代理服务器处理认证和CORS问题
- 前端不再暴露API密钥
- 连接稳定可靠

## 部署步骤

### 步骤1: 部署代理服务器到Render

1. 将 `/proxy-server/` 目录推送到GitHub仓库
2. 访问 [Render Dashboard](https://render.com)
3. 创建新的 "Web Service"
4. 连接GitHub仓库，选择 `proxy-server` 目录
5. 配置：
   - Name: `ali-asr-proxy`  
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
6. 添加环境变量：
   - `DASHSCOPE_API_KEY`: 你的阿里云DashScope API密钥
7. 部署完成后记录URL (格式：`https://xxx.onrender.com`)

### 步骤2: 配置Vercel环境变量

在 Vercel 项目设置中添加以下环境变量：

#### 必需的环境变量：
```
VITE_ALI_ASR_PROXY_URL=wss://你的render域名.onrender.com/ali-asr
```

#### 可选的环境变量：
```
VITE_APP_ENV=production
VITE_APP_NAME=实时多模态分析演示
VITE_MEDIAPIPE_CDN=https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0
```

#### 在 Vercel 中配置环境变量的步骤：

1. 在 Vercel Dashboard 中选择你的项目
2. 点击 "Settings" 标签
3. 在左侧菜单中选择 "Environment Variables"
4. 点击 "Add New" 按钮
5. 输入变量名和值：
   - Name: `VITE_ALI_ASR_PROXY_URL`
   - Value: `wss://你的render域名.onrender.com/ali-asr`
   - Environment: 选择 `Production`, `Preview`, `Development` (建议全选)
6. 点击 "Save"

### 步骤3: 重新部署Vercel

推送更新的代码到GitHub，Vercel会自动重新部署。

### 步骤4: 验证部署

1. 打开浏览器开发者工具 → Network → WS标签
2. 访问你的应用并启动语音识别  
3. **关键检查**：确认WebSocket连接的是你的代理URL (xxx.onrender.com)，而不是dashscope.aliyuncs.com
4. 检查连接成功并能正常进行语音识别

## 代理服务器端点

- **WebSocket**: `wss://你的域名.onrender.com/ali-asr`
- **健康检查**: `https://你的域名.onrender.com/health`

## 故障排查

### 如果ASR仍然不工作：

1. **检查Render日志**：
   - 访问Render Dashboard → 你的服务 → Logs
   - 查看连接和认证状态

2. **验证环境变量**：
   - Render中的 `DASHSCOPE_API_KEY` 设置正确
   - Vercel中的 `VITE_ALI_ASR_PROXY_URL` 指向正确的Render URL

3. **浏览器检查**：
   - 控制台无WebSocket连接错误
   - Network标签显示连接到代理而非阿里云直连

4. **测试代理健康**：
   - 访问 `https://你的域名.onrender.com/health` 应该返回状态信息

## 部署后的架构流程

```
用户语音 → 浏览器 → Vercel前端 → Render代理服务器 → 阿里云ASR → 代理 → 前端显示结果
```

- ✅ API密钥安全存储在Render服务器端
- ✅ 浏览器只连接到你的代理服务器
- ✅ 代理服务器处理认证和转发
- ✅ 完美解决CORS和认证问题

---

**重要提示：** 现在API密钥只存储在Render代理服务器中，前端代码完全不接触敏感信息，更加安全。