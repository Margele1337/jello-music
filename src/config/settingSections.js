import { PLAYBACK_RATES } from '../../shared/settings.js';

// 播放速率文案：schema 与通用渲染共用
export const rateText = (rate) => (rate === 1 ? '1.0x' : `${rate}x`);

/**
 * 设置分区 schema：只描述「有哪些行、长什么样、行为指向哪」；响应式状态
 * 与动作由 SettingsView 调用时注入（解构参数名与视图内变量同名，行内闭包
 * 语义不变）。频谱分区行定义原样平移，只搬家不改写。
 */
export const buildSettingSections = ({
  settings,
  qualityText,
  deviceText,
  showTutorial,
  gpuRestartPending,
  restartForGpu,
  proxyDraft,
  proxyHint,
  proxyFocused,
  proxyTesting,
  saveProxyUrl,
  runProxyTest,
  apiDraft,
  apiHint,
  apiFocused,
  apiTesting,
  saveApiBaseUrl,
  runApiBaseTest,
  openLogs,
  exportLogs,
  version,
  updateText,
  updateLabel,
  updateDisabled,
  onUpdateAction,
  switching,
  verifying,
  runSecurityVerify
}) => [
  {
    title: '声音',
    items: [
      {
        key: 'masterVolume',
        control: 'slider',
        icon: 'volume',
        label: '应用音量',
        description: '音量合成器式的应用级音量：与主界面音量相乘后输出（应用 50% × 主界面 80% = 实际 40%），主界面滑杆语义不变。',
        slider: { min: 0, max: 1, step: 0.01 },
        format: (value) => `${Math.round(value * 100)}%`
      },
      {
        key: 'quality',
        control: 'pill',
        icon: 'headphones',
        label: '音质选择',
        selectionKind: 'option',
        selectionTitle: '音质选择',
        getText: () => qualityText.value,
        description: '音质与数据源相互独立；目标音质不可用时自动降级。'
      },
      {
        key: 'playbackRate',
        control: 'seg',
        icon: 'waveform',
        label: '播放速率',
        // 6 档（新增 0.5x）后按常规内边距会顶到 800px 窗口右缘，这一行收紧间距
        segCompact: true,
        options: PLAYBACK_RATES.map((rate) => ({ value: rate, displayText: rateText(rate) }))
      },
      {
        key: 'loudnessNormalization',
        control: 'toggle',
        icon: 'sliders',
        label: '平衡音频响度',
        experimental: true,
        description: '将歌曲响度统一到 -14 LUFS（Spotify 标准），切歌后生效。'
      },
      {
        key: 'audioOutputDevice',
        control: 'pill',
        icon: 'volume',
        label: '音频输出设备',
        selectionKind: 'device',
        selectionTitle: '音频输出设备(实验性)',
        getText: () => deviceText.value
      }
    ]
  },
  {
    title: '歌词',
    items: [
      {
        key: 'desktopLyrics',
        control: 'toggle',
        icon: 'desktop',
        label: '显示桌面歌词'
      },
      {
        key: 'desktopLyricsFont',
        control: 'pill',
        icon: 'font',
        label: '歌词字体',
        selectionKind: 'font',
        selectionTitle: '歌词字体设置',
        getText: () => settings.desktopLyricsFont || '默认字体'
      }
    ]
  },
  {
    title: '频谱',
    items: [
      {
        key: 'spectrum',
        control: 'toggle',
        icon: 'waveform',
        label: '桌面音频频谱',
        description: '独立置顶频谱窗口：114 条频谱条形与频谱信息卡（封面、歌名）。'
      },
      {
        key: 'spectrumPreset',
        control: 'seg',
        icon: 'waveform',
        label: '预设样式',
        description: '预设 1（legacy，默认）＝ 实时采集、每 250ms 台阶式推进、原始幅度，观感同 legacy 应用（信息卡低音脉冲为附加项）。预设 2（原版）＝ 自解码整曲、18 帧队列与音频锁相均匀推进、幅度响度归一。切到预设 1 立即生效；切到预设 2 下一首生效。',
        options: [
          { value: 'legacy', displayText: '预设 1（legacy 复刻）' },
          { value: 'original', displayText: '预设 2（原版）' }
        ]
      },
      {
        key: 'spectrumScale',
        control: 'slider',
        icon: 'chart',
        label: '频谱幅度',
        description: '条形高度整体倍率，1.00x 即原版映射（√幅度 ÷ 12 − 5）。',
        slider: { min: 0.5, max: 3, step: 0.05 },
        format: (value) => `${value.toFixed(2)}x`
      },
      {
        key: 'spectrumBarOpacity',
        control: 'slider',
        icon: 'waveform',
        label: '条形透明度',
        description: '只作用于竖状条形（含条内封面叠加），频谱信息不受影响。',
        slider: { min: 0.1, max: 1, step: 0.05 },
        format: (value) => `${Math.round(value * 100)}%`
      },
      {
        key: 'spectrumSigmaSmoothing',
        control: 'slider',
        icon: 'sliders',
        label: '平滑系数',
        description: () => (settings.spectrumPreset === 'legacy'
          ? 'legacy 式：alpha = 1 − exp(−帧间隔/τ)，τ = 1/(系数×60)；0.335 即 legacy 原值。'
          : '原版公式 alpha = 系数 × 60/渲染帧率，0.335 即原版值。'),
        slider: { min: 0.05, max: 1, step: 0.005 },
        format: (value) => value.toFixed(3)
      },
      {
        key: 'spectrumAvDelayMs',
        control: 'slider',
        icon: 'clock',
        label: '音画差补偿',
        description: () => (settings.spectrumPreset === 'legacy'
          ? '该值即预读播放器的领先量（默认 590 = legacy 原值）；调大频谱更提前，调小延后。'
          : '默认 590 即实机标定的原版相位（实测：频谱约提前可听 57ms）；调大让频谱更提前，调小让频谱延后。'),
        slider: { min: 0, max: 2000, step: 10 },
        format: (value) => `${Math.round(value)}ms`
      },
      {
        key: 'spectrumInfoVisible',
        control: 'toggle',
        icon: 'info',
        label: '频谱信息显示',
        description: '封面、歌名信息卡与四周柔边；关闭后仅保留频谱条形。'
      },
      {
        key: 'spectrumInfoScale',
        control: 'slider',
        icon: 'image',
        label: '频谱信息大小',
        description: '信息卡倍率，1.00x 即原版固定像素大小（封面 100px）。',
        slider: { min: 0.5, max: 2, step: 0.05 },
        format: (value) => `${value.toFixed(2)}x`
      },
      {
        key: 'spectrumInfoOpacity',
        control: 'slider',
        icon: 'image',
        label: '频谱信息透明度',
        description: '封面、歌名信息卡与四周柔边的不透明度，100% 即原版。',
        slider: { min: 0.1, max: 1, step: 0.05 },
        format: (value) => `${Math.round(value * 100)}%`
      },
      {
        key: 'spectrumMouseFade',
        control: 'toggle',
        icon: 'desktop',
        label: '鼠标靠近透明',
        description: '光标附近的条形与信息卡以圆形区域渐隐（半径随靠近逐渐扩大），方便看清被频谱挡住的桌面内容。'
      },
      {
        key: 'spectrumMouseFadeRadius',
        control: 'slider',
        icon: 'desktop',
        label: '渐隐范围',
        description: '鼠标靠近透明的圆形半径，越大让出的视野越多。',
        slider: { min: 80, max: 600, step: 10 },
        format: (value) => `${Math.round(value)}px`
      },
      {
        key: 'spectrumLocked',
        control: 'seg',
        icon: 'lock',
        label: '频谱锁定模式',
        description: '解锁后频谱铺满整屏用于拖动定位，双击任意处即可重新锁定。',
        options: [
          { value: true, displayText: '锁定（穿透鼠标）' },
          { value: false, displayText: '解锁（可拖动位置）' }
        ]
      },
      {
        key: 'spectrumResetPosition',
        control: 'action',
        icon: 'refresh',
        label: '重置频谱位置',
        customText: '重置',
        action: () => window.jello?.spectrum?.resetPosition?.(),
        description: '清除手动拖动过的位置，频谱窗口回到屏幕左下角默认锚点。'
      }
    ]
  },
  {
    title: '系统',
    items: [
      {
        key: 'hotkeyIntroSeen',
        control: 'action',
        icon: 'keyboard',
        label: '快捷呼入/呼出',
        customText: '打开',
        action: () => showTutorial(),
        description: '重新播放右 Shift 新手教程（快捷呼出面板）。'
      },
      {
        key: 'autoStart',
        control: 'toggle',
        icon: 'power',
        label: '开机自启动'
      },
      {
        key: 'preventAppSuspension',
        control: 'toggle',
        icon: 'clock',
        label: '阻止系统休眠',
        experimental: true
      },
      {
        key: 'minimizeToTray',
        control: 'toggle',
        icon: 'download',
        label: '关闭或最小化时收起到托盘'
      },
      {
        key: 'gpuAcceleration',
        control: 'toggle',
        icon: 'cpu',
        label: 'GPU 硬件加速',
        tag: '需重启',
        description: '关闭后走软件合成，兼容性更好、功耗略高；改动要重启应用才生效。'
      },
      {
        key: 'gpuRestart',
        control: 'action',
        icon: 'power',
        label: 'GPU 加速改动待生效',
        customText: '立即重启',
        visible: () => gpuRestartPending.value,
        action: () => restartForGpu()
      },
      {
        key: 'proxyEnabled',
        control: 'toggle',
        icon: 'globe',
        label: '启用代理',
        description: '全部网络请求（含接口、封面与更新下载）走代理；127.0.0.1 等回环地址始终直连。',
        // 主进程在地址为空时会回落成「跟随系统代理」，这里必须说出来，否则用户以为代理已生效
        hint: () => (settings.proxyEnabled && !settings.proxyUrl
          ? { tone: '', text: '尚未填写代理地址，当前回落为跟随系统代理' }
          : null)
      },
      {
        key: 'proxyUrl',
        control: 'field',
        icon: 'link',
        label: '代理地址',
        visible: () => !!settings.proxyEnabled,
        placeholder: 'http://127.0.0.1:7890 或 socks5://127.0.0.1:7890',
        getValue: () => proxyDraft.value,
        setValue: (value) => {
          proxyDraft.value = value;
          proxyHint.value = null;
        },
        onFocus: () => { proxyFocused.value = true; },
        onBlur: () => {
          proxyFocused.value = false;
          void saveProxyUrl();
        },
        buttonText: () => (proxyTesting.value ? '测试中…' : '测试连接'),
        buttonDisabled: () => proxyTesting.value,
        onButton: () => runProxyTest(),
        hint: () => proxyHint.value,
        description: '支持 http / https / socks4 / socks4a / socks5，可省略协议前缀；socks 必须写明端口。'
      },
      {
        key: 'apiBaseUrlMode',
        control: 'seg',
        icon: 'database',
        label: 'RPC 地址',
        options: [
          { value: 'default', displayText: '默认' },
          { value: 'custom', displayText: '自定义' }
        ],
        description: '默认走内置本地服务；切到自定义后可把酷狗 RPC 请求指向自建地址。',
        hint: () => (settings.apiBaseUrlMode === 'custom' && !settings.apiBaseUrl
          ? { tone: 'error', text: '尚未填写有效的 RPC 地址，请求仍会走内置服务' }
          : null)
      },
      {
        key: 'apiBaseUrl',
        control: 'field',
        icon: 'link',
        label: '自定义 RPC 地址',
        visible: () => settings.apiBaseUrlMode === 'custom',
        placeholder: 'https://rpc.example.com 或 http://127.0.0.1:6521',
        getValue: () => apiDraft.value,
        setValue: (value) => {
          apiDraft.value = value;
          apiHint.value = null;
        },
        onFocus: () => { apiFocused.value = true; },
        onBlur: () => {
          apiFocused.value = false;
          void saveApiBaseUrl();
        },
        buttonText: () => (apiTesting.value ? '测试中…' : '测试'),
        buttonDisabled: () => apiTesting.value,
        onButton: () => runApiBaseTest(),
        hint: () => apiHint.value,
        description: '仅允许 https，或指向本机的 http（127.0.0.1 / localhost）：token、userid、dfid 等凭据会随请求头外发，明文出网等于泄露。'
      },
      {
        key: 'log',
        control: 'action',
        icon: 'folder',
        label: '日志',
        customText: '打开目录',
        action: () => openLogs()
      },
      {
        key: 'exportLogs',
        control: 'action',
        icon: 'export',
        label: '导出日志',
        customText: '导出脱敏副本',
        action: () => exportLogs(),
        description: '另存一份去掉 token、手机号与设备标识的日志副本，便于反馈问题。'
      },
      {
        key: 'update',
        control: 'action',
        icon: 'refresh',
        label: () => updateText.value,
        description: () => `当前版本 ${version.value ? `v${version.value}` : '未知'}`,
        getText: () => updateLabel.value,
        isDisabled: () => updateDisabled.value,
        action: () => onUpdateAction()
      }
    ]
  },
  {
    title: '数据源',
    description: '数据源决定曲库和会员权益，切换后接口会自动重启；音质与数据源相互独立。',
    items: [
      {
        key: 'dataSource',
        control: 'seg',
        icon: 'database',
        label: '数据源',
        segDisabled: () => switching.value,
        options: [
          { value: 'concept', displayText: '概念版' },
          { value: 'official', displayText: '正式版' }
        ]
      }
    ]
  },
  {
    title: '账号',
    custom: 'account',
    items: [
      {
        key: 'securityVerify',
        control: 'action',
        icon: 'shield',
        label: '安全验证',
        tag: '风控',
        getText: () => (verifying.value ? '验证中…' : '重新验证'),
        isDisabled: () => verifying.value,
        action: () => runSecurityVerify()
      }
    ]
  }
];
