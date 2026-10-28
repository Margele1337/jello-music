<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { claimDailyVip, formatVipDate } from '../services/api/vip.js';
import { useAuthStore } from '../stores/auth.js';
import { useSettingsStore } from '../stores/settings.js';

const router = useRouter();
const settings = useSettingsStore();
const auth = useAuthStore();

const version = ref('');
const switching = ref(false);
const notice = ref('');
const updateState = ref({ status: 'idle', version: '', percent: 0, error: '' });
const hasUpdateBridge = ref(false);
const claimingVip = ref(false);
const vipMessage = ref('');
const vipError = ref(false);
const claimedDay = ref('');
const activeTab = ref('sound');
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

// ===== 分类 =====
const tabs = [
  { id: 'interface', title: '界面' },
  { id: 'sound', title: '声音' },
  { id: 'lyrics', title: '歌词' },
  { id: 'spectrum', title: '频谱' },
  { id: 'system', title: '系统' },
  { id: 'source', title: '数据源' },
  { id: 'account', title: '账号' },
  { id: 'update', title: '更新' }
];

// ===== 选择弹窗 =====
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
  { displayText: 'Hi-Res 无损', value: 'high' }
];

const qualityText = computed(() => (
  qualityOptions.find((option) => option.value === settings.quality)?.displayText || settings.quality
));

const openQuality = () => {
  selectionKind.value = 'option';
  selectionTitle.value = '音质选择';
  selectionOptions.value = qualityOptions;
  selectionValue.value = settings.quality;
  isSelectionOpen.value = true;
};

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

const openOutputDevice = () => {
  selectionKind.value = 'device';
  selectionTitle.value = '音频输出设备（实验性）';
  selectionOptions.value = [];
  selectionValue.value = settings.audioOutputDevice || 'default';
  isSelectionOpen.value = true;
  void loadAudioOutputDevices();
};

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

