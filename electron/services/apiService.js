import { WebSocketServer } from 'ws';

class ApiService {
    constructor() {
        this.wsServer = null;
        this.clients = new Set();
        this.currentLyrics = null;
        this.isPlaying = false;
        this.currentTime = 0;
        this.mainWindow = null;
    }
    init(mainWindow) {
        this.mainWindow = mainWindow;
    }
    // 启动 WebSocket 服务器
    start() {
        if (this.wsServer) return;
        try {
            // 只绑回环地址：默认会监听所有网卡，局域网任意设备都能连上
            // 读取歌词/播放状态并发送控制指令
            this.wsServer = new WebSocketServer({
                port: 6520,
                host: '127.0.0.1',
                // 浏览器对 WebSocket 没有同源限制：任意网页都可以连 ws://127.0.0.1:6520。
                // 拒绝携带页面 Origin 的连接（本地工具类客户端正常不会带 Origin）
                verifyClient: (info) => {
                    const origin = info.req?.headers?.origin;
                    return !origin;
                }
            });
        } catch (error) {
            // 端口被占用（EADDRINUSE）等启动失败：降级为不可用，避免未捕获异常导致进程僵死
            console.error('WebSocket 服务器启动失败:', error);
            this.wsServer = null;
            return;
        }
        this.wsServer.on('listening', () => {
            console.log('WebSocket server running at ws://127.0.0.1:6520');
        });
        this.wsServer.on('error', (error) => {
            console.error('WebSocket 服务器错误:', error);
            try {
                this.wsServer?.close();
            } catch (_) { /* ignore */ }
            this.wsServer = null;
        });
        this.wsServer.on('connection', (ws) => {
            this.clients.add(ws);
            //发送欢迎信息
            ws.send(JSON.stringify({
                type: 'welcome',
                data: '感谢接入 Jello Music，项目地址：https://github.com/Margele1337/jello-music'
            }));

            // 发送当前歌词
            if (this.currentLyrics) {
                ws.send(JSON.stringify({
                    type: 'lyrics',
                    data: this.currentLyrics
                }));
            }

            // 发送当前播放状态
            ws.send(JSON.stringify({
                type: 'playerState',
                data: {
                    isPlaying: this.isPlaying,
                    currentTime: this.currentTime
                }
            }));

            // 处理来自客户端的消息
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    console.log(data);
                    if (data.type === 'control') {
                        this.handleControlCommand(data.data);
                    }
                } catch (e) {
                    console.error('无效的 WebSocket 消息', e);
                }
            });

            ws.on('close', () => {
                this.clients.delete(ws);
                console.log('WebSocket 客户端已断开连接');
            });
        });

        console.log('WebSocket 服务已启动（端口 6520）');
    }

    stop() {
        if (this.wsServer) {
            for (const client of this.clients) {
                client.close();
            }
            this.clients.clear();
            this.wsServer.close();
            this.wsServer = null;
            console.log('WebSocket 服务器已停止');
        }
    }
    
    // 广播到所有客户端
    broadcastToClients(data) {
        if(!this.wsServer) return;
        const message = JSON.stringify(data);
        for (const client of this.clients) {
            if (client.readyState === 1) {
                client.send(message);
            }
        }
    }

    handleControlCommand(data) {
        if (!this.mainWindow) return;
        switch (data.command) {
            case 'toggle': // 切换播放状态
                this.mainWindow.webContents.send('toggle-play-pause');
                break;
            case 'next': // 下一首
                this.mainWindow.webContents.send('play-next-track');
                break;
            case 'prev': // 上一首
                this.mainWindow.webContents.send('play-previous-track');
                break;
        }
    }
    
    // 更新歌词数据
    updateLyrics(lyricsData) {
        this.currentLyrics = lyricsData;
        this.broadcastToClients({
            type: 'lyrics',
            data: lyricsData
        });
    }
    
    // 更新播放状态
    updatePlayerState(state) {
        this.isPlaying = state.isPlaying;
        this.currentTime = state.currentTime;
        this.broadcastToClients({
            type: 'playerState',
            data: state
        });
    }
}

const apiService = new ApiService();
export default apiService; 