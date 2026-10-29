<template>
  <div class="modal" @click.self="onBackdrop">
    <div class="sheet">
      <h3 class="title">全局快捷键</h3>
      <p class="hint">点击要修改的键位，再按下新的组合键；录制中按 Esc 取消本行录制。</p>

      <ul class="list">
        <li v-for="action in actions" :key="action" class="item">
          <div class="line">
            <span class="label">{{ shortcutActionLabel(action) }}</span>
            <button type="button" class="field" :class="fieldClass(action)"
              :aria-label="`${shortcutActionLabel(action)} 当前键位 ${displayOf(action)}`" @click="toggleRecording(action)">
              {{ fieldText(action) }}
            </button>
          </div>
          <p v-if="noteOf(action)" class="note" :class="{ 'is-error': noteIsError(action) }">{{ noteOf(action) }}</p>
        </li>
      </ul>

      <p v-if="recordError" class="record-error">{{ recordError }}</p>

      <div class="actions">
        <button type="button" class="ghost" @click="emit('close')">关闭</button>
        <button type="button" class="ghost" :disabled="busy" @click="emit('restore')">恢复默认</button>
        <button type="button" class="primary" :disabled="!isDirty || busy || hasDuplicate" @click="save">
          {{ busy ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
// 快捷键录制面板：12 个动作逐行录制，键位合法性完全交给 shared 的 normalizeAccelerator，
// 这里只负责「录到什么 / 为什么不能存」的呈现。保存由父级走 settings.set，
// 主进程注册失败的动作通过 failures 逐行标注，其余动作保持生效。
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { SHORTCUT_ACTIONS } from '../../../shared/settings.js';
import {
  chordErrorMessage,
  chordFromKeyEvent,
  failuresByAction,
  findDuplicateAccelerators,
  formatAccelerator,
  shortcutActionLabel
} from './shortcutChords.js';

const props = defineProps({
  shortcuts: { type: Object, required: true },
  failures: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  platform: { type: String, default: '' }
});

const emit = defineEmits(['close', 'save', 'restore']);

const actions = SHORTCUT_ACTIONS;
const draft = ref({ ...props.shortcuts });
const recording = ref('');
const recordError = ref('');

watch(() => props.shortcuts, (next) => {
  draft.value = { ...next };
  recordError.value = '';
}, { deep: true });

const normalizeValue = (action) => String(draft.value?.[action] ?? '');

const displayOf = (action) => formatAccelerator(normalizeValue(action), props.platform) || '未设置';

const duplicates = computed(() => findDuplicateAccelerators(draft.value));
const failureMap = computed(() => failuresByAction(props.failures));
const hasDuplicate = computed(() => Object.keys(duplicates.value).length > 0);
const isDirty = computed(() => actions.some((action) => (
  normalizeValue(action) !== String(props.shortcuts?.[action] ?? '')
)));

const fieldText = (action) => (recording.value === action ? '按下组合键…' : displayOf(action));

const fieldClass = (action) => ({
  'is-recording': recording.value === action,
  'is-invalid': !!duplicates.value[action] || !!failureMap.value[action]
});

const noteOf = (action) => {
  if (duplicates.value[action]) return '与其他动作的键位重复，保存前请先改掉';
  const failure = failureMap.value[action];
  return failure ? `注册失败：${failure.text}` : '';
};

const noteIsError = (action) => !!duplicates.value[action] || !!failureMap.value[action];

const stopRecording = () => {
  if (!recording.value) return;
  recording.value = '';
  window.removeEventListener('keydown', onRecordKey, true);
};

const toggleRecording = (action) => {
  if (recording.value === action) {
    stopRecording();
    return;
  }
  recordError.value = '';
  recording.value = action;
  window.removeEventListener('keydown', onRecordKey, true);
  window.addEventListener('keydown', onRecordKey, true);
};

// 捕获阶段 + stopPropagation：录制时的按键不能被播放页的全局按键逻辑（右 Shift 教程等）吃掉
const onRecordKey = (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    stopRecording();
    return;
  }
  const action = recording.value;
  if (!action) return;
  const chord = chordFromKeyEvent(event);
  if (chord.ignored) return;
  if (!chord.accelerator) {
    recordError.value = chordErrorMessage(chord.error);
    return;
  }
  draft.value = { ...draft.value, [action]: chord.accelerator };
  recordError.value = '';
  stopRecording();
};

const save = () => {
  if (!isDirty.value || hasDuplicate.value) return;
  emit('save', { ...draft.value });
};

const onBackdrop = () => {
  if (recording.value) {
    stopRecording();
    return;
  }
  emit('close');
};

// 只在真正录键的那几秒挂起系统热键：否则用户按下的组合键会先被旧注册吃掉，
// 既录不到键又会误触发（比如 Alt+Ctrl+M 当场把声音静音）
let suspendRequested = false;
const applySuspend = (value) => {
  const bridge = window.jello?.shortcuts?.setSuspended;
  if (typeof bridge !== 'function' || suspendRequested === value) return;
  suspendRequested = value;
  Promise.resolve(bridge(value)).catch(() => { /* 主进程未就绪：不阻塞录键 UI */ });
};

watch(recording, (value) => { applySuspend(!!value); });

onBeforeUnmount(() => {
  stopRecording();
  applySuspend(false);
});
</script>

<style scoped>
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

/* 复刻设置页弹窗的深色玻璃外观（scoped 样式不跨组件，故自带一份同参数样式） */
.sheet {
  width: 380px;
  max-width: calc(100% - 48px);
  max-height: 76vh;
  overflow-y: auto;
  background: rgba(22, 20, 28, 0.97);
  border: 1px solid rgba(254, 254, 254, 0.1);
  border-radius: 16px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scrollbar-width: none;
}

.sheet::-webkit-scrollbar {
  display: none;
}

.title {
  margin: 0;
  font-family: inherit;
  font-size: 17px;
  font-weight: 500;
  color: #ece9f1;
  text-align: center;
}

.hint {
  margin: 0;
  color: rgba(236, 233, 241, 0.55);
  font-size: 11.5px;
  line-height: 1.6;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.item {
  padding: 3px 0;
  border-bottom: 1px solid rgba(254, 254, 254, 0.05);
}

.line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.label {
  font-size: 12.5px;
  color: #ece9f1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.field {
  flex: 0 0 auto;
  min-width: 122px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(254, 254, 254, 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  color: rgba(236, 233, 241, 0.85);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}

.field:hover {
  border-color: rgba(255, 105, 180, 0.5);
  color: #ece9f1;
}

.field.is-recording {
  border-color: #FF69B4;
  color: #FF69B4;
  background: rgba(255, 105, 180, 0.12);
}

.field.is-invalid {
  border-color: rgba(255, 143, 143, 0.7);
  color: #ff8f8f;
}

.note {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(236, 233, 241, 0.4);
}

.note.is-error {
  color: #ff8f8f;
}

.record-error {
  margin: 0;
  padding: 7px 10px;
  border: 1px solid rgba(255, 143, 143, 0.35);
  border-radius: 8px;
  background: rgba(255, 105, 105, 0.1);
  color: #ff8f8f;
  font-size: 11.5px;
  line-height: 1.5;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}

.ghost {
  flex: 1;
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

.ghost:hover:not(:disabled) {
  background: rgba(254, 254, 254, 0.16);
}

.ghost:disabled {
  opacity: 0.55;
  cursor: default;
}

.primary {
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

.primary:hover:not(:disabled) {
  background: #ff7fbf;
}

.primary:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