const openLyricsFont = () => {
  selectionKind.value = 'font';
  selectionTitle.value = '歌词字体设置';
  selectionOptions.value = [];
  selectionValue.value = settings.desktopLyricsFont || '';
  fontSearch.value = '';
  isSelectionOpen.value = true;
  void loadLocalFonts();
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

// ===== 声音 =====
const rates = [0.75, 1, 1.25, 1.5, 2];
const rateText = (rate) => (rate === 1 ? '1.0x' : `${rate}x`);

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

const logout = async () => {
  await auth.clear();
  setNotice('已退出登录');
};

const goLogin = () => router.push('/login');

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

const goBack = () => router.push('/');

const onKeyDown = (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  if (isSelectionOpen.value) {
    isSelectionOpen.value = false;
    return;
  }
  goBack();
};

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown);
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
  <main class="settings-page">
    <header class="settings-header">
      <button type="button" class="back-button" aria-label="返回" @click="goBack">←</button>
      <div class="title-block">
        <p class="eyebrow">JELLO MUSIC</p>
        <h1>设置</h1>
      </div>
      <span class="version">{{ version ? `v${version}` : '' }}</span>
    </header>

    <div class="settings-chips">
      <button v-for="tab in tabs" :key="tab.id" type="button" class="chip"
        :class="{ 'is-active': activeTab === tab.id }" @click="activeTab = tab.id">
        {{ tab.title }}
      </button>
    </div>

    <div class="settings-scroll">
      <!-- 界面 -->
      <section v-show="activeTab === 'interface'" class="section">
        <div class="group-label">界面</div>
        <div class="rows">
          <div class="row">
            <span class="row-label">快捷呼入/呼出</span>
            <button type="button" class="pill" @click="showTutorial">
              <span>打开</span>
            </button>
          </div>
          <p class="row-desc">重新播放右 Shift 新手教程（快捷呼出面板）。</p>
        </div>
      </section>

      <!-- 声音 -->
      <section v-show="activeTab === 'sound'" class="section">
        <div class="group-label">声音</div>
        <div class="rows">
          <div class="row">
            <span class="row-label">音质选择</span>
            <button type="button" class="pill" @click="openQuality">
              <span>{{ qualityText }}</span>
              <i class="chev">›</i>
            </button>
          </div>
          <p class="row-desc">音质与数据源相互独立；目标音质不可用时自动降级。</p>
          <div class="row">
            <span class="row-label">播放速率</span>
            <div class="seg">
              <button v-for="rate in rates" :key="rate" type="button"
                :class="{ 'is-on': Number(settings.playbackRate) === rate }"
                @click="updateSetting('playbackRate', rate)">
                {{ rateText(rate) }}
              </button>
            </div>
          </div>
          <div class="row">
            <span class="row-label">平衡音频响度</span>
            <span class="row-tag">实验性</span>
            <button type="button" class="switch" role="switch"
              :aria-checked="!!settings.loudnessNormalization"
              :class="{ 'is-on': settings.loudnessNormalization }"
              @click="updateSetting('loudnessNormalization', !settings.loudnessNormalization)">
              <i></i>
            </button>
          </div>
          <p class="row-desc">将歌曲响度统一到 -14 LUFS（Spotify 标准），切歌后生效。</p>
          <div class="row">
            <span class="row-label">音频输出设备</span>
            <button type="button" class="pill" @click="openOutputDevice">
              <span>{{ deviceText }}</span>
              <i class="chev">›</i>
            </button>
          </div>
        </div>
      </section>

      <!-- 歌词 -->
      <section v-show="activeTab === 'lyrics'" class="section">
        <div class="group-label">歌词</div>
        <div class="rows">
          <div class="row">
            <span class="row-label">显示桌面歌词</span>
            <button type="button" class="switch" role="switch"
              :aria-checked="!!settings.desktopLyrics"
              :class="{ 'is-on': settings.desktopLyrics }"
              @click="updateSetting('desktopLyrics', !settings.desktopLyrics)">
              <i></i>
            </button>
          </div>
          <div class="row">
            <span class="row-label">歌词字体设置</span>
            <button type="button" class="pill" @click="openLyricsFont">
              <span>{{ settings.desktopLyricsFont || '默认字体' }}</span>
              <i class="chev">›</i>
            </button>
          </div>
        </div>
      </section>

      <!-- 频谱 -->
      <section v-show="activeTab === 'spectrum'" class="section">
        <div class="group-label">频谱</div>
        <div class="rows">
          <div class="row">
            <span class="row-label">桌面音频频谱</span>
            <button type="button" class="switch" role="switch"
              :aria-checked="!!settings.spectrum"
              :class="{ 'is-on': settings.spectrum }"
              @click="updateSetting('spectrum', !settings.spectrum)">
              <i></i>
            </button>
          </div>
          <div class="row">
            <span class="row-label">频谱幅度</span>
            <span class="row-value">{{ Number(settings.spectrumScale).toFixed(2) }}x</span>
            <input type="range" class="slider" min="0.5" max="3" step="0.05"
              :value="settings.spectrumScale"
              @change="updateSetting('spectrumScale', Number($event.target.value))" />
          </div>
          <div class="row">
            <span class="row-label">频谱信息大小</span>
            <span class="row-value">{{ Number(settings.spectrumInfoScale).toFixed(2) }}x</span>
            <input type="range" class="slider" min="0.8" max="2" step="0.05"
              :value="settings.spectrumInfoScale"
              @change="updateSetting('spectrumInfoScale', Number($event.target.value))" />
          </div>
          <div class="row">
            <span class="row-label">平滑系数</span>
            <span class="row-value">{{ Number(settings.spectrumSigmaSmoothing).toFixed(3) }}</span>
            <input type="range" class="slider" min="0.05" max="1" step="0.005"
              :value="settings.spectrumSigmaSmoothing"
              @change="updateSetting('spectrumSigmaSmoothing', Number($event.target.value))" />
          </div>
          <div class="row">
            <span class="row-label">音画差补偿</span>
            <span class="row-value">{{ settings.spectrumAvDelayMs }}ms</span>
            <input type="range" class="slider" min="0" max="2000" step="10"
              :value="settings.spectrumAvDelayMs"
              @change="updateSetting('spectrumAvDelayMs', Number($event.target.value))" />
          </div>
          <div class="row">
            <span class="row-label">频谱信息显示</span>
            <button type="button" class="switch" role="switch"
              :aria-checked="!!settings.spectrumInfoVisible"
              :class="{ 'is-on': settings.spectrumInfoVisible }"
              @click="updateSetting('spectrumInfoVisible', !settings.spectrumInfoVisible)">
              <i></i>
            </button>
          </div>
          <div class="row">
            <span class="row-label">频谱锁定模式</span>
            <div class="seg">
              <button type="button" :class="{ 'is-on': settings.spectrumLocked }"
                @click="updateSetting('spectrumLocked', true)">锁定（穿透鼠标）</button>
              <button type="button" :class="{ 'is-on': !settings.spectrumLocked }"
                @click="updateSetting('spectrumLocked', false)">解锁（可拖动位置）</button>
            </div>
          </div>
        </div>
      </section>

      <!-- 系统 -->
      <section v-show="activeTab === 'system'" class="section">
        <div class="group-label">系统</div>
        <div class="rows">
          <div class="row">
            <span class="row-label">开机自启动</span>
            <button type="button" class="switch" role="switch"
              :aria-checked="!!settings.autoStart"
              :class="{ 'is-on': settings.autoStart }"
              @click="updateSetting('autoStart', !settings.autoStart)">
              <i></i>
            </button>
          </div>
          <div class="row">
            <span class="row-label">阻止系统休眠</span>
            <span class="row-tag">实验性</span>
            <button type="button" class="switch" role="switch"
              :aria-checked="!!settings.preventAppSuspension"
              :class="{ 'is-on': settings.preventAppSuspension }"
              @click="updateSetting('preventAppSuspension', !settings.preventAppSuspension)">
              <i></i>
            </button>
          </div>
          <div class="row">
            <span class="row-label">关闭或最小化时收起到托盘</span>
            <button type="button" class="switch" role="switch"
              :aria-checked="!!settings.minimizeToTray"
              :class="{ 'is-on': settings.minimizeToTray }"
              @click="updateSetting('minimizeToTray', !settings.minimizeToTray)">
              <i></i>
            </button>
          </div>
          <div class="row">
            <span class="row-label">日志</span>
            <button type="button" class="pill" @click="openLogs">
              <span>打开目录</span>
            </button>
          </div>
        </div>
      </section>

      <!-- 数据源 -->
      <section v-show="activeTab === 'source'" class="section">
        <div class="group-label">数据源</div>
        <div class="rows">
          <div class="row">
            <span class="row-label">接口数据源</span>
            <div class="seg">
              <button type="button" :class="{ 'is-on': settings.dataSource === 'concept' }"
                :disabled="switching" @click="setDataSource('concept')">概念版</button>
              <button type="button" :class="{ 'is-on': settings.dataSource === 'official' }"
                :disabled="switching" @click="setDataSource('official')">正式版</button>
            </div>
          </div>
          <p class="row-desc">
            数据源决定曲库和会员权益，切换后接口会自动重启；音质与数据源相互独立。
          </p>
        </div>
      </section>

      <!-- 账号 -->
      <section v-show="activeTab === 'account'" class="section">
        <div class="group-label">账号</div>
        <div class="rows">
          <div class="row">
            <span class="row-label">
              {{ auth.isAuthenticated
                ? `已登录${accountName ? ' · ' + accountName : ''}`
                : (auth.ready ? '未登录' : '登录状态读取中…') }}
            </span>
            <button v-if="auth.isAuthenticated" type="button" class="pill" @click="logout">
              <span>退出登录</span>
            </button>
            <button v-else type="button" class="pill" :disabled="!auth.ready" @click="goLogin">
              <span>扫码登录</span>
            </button>
          </div>
          <template v-if="auth.isAuthenticated">
            <div class="row">
              <span class="row-label">概念版 VIP</span>
              <button type="button" class="pill" :disabled="!canClaimVip" @click="claimVip">
                <span>{{ vipButtonLabel }}</span>
              </button>
            </div>
            <p class="row-desc">
              {{ settings.dataSource === 'concept' ? '每日可手动领取一次，请勿频繁调用。' : '切换到概念版数据源后可领取。' }}
            </p>
            <p v-if="vipMessage" class="row-desc" :class="{ 'is-error': vipError }">{{ vipMessage }}</p>
          </template>
        </div>
      </section>

      <!-- 更新 -->
      <section v-show="activeTab === 'update'" class="section">
        <div class="group-label">更新</div>
        <div class="rows">
          <div class="row">
            <span class="row-label">{{ updateText }}</span>
            <button type="button" class="pill" :disabled="updateDisabled" @click="onUpdateAction">
              <span>{{ updateLabel }}</span>
            </button>
          </div>
          <p class="row-desc">当前版本 {{ version ? `v${version}` : '未知' }}</p>
        </div>
      </section>
    </div>

    <!-- 选择弹窗 -->
    <teleport to="body">
      <div v-if="isSelectionOpen" class="modal" @click.self="isSelectionOpen = false">
        <div class="modal-content">
          <h3>{{ selectionTitle }}</h3>
          <input v-if="selectionKind === 'font'" v-model="fontSearch" class="font-search"
            placeholder="搜索字体..." />
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
            <li v-else v-for="option in fontList" :key="option.value"
              :style="{ fontFamily: option.value }"
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

    <p v-if="notice" class="notice">{{ notice }}</p>
  </main>
