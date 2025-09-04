# 实时多模态分析演示系统

基于事件驱动架构的浏览器端多模态监测系统，仅在显著变化时触发UI更新。

## 🎯 项目目标

实现Claude.md中定义的实时多模态分析系统，具备以下核心特性：
- **事件驱动**: 仅在表情/韵律显著变化时触发分析
- **低延迟**: 端到端延迟 ≤200ms
- **高效率**: CPU使用率 <50%
- **实时ASR**: 字幕延迟 ≤800ms

## 📁 项目结构

```
src/
├── types/           # TypeScript类型定义
│   ├── events.ts    # 事件系统类型 (FaceEvent, ProsodyEvent, ASREvent)
│   └── analyzer.ts  # 分析器接口类型
├── config/          # 配置系统
│   └── defaults.ts  # 默认参数配置 (阈值、性能目标等)
├── events/          # 事件系统
│   └── EventBus.ts  # 跨Worker事件总线 (基于BroadcastChannel)
├── utils/           # 工具函数库
│   ├── math.ts      # 数学/信号处理 (EMA, 余弦距离, 双阈值触发器)
│   └── media.ts     # 媒体处理工具
├── workers/         # WebWorker处理器 (待实现)
├── analyzers/       # 分析器组件 (待实现)
└── ui/              # 用户界面组件 (待实现)
```

## 🚀 阶段1完成情况

### ✅ 已完成
1. **项目基础架构**
   - Vite + React + TypeScript 配置
   - WebWorkers + WASM + HTTPS 支持
   - 模块化目录结构

2. **类型系统**
   - 完整的事件类型定义 (映射自Claude.md)
   - 分析器接口类型 (对应Python组件)
   - 配置参数类型

3. **事件驱动系统**
   - BroadcastChannel事件总线
   - 事件历史记录和导出
   - 类型安全的发布/订阅机制

4. **工具函数库**
   - 数学处理: EMA、余弦距离、欧氏距离
   - 双阈值触发器 (防抖动)
   - 滑动窗口统计
   - 圆形缓冲区

5. **媒体处理工具**
   - 浏览器支持检查
   - MediaStream获取封装
   - 音频格式转换

6. **配置系统**
   - 默认参数 (映射自Python CFG)
   - 性能目标定义
   - 触发配置 (T_high=0.6, T_low=0.4)

7. **基础UI界面**
   - 系统状态监控
   - 实时事件日志
   - 响应式设计

### 🎯 核心特性验证

- ✅ **事件系统**: 成功实现跨组件事件通信
- ✅ **类型安全**: 完整的TypeScript类型覆盖
- ✅ **浏览器兼容**: 现代浏览器API支持检查
- ✅ **模块化**: 清晰的分层架构

## 🔧 开发环境

### 安装依赖
```bash
npm install
```

### 启动开发服务器
```bash
npm run dev        # HTTP模式
npm run https-dev  # HTTPS模式 (媒体权限需要)
```

### 构建生产版本
```bash
npm run build
```

## 📋 下一步计划

### 阶段2: 媒体采集和基础处理管道
- [ ] MediaStream获取和管理
- [ ] VideoFrame → OffscreenCanvas → Worker
- [ ] AudioWorklet实时音频处理
- [ ] 基础RMS/VAD检测

### 阶段3: 事件驱动核心引擎
- [ ] 双阈值检测算法实现
- [ ] 冷却机制和去抖动
- [ ] EventDrivenCache缓存系统
- [ ] 变化分数计算

## 🔗 技术栈

- **前端**: React 18 + TypeScript + Vite
- **媒体处理**: MediaPipe, TensorFlow.js, WebRTC
- **并发**: WebWorkers, AudioWorklet
- **通信**: BroadcastChannel
- **数学库**: 自研信号处理工具

## 📖 参考文档

- `Claude.md` - 完整的产品需求文档
- `MultiModalAnalyzer_Optimized.py` - Python参考实现
- `/docs` - 技术文档 (待创建)

---

**当前状态**: 阶段1 ✅ 完成 | **下一步**: 阶段2 媒体采集管道

系统已具备坚实的基础架构，可以开始实现实际的音视频处理功能。