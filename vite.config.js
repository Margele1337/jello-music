import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { buildCsp } from './shared/csp.js';

// index.html 里的 CSP meta 是占位内容，这里按阶段重写：
// dev server 带 HMR 的 5173 白名单，build 产物不带。
const cspPlugin = () => ({
  name: 'jello-csp-policy',
  transformIndexHtml: {
    order: 'pre',
    handler(html, ctx) {
      const policy = buildCsp({ dev: !!ctx.server });
      return html.replace(
        /(http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/i,
        (match, prefix, suffix) => `${prefix}${policy}${suffix}`
      );
    }
  }
});

export default defineConfig({
  base: './',
  plugins: [vue(), cspPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
