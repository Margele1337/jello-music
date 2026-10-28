<script setup>
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { PLAYBACK_RATES, SETTING_DEFAULTS } from '../../shared/settings.js';
import { claimDailyVip, formatVipDate } from '../services/api/vip.js';
import { useAuthStore } from '../stores/auth.js';
import { useRiskStore } from '../stores/risk.js';
import { useSettingsStore } from '../stores/settings.js';
import { useSigmaWindowDrag } from '../composables/useSigmaWindowDrag.js';

const router = useRouter();
const settings = useSettingsStore();
const auth = useAuthStore();

// 无边框窗口：设置页非控件区域拖动窗口（四边夹屏、右缘橡皮筋由主进程处理）
const SETTINGS_NO_DRAG_SELECTOR = [
  'button', 'input', 'select', 'textarea', 'a',
  '.settings-chip', '.row-pill', '.row-switch', '.row-seg', '.row-slider',
  '.modal', '.modal-content', '.font-search', '.modal-close',
  '.reset-section-btn', '.factory-reset-button', '.confirm-btn'
].join(', ');
const { onPointerDown: onSettingsDragPointerDown } = useSigmaWindowDrag({
  noDragSelector: SETTINGS_NO_DRAG_SELECTOR
});

const version = ref('');
const platform = ref('');
const footerVersionText = computed(() => {
  const parts = [];
  if (version.value) parts.push(`V${version.value}`);
  if (platform.value) parts.push(platform.value);
  return parts.join(' - ');
});
const switching = ref(false);
const notice = ref('');
const updateState = ref({ status: 'idle', version: '', percent: 0, error: '' });
const hasUpdateBridge = ref(false);
const claimingVip = ref(false);
const vipMessage = ref('');
const vipError = ref(false);
const claimedDay = ref('');
const activeTab = ref(0);
let noticeTimer = null;
let unsubscribeUpdates = null;

const setNotice = (text, duration = 3000) => {
  notice.value = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.value = '';
  }, duration);
};

const updateSetting = (key, value) => {
  void settings.update({ [key]: value })
    .catch((error) => setNotice(error?.message || '保存失败'));
};

// ===== 内联 SVG 图标（替代参考版的 Font Awesome，无新增依赖） =====
const shapePath = (d) => ({ tag: 'path', attrs: { d } });
const shapeCircle = (cx, cy, r) => ({ tag: 'circle', attrs: { cx, cy, r } });
const shapeEllipse = (cx, cy, rx, ry) => ({ tag: 'ellipse', attrs: { cx, cy, rx, ry } });
const shapeLine = (x1, y1, x2, y2) => ({ tag: 'line', attrs: { x1, y1, x2, y2 } });
const shapeRect = (x, y, width, height, rx) => ({ tag: 'rect', attrs: { x, y, width, height, rx } });
const shapePolyline = (points) => ({ tag: 'polyline', attrs: { points } });

const ICONS = {
  keyboard: [
    shapeRect(2, 4, 20, 16, 2),
    shapePath('M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8')
  ],
  headphones: [
    shapePath('M3 18v-6a9 9 0 0 1 18 0v6'),
    shapePath('M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z')
  ],
  sliders: [
    shapeLine(4, 21, 4, 14), shapeLine(4, 10, 4, 3),
    shapeLine(12, 21, 12, 12), shapeLine(12, 8, 12, 3),
    shapeLine(20, 21, 20, 16), shapeLine(20, 12, 20, 3),
    shapeLine(1, 14, 7, 14), shapeLine(9, 8, 15, 8), shapeLine(17, 16, 23, 16)
  ],
  volume: [
    shapePath('M11 5 6 9 2 9 2 15 6 15 11 19 11 5'),
    shapePath('M15.54 8.46a5 5 0 0 1 0 7.07'),
    shapePath('M19.07 4.93a10 10 0 0 1 0 14.14')
  ],
  desktop: [shapeRect(2, 3, 20, 14, 2), shapeLine(8, 21, 16, 21), shapeLine(12, 17, 12, 21)],
  font: [shapePath('M4 7V4h16v3'), shapeLine(12, 4, 12, 20), shapeLine(9, 20, 15, 20)],
  waveform: [shapePolyline('22 12 18 12 15 21 9 3 6 12 2 12')],
  chart: [shapeLine(18, 20, 18, 10), shapeLine(12, 20, 12, 4), shapeLine(6, 20, 6, 14)],
  image: [shapeRect(3, 3, 18, 18, 2), shapeCircle(8.5, 8.5, 1.5), shapePath('m21 15-5-5L5 21')],
  info: [shapeCircle(12, 12, 10), shapeLine(12, 16, 12, 12), shapeLine(12, 8, 12.01, 8)],
  clock: [shapeCircle(12, 12, 10), shapePolyline('12 6 12 12 16 14')],
  lock: [shapeRect(3, 11, 18, 11, 2), shapePath('M7 11V7a5 5 0 0 1 10 0v4')],
  power: [shapePath('M18.36 6.64a9 9 0 1 1-12.73 0'), shapeLine(12, 2, 12, 12)],
  download: [
    shapePath('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'),
    shapePolyline('7 10 12 15 17 10'),
    shapeLine(12, 15, 12, 3)
  ],
  folder: [shapePath('M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z')],
  shield: [shapePath('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z')],
  database: [
    shapeEllipse(12, 5, 9, 3),
    shapePath('M21 12c0 1.66-4 3-9 3s-9-1.34-9-3'),
    shapePath('M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5')
  ],
  user: [shapePath('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'), shapeCircle(12, 7, 4)],
  key: [
    shapePath('M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4')
  ],
  refresh: [shapePolyline('23 4 23 10 17 10'), shapePath('M20.49 15a9 9 0 1 1-2.12-9.36L23 10')],
  trash: [
    shapePolyline('3 6 5 6 21 6'),
    shapePath('M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'),
    shapeLine(10, 11, 10, 17), shapeLine(14, 11, 14, 17)
  ],
  chevron: [shapePolyline('9 18 15 12 9 6')],
  chevronLeft: [shapePolyline('15 18 9 12 15 6')]
};

