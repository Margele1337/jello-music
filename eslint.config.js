import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';

// 护栏定位：抓「死代码 / 未定义引用 / 基础 Vue 错误」这一类机器可判的问题，
// 不做风格仲裁（引号、缩进、属性顺序交给人）。CI 里 npm run lint 非零即失败。
export default [
  {
    // api/ 是第三方子模块（KuGouMusicApi，MIT），不参与本仓库 lint
    ignores: ['node_modules/**', 'dist/**', 'dist_electron/**', 'api/**', 'build/**', 'public/**']
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.{js,mjs,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      // shared/ 同时跑在渲染层（window/document）与 node --test（process/globalThis），
      // electron/ 主进程是 node 环境：两套 globals 一并放开，靠 no-undef 抓真正的笔误
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      // 下划线前缀的参数是「有意忽略」的既有约定（(_event, payload)）
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.browser, ...globals.node }
    }
  },
  {
    // 频谱链路（DSP 引擎与 HUD 窗口模块）行为敏感、有专门的返修节奏，
    // 护栏接入刻意不改动其源码（含遗留无用 import 的清理），整改留给频谱专项。
    files: ['src/services/audio/spectrum.js', 'electron/windows/spectrumHud.js'],
    rules: {
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off'
    }
  }
];
