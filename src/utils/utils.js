import i18n from '@/utils/i18n';

const appFontStyleId = 'jello-custom-font';
const defaultFontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif";

const escapeCssString = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export const applyCustomFont = (fontFamily) => {
    if (typeof document === 'undefined') return;

    document.getElementById(appFontStyleId)?.remove();
    if (!fontFamily) return;

    const safeFontFamily = escapeCssString(fontFamily);
    const style = document.createElement('style');
    style.id = appFontStyleId;
    style.textContent = `
body, html, button, input, textarea, select {
    font-family: "${safeFontFamily}", ${defaultFontFamily} !important;
}`;
    document.head.appendChild(style);
};

export const getCover = (coverUrl, size) => {
    if (!coverUrl) return './assets/images/ico.png';
    return coverUrl.replace("{size}", size);
};

;

export const formatMilliseconds = (time) => {
    const milliseconds = time > 3600 ? time : time * 1000;
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}分${seconds}秒`;
};



export const requestMicrophonePermission = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;

    try {
        if (navigator.permissions?.query) {
            const status = await navigator.permissions.query({ name: 'microphone' });

            if (status.state === 'granted') {
                // 不会弹窗
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                return true;
            }

            if (status.state === 'denied') return false;
        }
    } catch {
        // permissions API 在部分环境不可用/会抛错（例如 Safari），直接走 getUserMedia
    }

    try {
        // 可能弹窗申请权限
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        return true;
    } catch {
        return false;
    }
};

export const getAudioOutputDeviceSignature = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return null;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const signatures = devices
        .filter(device => device.kind === 'audiooutput')
        .map(device => `${device.deviceId || ''}:${device.groupId || ''}`)
        .sort();
    return signatures.join('|');
};

export const openRegisterUrl = (registerUrl) => {
    if (window.electron) {
        window.electron.ipcRenderer.send('open-url', registerUrl);
    } else {
        window.open(registerUrl, '_blank');
    }
};



// 分享
import { MoeAuthStore } from '../stores/store';
export const share = (songName, id, type = 0, songDesc = '') => {
    let text = '';
    const MoeAuth = MoeAuthStore();
    let userName = 'Jello';
    if(MoeAuth.isAuthenticated) {
        userName = MoeAuth.UserInfo?.nickname || 'Jello';
    };
    // 客户端分享
    let shareUrl = '';
    if (window.electron) {
        if(type == 0){
            // 歌曲
            shareUrl = `jello://share?hash=${id}`;
        }else{
            // 歌单
            shareUrl = `jello://share?listid=${id}`;
        }
    } else {
        //  Web / H5 逻辑
        shareUrl = (window.location.host + '/#/') + (type == 0 ? `share/?hash=${id}` : `share?listid=${id}`);
    }
    text = `你的好友@${userName}分享了${songDesc}《${songName}》给你,快去听听吧! ${shareUrl}`;

    navigator.clipboard.writeText(text);
    $message.success(
        i18n.global.t('kou-ling-yi-fu-zhi,kuai-ba-ge-qu-fen-xiang-gei-peng-you-ba')
    );
};