const SvgIcon = (props) => h(
  'svg',
  {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  },
  (ICONS[props.name] || ICONS.sliders).map((shape) => h(shape.tag, shape.attrs))
);
SvgIcon.props = { name: { type: String, default: 'sliders' } };

// ===== 系统 =====
const openLogs = async () => {
  try {
    await window.jello?.app?.openLogs?.();
  } catch {
    setNotice('打开日志目录失败');
  }
};

const showTutorial = () => {
  updateSetting('hotkeyIntroSeen', false);
  setNotice('已重置教程，返回播放页即可查看');
};

// 酷狗风控（20028）会让所有请求失败，这里给一个手动重新验证的入口
const risk = useRiskStore();
const verifying = ref(false);

const runSecurityVerify = async () => {
  if (verifying.value) return;
  verifying.value = true;
  try {
    const result = await risk.openManualVerify();
    if (!result?.needed) setNotice(result?.reason === 'probe-error' ? (result.message || '探测请求失败') : '当前未触发风控');
    else if (result.reason === 'no-eventid') setNotice('酷狗未返回验证事件，请稍后重试');
    else if (result.verified && result.stillBlocked) setNotice('验证已通过，但风控尚未解除');
    else if (result.verified) setNotice('验证完成');
  } catch {
    setNotice('安全验证失败');
  } finally {
    verifying.value = false;
  }
};

// ===== 数据源 =====
const setDataSource = async (value) => {
  if (value === settings.dataSource || switching.value) return;
  switching.value = true;
  try {
    await settings.update({ dataSource: value });
    setNotice('数据源已切换，接口正在重启，稍后即可使用', 5000);
  } catch (error) {
    setNotice(error?.message || '数据源切换失败');
  } finally {
    switching.value = false;
  }
};

// ===== 账号 =====
const accountName = computed(() => {
  const profile = auth.profile;
  if (!profile) return '';
  return String(profile.nickname || profile.userid || '');
});

const loginStateText = computed(() => {
  if (auth.isAuthenticated) return `已登录${accountName.value ? ' · ' + accountName.value : ''}`;
  return auth.ready ? '未登录' : '登录状态读取中…';
});

const logout = async () => {
  await auth.clear();
  setNotice('已退出登录');
};

const goLogin = () => router.push('/login');

// 顶栏右侧：登录态切换（对齐旧版 sigma-view-bar 的账号按钮）
const onAccountAction = () => {
  if (auth.isAuthenticated) void logout();
  else goLogin();
};

const canClaimVip = computed(() => (
  auth.isAuthenticated
  && settings.dataSource === 'concept'
  && !claimingVip.value
  && claimedDay.value !== formatVipDate()
));

const vipButtonLabel = computed(() => {
  if (claimingVip.value) return '领取中…';
  if (claimedDay.value === formatVipDate()) return '今日已领取';
  return '领取今日 VIP';
});

const vipDescText = computed(() => (
  settings.dataSource === 'concept' ? '每日可手动领取一次，请勿频繁调用。' : '切换到概念版数据源后可领取。'
));

const claimVip = async () => {
  if (!auth.isAuthenticated) {
    vipMessage.value = '请先登录';
    vipError.value = true;
    return;
  }
  if (settings.dataSource !== 'concept') {
    vipMessage.value = '概念版 VIP 仅在概念版数据源下可领取';
    vipError.value = true;
    return;
  }

  claimingVip.value = true;
  vipMessage.value = '';
  vipError.value = false;
  try {
    const result = await claimDailyVip();
    claimedDay.value = result.day;
    vipMessage.value = result.upgradeOk
      ? '今日概念版 VIP 已领取并升级'
      : `今日 VIP 已领取${result.upgradeMessage ? `（${result.upgradeMessage}）` : ''}`;
  } catch (error) {
    vipMessage.value = error?.message || '领取失败';
    vipError.value = true;
  } finally {
    claimingVip.value = false;
  }
};

