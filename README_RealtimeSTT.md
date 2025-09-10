# RealtimeSTT 集成使用说明

## 概述

已成功集成 RealtimeSTT 库作为实时语音识别方案，提供更好的本地化语音识别体验。

## 文件结构

```
/realtime_stt_server.py              # Python WebSocket 服务器
/web-demo/src/asr/RealtimeSTTWebSocketASR.ts  # 前端 WebSocket 客户端
/web-demo/src/media/SimpleMediaCapture.ts     # 已更新支持 RealtimeSTT
/web-demo/.env                       # 环境变量配置
```

## 安装与配置

### 1. Python 后端依赖

```bash
# 安装 RealtimeSTT 和相关依赖
pip install RealtimeSTT websockets asyncio

# 如果需要支持中文，可能需要额外安装
pip install openai-whisper
```

### 2. 环境变量配置

在 `/web-demo/.env` 中配置：

```env
# RealtimeSTT 配置（优先使用）
VITE_REALTIME_STT_URL=ws://localhost:8765

# 阿里云ASR代理服务器配置 (备选)
VITE_ALI_ASR_PROXY_URL=wss://realtime-multimodal-demo.onrender.com/ali-asr

# ASR配置选项
VITE_ASR_PROVIDER=realtime-stt
```

## 使用方法

### 1. 启动 RealtimeSTT 服务器

```bash
# 在项目根目录下
python realtime_stt_server.py
```

服务器将在 `ws://localhost:8765` 启动，并显示：
```
🚀 Starting RealtimeSTT WebSocket server on localhost:8765
✅ RealtimeSTT server started on ws://localhost:8765
📡 Server ready to accept connections...
```

### 2. 启动前端应用

```bash
cd web-demo
npm run dev
```

### 3. 测试语音识别

1. 打开浏览器访问前端应用
2. 点击"开始分析"按钮
3. 系统会自动连接到 RealtimeSTT 服务器
4. 开始说话，系统将实时显示转录结果

## 特性

### RealtimeSTT 优势

- ✅ **本地化**: 无需API密钥，本地处理
- ✅ **实时性**: 基于语音活动检测(VAD)的实时转录
- ✅ **多语言**: 支持中文、英文等多种语言
- ✅ **低延迟**: 直接麦克风采集，无需前端音频传输
- ✅ **稳定性**: 自动重连和错误恢复

### 架构特点

```
前端 React App
    ↕ WebSocket
Python 后端 (RealtimeSTT)
    ↕ 音频采集
本地麦克风 → Whisper ASR → 实时转录
```

## 配置选项

### Python 服务器配置

在 `realtime_stt_server.py` 中可调整：

```python
recorder_config = {
    'model': 'tiny.en',              # Whisper 模型 (tiny, base, small, medium, large)
    'language': 'zh',                # 语言 (zh, en, auto)
    'silero_sensitivity': 0.4,       # VAD 敏感度 (0.0-1.0)
    'post_speech_silence_duration': 0.7,  # 后静音时长
    'min_length_of_recording': 0.5,  # 最小录音长度
    'enable_realtime_transcription': True,  # 启用实时转录
}
```

### 前端配置

在 `RealtimeSTTWebSocketASR.ts` 中可调整：

```typescript
const config = {
    serverUrl: 'ws://localhost:8765',
    model: 'tiny.en',
    language: 'zh',
    sensitivity: 0.4,
    minRecordingLength: 0.5,
    postSpeechSilence: 0.7
};
```

## 故障排除

### 1. 连接失败

- 确保 Python 服务器已启动
- 检查防火墙设置
- 确认端口 8765 未被占用

### 2. 音频权限

- 浏览器需要麦克风权限
- 必须在 HTTPS 或 localhost 环境下运行

### 3. 模型下载

首次运行可能需要下载 Whisper 模型：
```bash
# 预下载模型（可选）
python -c "import whisper; whisper.load_model('tiny.en')"
```

### 4. 依赖问题

如果出现依赖错误：
```bash
# 重新安装依赖
pip uninstall RealtimeSTT
pip install --no-cache-dir RealtimeSTT
```

## 性能优化

### 1. 模型选择

- `tiny`: 最快，适合实时应用
- `base`: 平衡性能和准确度  
- `small/medium/large`: 更高准确度，更高延迟

### 2. VAD 调优

- `silero_sensitivity`: 降低可减少误触发
- `post_speech_silence_duration`: 调整可改善断句

### 3. 硬件要求

- CPU: 推荐 4 核以上
- RAM: 至少 4GB 可用内存
- 麦克风: 建议使用降噪麦克风

## 监控和调试

### 服务器日志

服务器会输出详细日志：
- 🔗 连接状态
- 🎤 录音状态  
- 📝 转录结果
- ❌ 错误信息

### 前端调试

打开浏览器开发者工具查看：
- WebSocket 连接状态
- ASR 事件流
- 语速计算结果

## 扩展功能

### 1. 多语言支持

修改服务器配置即可支持不同语言：
```python
'language': 'en',  # 英文
'language': 'zh',  # 中文  
'language': 'auto',  # 自动检测
```

### 2. 唤醒词

可添加唤醒词功能：
```python
recorder = AudioToTextRecorder(wake_words="jarvis")
```

### 3. 翻译功能

RealtimeSTT 支持实时翻译，可在后续版本中添加。

---

现在可以使用 RealtimeSTT 进行实时语音识别了！