# Development Log

## 项目进展记录

### 当前问题分析 (2025-09-05)

**Vercel 部署失败的根本原因:**
1. ~~**重复项目冲突**~~ ✅ 已解决 - 删除了重复的 Vercel 项目
2. **MediaPipe 生产环境配置问题** ✅ 已修复

### MediaPipe 生产环境修复方案

#### 问题诊断
- **WASM 文件路径错误**：生产环境中 MediaPipe WASM 文件无法正确加载
- **CDN 依赖不稳定**：外部 CDN 可能被防火墙或网络策略阻塞
- **资源路径配置**：Vercel 部署后静态资源路径不匹配

#### 修复措施

1. **优化 MediaPipe 初始化逻辑**
   - 使用本地安装的 `@mediapipe/tasks-vision` 包，避免 CDN 依赖
   - 智能模型路径选择：优先本地，降级到 CDN
   - 增强错误处理和重试机制

2. **Vite 构建配置优化**
   ```typescript
   // 自定义插件：复制 MediaPipe WASM 文件到 dist
   {
     name: 'copy-mediapipe-assets',
     generateBundle() {
       // 复制 vision_wasm_internal.wasm 等文件
     }
   }
   ```

3. **Vercel 路由和 Headers 配置**
   ```json
   // vercel.json 添加 MediaPipe 资源支持
   {
     "source": "/node_modules/@mediapipe/tasks-vision/wasm/(.*)",
     "headers": [
       { "key": "Content-Type", "value": "application/wasm" },
       { "key": "Cross-Origin-Resource-Policy", "value": "cross-origin" }
     ]
   }
   ```

#### 技术改进
- **删除模拟模式**：专注于真正的 MediaPipe 功能
- **GPU/CPU 自适应**：优先 GPU 加速，自动降级到 CPU
- **错误分类处理**：针对不同错误类型提供具体解决方案

### 解决方案

#### 立即操作
1. **删除重复 Vercel 项目** - 在 Vercel 仪表板删除 `web_demo`，保留 `realtime-multimodal-demo`
2. **确认 HTTPS 配置** - Vercel 自动提供 HTTPS，摄像头权限应该正常

#### 技术细节
- 本地构建测试成功 ✅
- Vite 配置正确，包含必要的 CORS 头
- MediaPipe 和 TensorFlow.js 依赖正常
- WebWorker 配置正确

### 配置状态

**Vercel 配置 (vercel.json):**
- ✅ 构建命令指向正确目录 (`cd web-demo && npm run build`)
- ✅ 输出目录设置 (`web-demo/dist`)
- ✅ CORS 头配置正确
- ✅ Worker 文件路由配置

**依赖状态:**
- ✅ MediaPipe Tasks Vision: v0.10.8
- ✅ TensorFlow.js: v4.20.0  
- ✅ React 19 + TypeScript

### 下一步测试计划

在修复重复项目后：
1. 重新部署到 Vercel
2. 测试摄像头权限和 MediaPipe 加载
3. 验证 WebWorker 正常工作
4. 确认人脸检测功能

### 版本更新记录

#### v0.1.1 - 2025-09-05
- 🔍 **问题诊断**: 发现 Vercel 重复项目冲突
- 🛠️ **配置检查**: 确认技术栈配置正确
- 📋 **解决方案**: 提供明确的修复步骤

#### v0.1.0 - Initial Setup  
- 基础项目结构搭建
- 摄像头和麦克风权限获取
- MediaPipe Face Landmarker 集成

---

## 技术栈

- **前端**: React 19 + TypeScript + Vite
- **人脸检测**: MediaPipe Tasks Face Landmarker v0.10.8
- **音频处理**: Web Audio API + AudioWorklet
- **构建工具**: Vite 7.1.4 + Terser
- **部署**: Vercel (HTTPS 自动配置)

## 排查清单

### Vercel 部署检查
- [ ] 删除重复项目 `web_demo`
- [ ] 确认单一项目 `realtime-multimodal-demo` 正常部署
- [ ] 验证 HTTPS 环境下摄像头权限
- [ ] 测试 MediaPipe 模型加载
- [ ] 检查 WebWorker 文件访问

### 功能验证  
- [ ] 摄像头访问和显示
- [ ] 人脸关键点检测
- [ ] 麦克风音频捕获
- [ ] EventBus 事件流
- [ ] UI 实时更新

## 已知限制

1. **浏览器兼容性** - MediaPipe 需要现代浏览器支持
2. **HTTPS 要求** - 摄像头/麦克风需要安全上下文
3. **性能考虑** - 大模型可能影响加载速度
4. **移动端适配** - 需要额外优化