// ===== 更新 =====
const updateText = computed(() => {
  const state = updateState.value;
  switch (state.status) {
    case 'dev':
      return '开发模式不检查更新';
    case 'checking':
      return '正在检查更新…';
    case 'current':
      return '已是最新版本';
    case 'available':
      return state.version ? `发现新版本 v${state.version}` : '发现新版本';
    case 'downloading':
      return `正在下载更新 ${state.percent || 0}%`;
    case 'downloaded':
      return state.version ? `v${state.version} 已下载，重启后生效` : '更新已下载，重启后生效';
    case 'error':
      return state.error || '检查更新失败';
    default:
      return '尚未检查更新';
  }
});

const updateAction = computed(() => {
  if (updateState.value.status === 'available') return 'download';
  if (updateState.value.status === 'downloaded') return 'install';
  return 'check';
});

const updateLabel = computed(() => {
  if (updateAction.value === 'download') return '下载更新';
  if (updateAction.value === 'install') return '重启安装';
  return '检查更新';
});

const updateBusy = computed(() => ['checking', 'downloading'].includes(updateState.value.status));
const updateDisabled = computed(() => !hasUpdateBridge.value || updateBusy.value || updateState.value.status === 'dev');

const onUpdateAction = async () => {
  const bridge = window.jello?.updates;
  if (!bridge) return;
  try {
    if (updateAction.value === 'download') {
      updateState.value = await bridge.download();
    } else if (updateAction.value === 'install') {
      await bridge.install();
    } else {
      updateState.value = await bridge.check();
    }
  } catch (error) {
    setNotice(error?.message || '更新操作失败');
  }
};

// ===== 选择弹窗（音质 / 输出设备 / 歌词字体） =====
const isSelectionOpen = ref(false);
const selectionTitle = ref('');
const selectionOptions = ref([]);
const selectionValue = ref('');
const selectionKind = ref('option'); // option | device | font
const deviceOptions = ref([]);
const devicesLoading = ref(false);
const fontOptions = ref([]);
const fontsLoading = ref(false);
const fontSearch = ref('');

const qualityOptions = [
  { displayText: '标准音质 - 128Kbps', value: '128' },
  { displayText: '高品音质 - 320Kbps', value: '320' },
  { displayText: 'FLAC 无损', value: 'flac' },
  { displayText: 'Hi-Res 无损', value: 'high' },
  { displayText: '蝰蛇全景', value: 'viper_atmos' },
  { displayText: '蝰蛇超清', value: 'viper_clear' },
  { displayText: '蝰蛇母带', value: 'viper_tape' }
];

const qualityText = computed(() => (
  qualityOptions.find((option) => option.value === settings.quality)?.displayText || settings.quality
));

const onOptionPicked = (option) => {
  isSelectionOpen.value = false;
  if (selectionTitle.value === '音质选择' && option.value !== settings.quality) {
    updateSetting('quality', option.value);
    setNotice('音质已更新');
  }
};

const loadAudioOutputDevices = async () => {
  devicesLoading.value = true;
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.() || [];
    const outputs = devices.filter((device) => device.kind === 'audiooutput');
    const options = [{ displayText: '默认', value: 'default' }];
    let unnamed = 1;
    for (const output of outputs) {
      if (!output.deviceId) continue;
      options.push({
        displayText: output.label || `输出设备 ${unnamed++}`,
        value: output.deviceId
      });
    }
    deviceOptions.value = options;
  } catch {
    deviceOptions.value = [{ displayText: '默认', value: 'default' }];
  } finally {
    devicesLoading.value = false;
  }
};

const deviceText = computed(() => {
  if (!settings.audioOutputDevice || settings.audioOutputDevice === 'default') return '默认';
  return deviceOptions.value.find((option) => option.value === settings.audioOutputDevice)?.displayText
    || `已选择设备 (${settings.audioOutputDevice.slice(0, 8)}...)`;
});

const onDevicePicked = (option) => {
  isSelectionOpen.value = false;
  if (option.value !== settings.audioOutputDevice) {
    updateSetting('audioOutputDevice', option.value);
    setNotice('输出设备已更新');
  }
};

const loadLocalFonts = async () => {
  fontsLoading.value = true;
  try {
    if (!window.queryLocalFonts) {
      fontOptions.value = [];
      return;
    }
    const fonts = await window.queryLocalFonts();
    const familyMap = new Map();
    for (const font of fonts) {
      if (!font.family || !font.fullName) continue;
      if (!familyMap.has(font.family) || font.fullName.length < familyMap.get(font.family).length) {
        familyMap.set(font.family, font.fullName.length > font.family.length ? font.family : font.fullName);
      }
    }
    fontOptions.value = [
      { displayText: '默认字体', value: '' },
      ...[...familyMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([family, name]) => ({
          displayText: name === family ? family : `${name} (${family})`,
          value: family
        }))
    ];
  } catch {
    fontOptions.value = [];
  } finally {
    fontsLoading.value = false;
  }
};

const fontList = computed(() => (
  fontOptions.value.filter((option) => (
    !fontSearch.value || option.displayText.toLowerCase().includes(fontSearch.value.toLowerCase())
  ))
));