</template>

<style scoped>
.settings-page {
  min-height: 100%;
  max-width: 620px;
  margin: 0 auto;
  padding: 24px 36px 28px;
  overflow-y: auto;
}

.settings-header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.back-button {
  width: 34px;
  height: 34px;
  border: 1px solid #2a2434;
  border-radius: 50%;
  background: transparent;
  color: #b9b1c6;
  font: inherit;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

.back-button:hover {
  border-color: #ff69b4;
  color: #fff;
}

.title-block {
  flex: 1;
}

.title-block .eyebrow {
  font-size: 10px;
  letter-spacing: 3px;
}

.title-block h1 {
  margin: 2px 0 0;
  font-size: 26px;
  font-weight: 600;
}

.version {
  color: #544c60;
  font-size: 12px;
}

.settings-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.chip {
  padding: 7px 16px;
  border: 1px solid #2a2434;
  border-radius: 999px;
  background: transparent;
  color: #b9b1c6;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

.chip:hover {
  border-color: #ff69b4;
  color: #fff;
}

.chip.is-active {
  background: #ff69b4;
  border-color: #ff69b4;
  color: #fff;
  font-weight: 600;
}

.settings-scroll {
  margin-top: 16px;
}

.section {
  padding: 14px 16px;
  border: 1px solid #2a2434;
  border-radius: 14px;
  background: rgba(254, 254, 254, 0.045);
}

.group-label {
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #f2eef6;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  color: #b9b1c6;
  font-size: 13px;
}

.row-label {
  flex: 1;
  min-width: 0;
}

.row-value {
  flex: 0 0 auto;
  min-width: 52px;
  text-align: right;
  color: #f2eef6;
  font-size: 12px;
}

.row-tag {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255, 105, 180, 0.14);
  color: #ffc2e2;
  font-size: 10px;
}

.row-desc {
  margin: 2px 0 4px;
  padding-left: 2px;
  color: #776f83;
  font-size: 12px;
  line-height: 1.6;
}

.row-desc.is-error {
  color: #ff8f9f;
}

/* 行内开关 */
.switch {
  flex: 0 0 auto;
  width: 40px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: #2a2434;
  cursor: pointer;
  transition: background 0.2s;
}

.switch i {
  display: block;
  width: 16px;
  height: 16px;
  margin: 3px;
  border-radius: 50%;
  background: #8d8499;
  transition: transform 0.2s, background 0.2s;
}

.switch.is-on {
  background: #ff69b4;
}

.switch.is-on i {
  transform: translateX(18px);
  background: #fff;
}

/* 行内分段按钮 */
.seg {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
}

.seg button {
  padding: 5px 11px;
  border: 1px solid #2a2434;
  border-radius: 8px;
  background: transparent;
  color: #b9b1c6;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

.seg button:hover {
  border-color: #ff69b4;
  color: #fff;
}

.seg button.is-on {
  background: #ff69b4;
  border-color: #ff69b4;
  color: #fff;
  font-weight: 600;
}

.seg button:disabled {
  opacity: 0.55;
  cursor: default;
}

/* 值胶囊 */
.pill {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 6px 12px;
  border: 1px solid #2a2434;
  border-radius: 999px;
  background: transparent;
  color: #f2eef6;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

.pill:hover:not(:disabled) {
  border-color: #ff69b4;
}

.pill:disabled {
  opacity: 0.55;
  cursor: default;
}

.pill span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pill .chev {
  font-style: normal;
  color: #776f83;
}

/* 行内滑条 */
.slider {
  flex: 0 0 150px;
  accent-color: #ff69b4;
  height: 4px;
  cursor: pointer;
}

/* 弹窗 */
.modal {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}

.modal-content {
  width: min(400px, calc(100vw - 48px));
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  padding: 18px;
  border: 1px solid #2a2434;
  border-radius: 14px;
  background: #17121d;
}

.modal-content h3 {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
  color: #f2eef6;
}

.modal-content ul {
  flex: 1;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.modal-content li {
  padding: 9px 12px;
  border-radius: 8px;
  color: #b9b1c6;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.modal-content li:hover {
  background: rgba(255, 105, 180, 0.12);
  color: #fff;
}

.modal-content li.is-current {
  color: #ff69b4;
  font-weight: 600;
}

.font-search {
  margin-bottom: 10px;
  padding: 8px 12px;
  border: 1px solid #2a2434;
  border-radius: 8px;
  background: #100c15;
  color: #f2eef6;
  font: inherit;
  font-size: 13px;
  outline: none;
}

.font-search:focus {
  border-color: #ff69b4;
}

.modal-close {
  margin-top: 12px;
  padding: 8px 0;
  border: 1px solid #2a2434;
  border-radius: 8px;
  background: transparent;
  color: #b9b1c6;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.modal-close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.notice {
  margin: 16px 0 0;
  padding: 9px 14px;
  border-radius: 10px;
  background: rgba(255, 105, 180, 0.12);
  color: #ffc2e2;
  font-size: 12px;
  text-align: center;
}
</style>
