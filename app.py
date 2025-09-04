#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
最小化实时多模态分析测试
用于快速验证基础功能
"""

import time
import json
import numpy as np
from flask import Flask, render_template_string, request
from flask_socketio import SocketIO, emit
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = 'test_key'
socketio = SocketIO(app, cors_allowed_origins="*")

# 简化的HTML模板（内嵌）
HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>最小化多模态测试</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.2/socket.io.js"></script>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .container { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .section { border: 1px solid #ddd; padding: 15px; border-radius: 5px; }
        video { width: 100%; max-width: 400px; }
        button { padding: 10px 20px; margin: 5px; font-size: 16px; }
        .btn-start { background: #4CAF50; color: white; border: none; }
        .btn-stop { background: #f44336; color: white; border: none; }
        .results { background: #f5f5f5; padding: 10px; margin: 10px 0; min-height: 100px; }
        .status { font-weight: bold; padding: 5px; }
        .connected { color: green; }
        .disconnected { color: red; }
    </style>
</head>
<body>
    <h1>最小化实时多模态分析测试</h1>
    
    <div class="status" id="status">状态: <span class="disconnected">未连接</span></div>
    
    <div class="container">
        <div class="section">
            <h3>视频采集</h3>
            <video id="video" autoplay muted></video>
            <div>
                <button id="startBtn" class="btn-start">开始测试</button>
                <button id="stopBtn" class="btn-stop" disabled>停止测试</button>
            </div>
        </div>
        
        <div class="section">
            <h3>分析结果</h3>
            <div class="results" id="results">等待开始...</div>
            
            <h4>韵律特征</h4>
            <div id="prosody">基频: -- Hz, 能量: --, 语速: -- WPM</div>
            
            <h4>面部分析</h4>
            <div id="face">表情: --, 头部姿态: --</div>
            
            <h4>语音识别</h4>
            <div id="asr">等待语音输入...</div>
        </div>
    </div>

    <script>
        let socket = io();
        let mediaStream = null;
        let isActive = false;
        
        const video = document.getElementById('video');
        const startBtn = document.getElementById('startBtn');
        const stopBtn = document.getElementById('stopBtn');
        const status = document.getElementById('status');
        const results = document.getElementById('results');
        
        // WebSocket事件
        socket.on('connect', () => {
            status.innerHTML = '状态: <span class="connected">已连接</span>';
            startBtn.disabled = false;
        });
        
        socket.on('disconnect', () => {
            status.innerHTML = '状态: <span class="disconnected">连接断开</span>';
            startBtn.disabled = true;
        });
        
        socket.on('test_result', (data) => {
            console.log('收到结果:', data);
            updateDisplay(data);
        });
        
        // 开始测试
        startBtn.addEventListener('click', async () => {
            try {
                // 请求媒体权限
                mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });
                
                video.srcObject = mediaStream;
                
                // 启动数据发送
                startDataCollection();
                
                startBtn.disabled = true;
                stopBtn.disabled = false;
                isActive = true;
                
                socket.emit('start_test');
                results.textContent = '测试已启动，正在采集数据...';
                
            } catch (error) {
                alert('无法访问摄像头/麦克风: ' + error.message);
                console.error(error);
            }
        });
        
        // 停止测试
        stopBtn.addEventListener('click', () => {
            if (mediaStream) {
                mediaStream.getTracks().forEach(track => track.stop());
            }
            
            isActive = false;
            startBtn.disabled = false;
            stopBtn.disabled = true;
            
            socket.emit('stop_test');
            results.textContent = '测试已停止';
        });
        
        // 数据采集
        function startDataCollection() {
            // 模拟音频数据发送
            setInterval(() => {
                if (!isActive) return;
                
                // 发送模拟音频数据
                const audioData = new Array(1024).fill(0).map(() => Math.random() * 255);
                socket.emit('audio_chunk', {
                    data: audioData,
                    timestamp: Date.now()
                });
            }, 500);
            
            // 模拟视频帧发送
            setInterval(() => {
                if (!isActive) return;
                
                // 捕获视频帧
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth || 640;
                canvas.height = video.videoHeight || 480;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0);
                
                const imageData = canvas.toDataURL('image/jpeg', 0.5);
                socket.emit('video_frame', {
                    data: imageData,
                    timestamp: Date.now()
                });
            }, 1000);
        }
        
        // 更新显示
        function updateDisplay(data) {
            if (data.prosody) {
                document.getElementById('prosody').textContent = 
                    `基频: ${data.prosody.pitch}Hz, 能量: ${data.prosody.energy.toFixed(3)}, 语速: ${data.prosody.rate}WPM`;
            }
            
            if (data.face) {
                document.getElementById('face').textContent = 
                    `表情: ${data.face.expression}, 头部姿态: ${data.face.pose}`;
            }
            
            if (data.asr) {
                document.getElementById('asr').textContent = data.asr.text;
            }
            
            // 显示原始数据
            results.innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
        }
    </script>
</body>
</html>
'''

class MockAnalyzer:
    """模拟分析器"""
    
    def analyze_audio(self, audio_data):
        """模拟音频分析"""
        return {
            'pitch': np.random.randint(100, 300),
            'energy': np.random.random(),
            'rate': np.random.randint(60, 180)
        }
    
    def analyze_video(self, frame_data):
        """模拟视频分析"""
        expressions = ['neutral', 'happy', 'surprised', 'focused']
        poses = ['center', 'left', 'right', 'up', 'down']
        
        return {
            'expression': np.random.choice(expressions),
            'pose': np.random.choice(poses)
        }
    
    def mock_asr(self):
        """模拟ASR"""
        sentences = [
            '这是一个测试句子',
            '语音识别正在工作',
            '多模态分析系统运行正常',
            '实时处理音视频数据'
        ]
        return {
            'text': np.random.choice(sentences),
            'confidence': np.random.uniform(0.7, 0.9)
        }

# 全局分析器
analyzer = MockAnalyzer()
active_sessions = set()

@app.route('/')
def index():
    return render_template_string(HTML_TEMPLATE)

@socketio.on('connect')
def handle_connect():
    logger.info(f'客户端连接: {request.sid}')
    emit('status', {'message': '连接成功'})

@socketio.on('disconnect') 
def handle_disconnect():
    logger.info(f'客户端断开: {request.sid}')
    active_sessions.discard(request.sid)

@socketio.on('start_test')
def handle_start_test():
    logger.info(f'开始测试: {request.sid}')
    active_sessions.add(request.sid)
    emit('status', {'message': '测试已启动'})

@socketio.on('stop_test')
def handle_stop_test():
    logger.info(f'停止测试: {request.sid}')
    active_sessions.discard(request.sid)
    emit('status', {'message': '测试已停止'})

@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    if request.sid not in active_sessions:
        return
    
    try:
        # 模拟分析音频
        audio_result = analyzer.analyze_audio(data['data'])
        asr_result = analyzer.mock_asr()
        
        emit('test_result', {
            'type': 'audio',
            'prosody': audio_result,
            'asr': asr_result,
            'timestamp': data['timestamp']
        })
        
    except Exception as e:
        logger.error(f'音频处理错误: {e}')

@socketio.on('video_frame')
def handle_video_frame(data):
    if request.sid not in active_sessions:
        return
    
    try:
        # 模拟分析视频
        face_result = analyzer.analyze_video(data['data'])
        
        emit('test_result', {
            'type': 'video', 
            'face': face_result,
            'timestamp': data['timestamp']
        })
        
    except Exception as e:
        logger.error(f'视频处理错误: {e}')

if __name__ == '__main__':
    print('启动最小化测试服务器...')
    print('访问: http://localhost:5000')
    print('注意: 需要HTTPS才能访问摄像头，建议使用:')
    print('  python -m http.server 8000 --bind 127.0.0.1')
    print('  然后通过代理或ngrok提供HTTPS访问')
    
    socketio.run(app, host='127.0.0.1', port=5000, debug=True, allow_unsafe_werkzeug=True)