const onFontPicked = (option) => {
  isSelectionOpen.value = false;
  if (option.value !== (settings.desktopLyricsFont || '')) {
    updateSetting('desktopLyricsFont', option.value);
    setNotice('歌词字体已更新');
  }
};

const onSelectionPicked = (option) => {
  if (selectionKind.value === 'device') onDevicePicked(option);
  else if (selectionKind.value === 'font') onFontPicked(option);
  else onOptionPicked(option);
};

// ===== 播放速率 =====
const rateText = (rate) => (rate === 1 ? '1.0x' : `${rate}x`);

// ===== 设置分区 schema（对齐参考版：分类胶囊 + 卡片行 + 通用渲染器） =====
const settingSections = [
  {
    title: '界面',
    items: [
      {
        key: 'hotkeyIntroSeen',
        control: 'action',
        icon: 'keyboard',
        label: '快捷呼入/呼出',
        customText: '打开',
        action: () => showTutorial(),
        description: '重新播放右 Shift 新手教程（快捷呼出面板）。'
      }
    ]
  },
  {
    title: '声音',
    items: [
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
        label: '桌面音频频谱'
      },
      {
        key: 'spectrumScale',
        control: 'slider',
        icon: 'chart',
        label: '频谱幅度',
        slider: { min: 0.5, max: 3, step: 0.05 },
        format: (value) => `${value.toFixed(2)}x`
      },
      {
        key: 'spectrumInfoScale',
        control: 'slider',
        icon: 'image',
        label: '频谱信息大小',
        slider: { min: 0.8, max: 2, step: 0.05 },
        format: (value) => `${value.toFixed(2)}x`
      },
      {
        key: 'spectrumSigmaSmoothing',
        control: 'slider',
        icon: 'sliders',
        label: '平滑系数',
        slider: { min: 0.05, max: 1, step: 0.005 },
        format: (value) => value.toFixed(3)
      },
      {
        key: 'spectrumAvDelayMs',
        control: 'slider',
        icon: 'clock',
        label: '音画差补偿',
        slider: { min: 0, max: 2000, step: 10 },
        format: (value) => `${Math.round(value)}ms`
      },
      {
        key: 'spectrumInfoVisible',
        control: 'toggle',
        icon: 'info',
        label: '频谱信息显示'
      },
      {
        key: 'spectrumLocked',
        control: 'seg',
        icon: 'lock',
        label: '频谱锁定模式',
        options: [
          { value: true, displayText: '锁定（穿透鼠标）' },
          { value: false, displayText: '解锁（可拖动位置）' }
        ]
      }
    ]
  },
  {
    title: '系统',
    items: [
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
        key: 'log',
        control: 'action',
        icon: 'folder',
        label: '日志',
        customText: '打开目录',
        action: () => openLogs()
      },
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
    items: []
  },
  {
    title: '更新',
    custom: 'update',
    items: []
  }
];

// ===== 通用行渲染 =====
const pillText = (item) => (item.getText ? item.getText() : (item.customText || ''));
const pillDisabled = (item) => (item.isDisabled ? !!item.isDisabled() : false);

const clickPill = (item) => {
  if (item.control === 'action') {
    void item.action?.();
    return;
  }
  openSelection(item);
};

const openSelection = (item) => {
  selectionKind.value = item.selectionKind || 'option';
  selectionTitle.value = item.selectionTitle || item.label;
  if (selectionKind.value === 'device') {
    selectionOptions.value = [];
    selectionValue.value = settings.audioOutputDevice || 'default';
    isSelectionOpen.value = true;
    void loadAudioOutputDevices();
    return;
  }
  if (selectionKind.value === 'font') {
    selectionOptions.value = [];
    selectionValue.value = settings.desktopLyricsFont || '';
    fontSearch.value = '';
    isSelectionOpen.value = true;
    void loadLocalFonts();
    return;
  }
  selectionOptions.value = qualityOptions;
  selectionValue.value = settings.quality;
  isSelectionOpen.value = true;
};

const segIsOn = (item, option) => String(settings[item.key]) === String(option.value);
const segDisabled = (item) => (item.segDisabled ? !!item.segDisabled() : false);
const onSegClick = (item, option) => {
  if (item.key === 'dataSource') {
    void setDataSource(option.value);
    return;
  }
  updateSetting(item.key, option.value);
};

const sliderDisplay = (item) => item.format(Number(settings[item.key]));

// ===== 按分类重置：仅把该分类中存在于 SETTING_DEFAULTS 的键恢复默认 =====
const sectionResetPatch = (section) => {
  const patch = {};
  for (const item of section.items || []) {
    if (Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, item.key)) {
      patch[item.key] = SETTING_DEFAULTS[item.key];
    }
  }
  return patch;
};

const hasSectionReset = (section) => Object.keys(sectionResetPatch(section)).length > 0;

const resetSection = async (section) => {
  const patch = sectionResetPatch(section);
  if (!Object.keys(patch).length) return;
  try {
    await settings.update(patch);
    setNotice(`「${section.title}」已恢复默认设置`);
  } catch (error) {
    setNotice(error?.message || '重置失败');
  }
};

// ===== 恢复出厂设置：用页面自己的弹窗做二次确认（不用 window.confirm） =====
const confirmDialog = ref(null);

