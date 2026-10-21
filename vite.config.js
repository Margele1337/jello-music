// vite.config.js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        // 桌面端用 file:// 加载，Service Worker 根本无法注册（非 secure context）；
        // 开着只会在 dev（localhost）注册并缓存，污染开发环境且与生产行为不一致
        enabled: false,
        suppressWarnings: true,
        suppressErrors: true,
        logLevel: 'silent',
        type: 'module'
      },
      workbox: {
        // 缓存策略配置
        runtimeCaching: [
          {
            // 匹配所有API请求
            urlPattern: /^\/api\/.*$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 1
              },
              cacheableResponse: {
                // status 0 是跨域 opaque 响应（含失败/空响应），缓存它会把错误内容当
                // 有效数据缓存一整天，只缓存明确的 200
                statuses: [200]
              }
            }
          },
          {
            // 匹配所有静态资源
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|js|css|woff2)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'assets-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7
              }
            }
          },
          {
            // 匹配导航请求（HTML）
            urlPattern: /\/$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 // 1天
              }
            }
          }
        ]
      },
      manifest: {
        name: 'Jello Music',
        short_name: 'Jello',
        description: '一个高颜值的酷狗第三方播放器',
        theme_color: '#E18FA8',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        display_override: [
          "window-controls-overlay",
          "standalone",
          "minimal-ui",
          "browser"
        ],
        icons: [
          {
            src: '/assets/images/logo.png',
            sizes: '256x256',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  define: {
    __VERSION__: JSON.stringify(process.env.npm_package_version)
  },
  base: '',
  server: {
    // 只绑本机回环：host: true 会让局域网内任何设备都能访问开发服务器
    host: '127.0.0.1',
    port: 8080, // 将开发服务器端口设置为8080，确保与其他服务兼容
  },
  resolve: {
    alias: {
      '@': '/src', // 设置路径别名
    },
  }
});