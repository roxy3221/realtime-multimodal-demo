# Vercel 部署说明

## 快速部署步骤

### 1. 连接 GitHub 到 Vercel

1. 访问 [Vercel Dashboard](https://vercel.com/dashboard)
2. 点击 "New Project"
3. 连接你的 GitHub 账户并选择此项目的仓库

### 2. 配置环境变量

在 Vercel 项目设置中添加以下环境变量：

#### 必需的环境变量：
```
VITE_DASHSCOPE_API_KEY=sk-71a07e1a3381400399e4b427e94cbc80
```

#### 可选的环境变量：
```
VITE_APP_ENV=production
VITE_APP_NAME=实时多模态分析演示
VITE_ASR_PROVIDER=gummy
VITE_MEDIAPIPE_CDN=https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0
```

#### 在 Vercel 中配置环境变量的步骤：

1. 在 Vercel Dashboard 中选择你的项目
2. 点击 "Settings" 标签
3. 在左侧菜单中选择 "Environment Variables"
4. 点击 "Add New" 按钮
5. 输入变量名和值：
   - Name: `VITE_DASHSCOPE_API_KEY`
   - Value: `sk-71a07e1a3381400399e4b427e94cbc80`
   - Environment: 选择 `Production`, `Preview`, `Development` (建议全选)
6. 点击 "Save"
7. 对其他环境变量重复此过程

### 3. 部署配置

项目已包含 `vercel.json` 配置文件，包含以下设置：
- 构建命令：`npm run build`
- 输出目录：`dist`
- 框架：`vite`
- COOP/COEP 头部配置（WebAssembly 和 SharedArrayBuffer 支持）

### 4. 部署

配置完成后，Vercel 会自动部署：
1. 推送代码到 GitHub
2. Vercel 会自动检测更改并触发部署
3. 部署完成后会提供一个 URL

### 5. 验证部署

访问部署的 URL，确认：
- [ ] 页面正常加载
- [ ] 摄像头和麦克风权限请求正常
- [ ] 人脸检测功能工作
- [ ] ASR 功能正常（需要 API 密钥）
- [ ] 控制台无严重错误

## 常见问题排查

### API 密钥问题
如果看到 "Alibaba Cloud API key is required" 错误：
1. 确认在 Vercel 中设置了 `VITE_DASHSCOPE_API_KEY`
2. 重新部署项目让环境变量生效
3. 检查浏览器控制台是否有其他错误

### SharedArrayBuffer 问题
如果遇到 SharedArrayBuffer 相关错误：
- 项目已配置了正确的 COOP/COEP 头部
- 确保 `vercel.json` 文件存在且配置正确

### 权限问题
- HTTPS：Vercel 自动提供 HTTPS，摄像头/麦克风权限在 HTTPS 下正常工作
- 域名白名单：如需特定域名配置，在 Vercel 项目设置中配置

## 手动部署命令

如果需要使用 Vercel CLI：

```bash
# 安装 Vercel CLI
npm i -g vercel

# 在项目根目录登录
vercel login

# 部署
vercel --prod

# 设置环境变量（通过 CLI）
vercel env add VITE_DASHSCOPE_API_KEY
```

## 监控和日志

- 访问 Vercel Dashboard > 你的项目 > Functions 标签查看日志
- 实时日志：`vercel logs --follow`
- 部署状态：在 Vercel Dashboard 中查看部署历史

---

**重要提示：** 请确保 API 密钥安全，不要在代码中硬编码，始终使用环境变量。