const openConfirm = (config) => {
  confirmDialog.value = config;
};

const closeConfirm = () => {
  confirmDialog.value = null;
};

const runConfirm = async () => {
  const dialog = confirmDialog.value;
  confirmDialog.value = null;
  try {
    await dialog?.onConfirm?.();
  } catch (error) {
    setNotice(error?.message || '恢复出厂设置失败');
  }
};

const factoryReset = () => {
  openConfirm({
    title: '重置应用',
    message: '确定恢复出厂设置？此操作不可逆！',
    confirmText: '恢复出厂设置',
    onConfirm: async () => {
      // 全部偏好恢复默认（settings:set 走主进程持久化）
      await settings.update({ ...SETTING_DEFAULTS });
      // 清登录态
      await auth.clear();
      // 清渲染层 localStorage：桌面歌词窗口把颜色/锁定/字号存在这里
      try {
        localStorage.clear();
      } catch {
        // 忽略
      }
      // 打开用户数据目录，方便残留文件交接（对齐参考版意图）
      try {
        await window.jello?.app?.openLogs?.();
      } catch {
        // 忽略
      }
      setNotice('恢复出厂设置成功，请重启应用', 5000);
    }
  });
};

// ===== 导航 / ESC =====
const goBack = () => router.push('/');

const onKeyDown = (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  if (confirmDialog.value) {
    closeConfirm();
    return;
  }
  if (isSelectionOpen.value) {
    isSelectionOpen.value = false;
    return;
  }
  goBack();
};

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown);
  platform.value = window.jello?.app?.platform || '';
  try {
    version.value = await window.jello?.app?.getVersion?.() || '';
  } catch {
    version.value = '';
  }

  if (window.jello?.updates) {
    hasUpdateBridge.value = true;
    try {
      updateState.value = await window.jello.updates.get();
    } catch {
      /* keep default state */
    }
    unsubscribeUpdates = window.jello.updates.onState((next) => {
      updateState.value = next || updateState.value;
    });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  clearTimeout(noticeTimer);
  unsubscribeUpdates?.();
  unsubscribeUpdates = null;
});
</script>

<template>
  <main class="settings-page" @pointerdown="onSettingsDragPointerDown">
    <!-- 顶栏：返回 + 登录/退出（对齐旧版 sigma-view-bar） -->
    <div class="settings-view-bar">
      <button type="button" class="back-btn" title="返回" aria-label="返回" @click="goBack">
        <SvgIcon name="chevronLeft" />
      </button>
      <button type="button" class="switch-account" @click="onAccountAction">
        {{ auth.isAuthenticated ? '退出登录' : '登录' }}
      </button>
    </div>

    <!-- 分类胶囊（替代左侧栏） -->
    <div class="settings-chips">
      <button v-for="(section, sectionIndex) in settingSections" :key="section.title" type="button"
        class="settings-chip" :class="{ 'is-active': activeTab === sectionIndex }" @click="activeTab = sectionIndex">
        {{ section.title }}
      </button>
    </div>

    <div class="settings-scroll">
      <div v-for="(section, sectionIndex) in settingSections" :key="section.title" v-show="activeTab === sectionIndex"
        class="setting-section">
        <div class="group-label">{{ section.title }}</div>
        <div class="settings-rows">
          <!-- 账号：登录态 + 概念版 VIP -->
          <template v-if="section.custom === 'account'">
            <div class="setting-row">
              <div class="row-main">
                <SvgIcon name="user" class="row-icon" />
                <span class="row-label">{{ loginStateText }}</span>
              </div>
              <button v-if="auth.isAuthenticated" type="button" class="row-pill" @click.stop="logout">
                <span>退出登录</span>
                <SvgIcon name="chevron" />
              </button>
              <button v-else type="button" class="row-pill" :disabled="!auth.ready" @click.stop="goLogin">
                <span>扫码登录</span>
                <SvgIcon name="chevron" />
              </button>
            </div>
            <template v-if="auth.isAuthenticated">
              <div class="setting-row">
                <div class="row-main">
                  <SvgIcon name="key" class="row-icon" />
                  <span class="row-label">概念版 VIP</span>
                </div>
                <button type="button" class="row-pill" :disabled="!canClaimVip" @click.stop="claimVip">
                  <span>{{ vipButtonLabel }}</span>
                  <SvgIcon name="chevron" />
                </button>
              </div>
              <p class="row-desc">{{ vipDescText }}</p>
              <p v-if="vipMessage" class="row-desc" :class="{ 'is-error': vipError }">{{ vipMessage }}</p>
            </template>
          </template>

          <!-- 更新：状态 + 检查/下载/重启安装 -->
          <template v-else-if="section.custom === 'update'">
            <div class="setting-row">
              <div class="row-main">
                <SvgIcon name="refresh" class="row-icon" />
                <span class="row-label">{{ updateText }}</span>
              </div>
              <button type="button" class="row-pill" :disabled="updateDisabled" @click.stop="onUpdateAction">
                <span>{{ updateLabel }}</span>
                <SvgIcon name="chevron" />
              </button>
            </div>
            <p class="row-desc">当前版本 {{ version ? `v${version}` : '未知' }}</p>
          </template>

          <!-- 通用行渲染 -->
          <template v-else v-for="(item, itemIndex) in section.items" :key="itemIndex">
            <div class="setting-row">
              <div class="row-main">
                <SvgIcon :name="item.icon" class="row-icon" />
                <span class="row-label">{{ item.label }}</span>
                <span v-if="item.experimental" class="row-tag">实验性</span>
                <span v-else-if="item.tag" class="row-tag">{{ item.tag }}</span>
              </div>

              <!-- 开关型：行内开关 -->
              <button v-if="item.control === 'toggle'" type="button" class="row-switch"
                :class="{ 'is-on': !!settings[item.key] }" role="switch" :aria-checked="!!settings[item.key]"
                :aria-label="item.label" @click.stop="updateSetting(item.key, !settings[item.key])">
                <i></i>
              </button>

              <!-- 少量选项：行内分段按钮 -->
              <div v-else-if="item.control === 'seg'" class="row-seg">
                <button v-for="option in item.options" :key="String(option.value)" type="button"
                  :class="{ 'is-on': segIsOn(item, option) }" :disabled="segDisabled(item)"
                  @click.stop="onSegClick(item, option)">
                  {{ option.displayText }}
                </button>
              </div>

              <!-- 滑条型：行内滑条 + 数值 -->
              <div v-else-if="item.control === 'slider'" class="row-slider-wrap">
                <span class="row-value">{{ sliderDisplay(item) }}</span>
                <input type="range" class="row-slider" :min="item.slider.min" :max="item.slider.max"
                  :step="item.slider.step" :value="settings[item.key]"
                  @change="updateSetting(item.key, Number($event.target.value))" />
              </div>

              <!-- 长列表 / 字体 / 设备 / 动作：值胶囊 -->
              <button v-else type="button" class="row-pill" :disabled="pillDisabled(item)" @click.stop="clickPill(item)">
                <span>{{ pillText(item) }}</span>
                <SvgIcon name="chevron" />
              </button>
            </div>

            <p v-if="item.description" class="row-desc">{{ item.description }}</p>
          </template>
        </div>
        <p v-if="section.description" class="group-desc">{{ section.description }}</p>
        <div v-if="hasSectionReset(section)" class="group-footer">
          <button type="button" class="reset-section-btn" @click="resetSection(section)">
            <SvgIcon name="refresh" />
            重置{{ section.title }}
          </button>
        </div>
      </div>

      <div class="settings-footer">
        <div class="version-info">
          <p>© Jello Music</p>
          <span>{{ footerVersionText }}</span>
        </div>
        <button type="button" class="factory-reset-button" @click="factoryReset">
          <SvgIcon name="trash" />
          重置应用
        </button>
      </div>
    </div>

    <!-- 选择弹窗：只服务长列表（音质 / 字体 / 输出设备） -->
    <teleport to="body">
      <div v-if="isSelectionOpen" class="modal" @click.self="isSelectionOpen = false">
        <div class="modal-content">
          <h3>{{ selectionTitle }}</h3>
          <input v-if="selectionKind === 'font'" v-model="fontSearch" class="font-search" placeholder="搜索字体..." />
          <ul v-if="selectionKind === 'device'">
            <li v-if="devicesLoading">正在获取设备列表...</li>
            <li v-else-if="deviceOptions.length === 0">未检测到音频输出设备</li>
            <li v-else v-for="option in deviceOptions" :key="option.value"
              :class="{ 'is-current': option.value === selectionValue }" @click="onSelectionPicked(option)">
              {{ option.displayText }}
            </li>
          </ul>
          <ul v-else-if="selectionKind === 'font'" class="font-list">
            <li v-if="fontsLoading">加载中...</li>
            <li v-else-if="fontList.length === 0">默认字体</li>
            <li v-else v-for="option in fontList" :key="option.value" :style="{ fontFamily: option.value }"
              :class="{ 'is-current': option.value === selectionValue }" @click="onSelectionPicked(option)">
              {{ option.displayText }}
            </li>
          </ul>
          <ul v-else>
            <li v-for="option in selectionOptions" :key="option.value"
              :class="{ 'is-current': option.value === selectionValue }" @click="onSelectionPicked(option)">
              {{ option.displayText }}
            </li>
          </ul>
          <button type="button" class="modal-close" @click="isSelectionOpen = false">关闭</button>
        </div>
      </div>
    </teleport>

    <!-- 二次确认弹窗（恢复出厂设置）：复用页面自己的弹窗外观 -->
    <teleport to="body">
      <div v-if="confirmDialog" class="modal" @click.self="closeConfirm">
        <div class="modal-content">
          <h3>{{ confirmDialog.title }}</h3>
          <p class="confirm-message">{{ confirmDialog.message }}</p>
          <div class="modal-actions">
            <button type="button" class="modal-close" @click="closeConfirm">取消</button>
            <button type="button" class="confirm-btn" @click="runConfirm">{{ confirmDialog.confirmText }}</button>
          </div>
        </div>
      </div>
    </teleport>

    <p v-if="notice" class="notice">{{ notice }}</p>
  </main>
</template>

<style scoped>
/* 参考版 SCSS 变量（原样展开为普通 CSS，目标仓库不引入 sass）：
   $accent #FF69B4 / $accent-soft rgba(255,105,180,0.16) / $text #ece9f1 /
   $text-muted rgba(236,233,241,0.55) / $text-faint rgba(236,233,241,0.35) /
   $row-bg rgba(254,254,254,0.045) / $row-border rgba(254,254,254,0.07)。
   字体栈：参考版的 JelloLight 在本仓库不存在，替换为 src/styles.css 的
   'Segoe UI','Microsoft YaHei'，保留其余回退。 */
.settings-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  /* 无边框透明窗口：设置页自铺不透明底。旧版设置是 v-if 换页、播放器不在
     底下，0.96 的底看不出透影；新版播放器常驻、设置叠在上面，半透明会把
     播放器透出来，故用实色还原旧版观感 */
  background: #101114;
  font-family: 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif;
  color: #ece9f1;
  overflow: hidden;
  animation: settings-fade 0.25s ease;
}

@keyframes settings-fade {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

/* ===== 顶栏（对齐旧版 sigma-view-bar） ===== */
.settings-view-bar {
  height: 48px;
  flex: 0 0 48px;
  display: flex;
  align-items: center;
  padding: 0 10px;
}

.back-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: rgba(254, 254, 254, 0.1);
  color: #fefefe;
  cursor: pointer;
  transition: background 0.15s ease;
}

.back-btn:hover {
  background: rgba(254, 254, 254, 0.2);
}

.back-btn svg {
  width: 14px;
  height: 14px;
}

.switch-account {
  margin-left: auto;
  height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  background: rgba(254, 254, 254, 0.1);
  color: #fefefe;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.switch-account:hover {
  background: rgba(254, 254, 254, 0.2);
}

/* ===== 分类胶囊 ===== */
.settings-chips {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
  padding: 8px 18px 10px;
}

.settings-chip {
  height: 30px;
  padding: 0 18px;
  border: none;
  border-radius: 999px;
  background: rgba(254, 254, 254, 0.06);
  color: rgba(236, 233, 241, 0.55);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, box-shadow 0.12s;
}

.settings-chip:hover {
  background: rgba(254, 254, 254, 0.12);
  color: #ece9f1;
}

.settings-chip.is-active {
  background: #FF69B4;
  color: #fff;
  box-shadow: 0 3px 12px rgba(255, 105, 180, 0.4);
}

/* ===== 滚动区 ===== */
.settings-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 18px 16px;
}

/* 隐藏滚动条（保留滚动）：主滚动区与弹窗统一处理 */
.settings-scroll,
.modal-content,
.modal-content ul {
  scrollbar-width: none;
}

.settings-scroll::-webkit-scrollbar,
.modal-content::-webkit-scrollbar,
.modal-content ul::-webkit-scrollbar {
  display: none;
}

.group-label {
  font-size: 12px;
  letter-spacing: 3px;
  color: #FF69B4;
  margin: 10px 2px 10px;
}

.group-desc {
  margin: 10px 2px 0;
  color: rgba(236, 233, 241, 0.55);
  font-size: 12px;
  line-height: 1.7;
}

.row-desc {
  margin: -1px 4px 2px;
  color: rgba(236, 233, 241, 0.55);
  font-size: 11.5px;
  line-height: 1.6;
}

.row-desc.is-error {
  color: #ff8f8f;
}

.settings-rows {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

/* ===== 设置行 ===== */
.setting-row {
  background: rgba(254, 254, 254, 0.045);
  border: 1px solid rgba(254, 254, 254, 0.07);
  border-radius: 10px;
  padding: 10px 14px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  transition: border-color 0.12s, background 0.12s;
}

.setting-row:hover {
  background: rgba(254, 254, 254, 0.07);
  border-color: rgba(255, 105, 180, 0.35);
}

.row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

/* 对齐参考版 .row-main > i：强调色、13px 字号、18px 宽、居中 */
.row-main .row-icon {
  color: #FF69B4;
  width: 18px;
  height: 18px;
  font-size: 13px;
  text-align: center;
  flex: 0 0 auto;
}

.row-label {
  font-size: 14px;
  color: #ece9f1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-tag {
  font-size: 11px;
  color: rgba(236, 233, 241, 0.35);
  border: 1px solid rgba(254, 254, 254, 0.16);
  border-radius: 4px;
  padding: 1px 6px;
  flex: 0 0 auto;
}

/* ===== 行内开关 ===== */
.row-switch {
  width: 40px;
  height: 22px;
  flex: 0 0 auto;
  border: none;
  border-radius: 999px;
  background: rgba(254, 254, 254, 0.16);
  position: relative;
  cursor: pointer;
  transition: background 0.15s;
  padding: 0;
}

.row-switch i {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fefefe;
  transition: transform 0.15s;
}

.row-switch.is-on {
  background: #FF69B4;
}

.row-switch.is-on i {
  transform: translateX(18px);
}

/* ===== 行内分段按钮 ===== */
.row-seg {
  display: flex;
  gap: 4px;
  background: rgba(254, 254, 254, 0.06);
  border-radius: 999px;
  padding: 3px;
  flex: 0 0 auto;
}

.row-seg button {
  height: 24px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: rgba(236, 233, 241, 0.55);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.row-seg button:hover:not(:disabled) {
  color: #ece9f1;
}

.row-seg button.is-on {
  background: #FF69B4;
  color: #fff;
}

.row-seg button:disabled {
  opacity: 0.55;
  cursor: default;
}

/* ===== 行内滑条 ===== */
.row-slider-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.row-value {
  font-size: 13px;
  color: rgba(255, 154, 213, 0.9);
  min-width: 52px;
  text-align: right;
}

.row-slider {
  width: 140px;
  accent-color: #FF69B4;
  cursor: pointer;
}

/* ===== 值胶囊 ===== */
.row-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 14px;
  border: none;
  border-radius: 999px;
  background: rgba(254, 254, 254, 0.08);
  color: rgba(236, 233, 241, 0.55);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  max-width: 240px;
  flex: 0 0 auto;
  transition: background 0.12s;
}

.row-pill span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-pill svg {
  width: 10px;
  height: 10px;
  opacity: 0.5;
  flex: 0 0 auto;
}

.row-pill:hover:not(:disabled) {
  background: rgba(254, 254, 254, 0.16);
  color: #ece9f1;
}

.row-pill:disabled {
  opacity: 0.55;
  cursor: default;
}

/* ===== 分组底部 / 页面底部 ===== */
.group-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.reset-section-btn {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: rgba(236, 233, 241, 0.35);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
}

.reset-section-btn svg {
  width: 12px;
  height: 12px;
  margin-right: 6px;
}

.reset-section-btn:hover {
  color: #ece9f1;
  background: rgba(254, 254, 254, 0.06);
}

.settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
  padding: 12px 4px 4px;
  border-top: 1px solid rgba(254, 254, 254, 0.07);
}

.version-info p {
  margin: 0 0 2px;
  font-size: 12px;
  color: rgba(236, 233, 241, 0.55);
}

.version-info span {
  font-size: 11px;
  color: rgba(236, 233, 241, 0.35);
}

.factory-reset-button {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 16px;
  border: 1px solid rgba(255, 105, 180, 0.35);
  border-radius: 999px;
  background: rgba(255, 105, 180, 0.16);
  color: rgba(255, 154, 213, 0.95);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s;
}

.factory-reset-button svg {
  width: 12px;
  height: 12px;
  margin-right: 6px;
}

.factory-reset-button:hover {
  background: rgba(255, 105, 180, 0.28);
}

/* ===== 弹窗（深色玻璃） ===== */
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  width: 320px;
  max-width: calc(100% - 48px);
  max-height: 70vh;
  overflow-y: auto;
  background: rgba(22, 20, 28, 0.97);
  border: 1px solid rgba(254, 254, 254, 0.1);
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.modal-content h3 {
  margin: 0;
  font-family: inherit;
  font-size: 17px;
  font-weight: 500;
  color: #ece9f1;
  text-align: center;
}

.modal-content ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 300px;
  overflow-y: auto;
}

.modal-content li {
  padding: 8px 12px;
  border-radius: 8px;
  font-family: inherit;
  font-size: 13px;
  color: rgba(236, 233, 241, 0.55);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.modal-content li:hover {
  background: rgba(255, 105, 180, 0.16);
  color: #ece9f1;
}

.modal-content li.is-current {
  color: #FF69B4;
  font-weight: 600;
}

.font-search {
  height: 32px;
  border: 1px solid rgba(254, 254, 254, 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  color: #ece9f1;
  font-family: inherit;
  font-size: 13px;
  padding: 0 10px;
  outline: none;
}

.font-search:focus {
  border-color: #FF69B4;
}

.modal-close {
  height: 32px;
  border: none;
  border-radius: 999px;
  background: rgba(254, 254, 254, 0.08);
  color: #ece9f1;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
}

.modal-close:hover {
  background: rgba(254, 254, 254, 0.16);
}

/* ===== 二次确认弹窗 ===== */
.confirm-message {
  margin: 0;
  color: rgba(236, 233, 241, 0.55);
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
}

.modal-actions {
  display: flex;
  gap: 8px;
}

.modal-actions .modal-close {
  flex: 1;
}

.confirm-btn {
  flex: 1;
  height: 32px;
  border: none;
  border-radius: 999px;
  background: #FF69B4;
  color: #fff;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
}

.confirm-btn:hover {
  background: #ff7fbf;
}

/* ===== 提示条 ===== */
.notice {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  z-index: 1100;
  max-width: calc(100% - 48px);
  margin: 0;
  padding: 9px 18px;
  border: 1px solid rgba(254, 254, 254, 0.1);
  border-radius: 999px;
  background: rgba(22, 20, 28, 0.97);
  color: rgba(255, 154, 213, 0.95);
  font-size: 12px;
  text-align: center;
}
</style>
