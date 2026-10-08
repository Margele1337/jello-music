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

export const applyColorTheme = (theme) => {
    let colors;
    if (theme === 'rise') {
        colors = {
            '--primary-color': '#1a9aba',
            '--primary-color-rgb': '26, 154, 186',
            '--secondary-color': '#0d5e7a',
            '--background-color': 'rgba(8, 24, 36, var(--glass-opacity))',
            '--background-color-secondary': 'rgba(12, 36, 52, var(--glass-opacity))',
            '--color-primary': '#1a9aba',
            '--color-primary-light': 'rgba(26, 154, 186, 0.12)',
            '--border-color': 'rgba(26, 154, 186, var(--glass-border))',
            '--hover-color': 'rgba(26, 154, 186, calc(var(--glass-opacity) * 0.5))',
            '--color-secondary-bg-for-transparent': 'rgba(26, 154, 186, 0.15)',
            '--color-box-shadow': 'rgba(26, 154, 186, 0.3)',
        };
    } else if (theme === 'blue') {
        colors = {
            '--primary-color': '#4A90E2',
            '--primary-color-rgb': '74, 144, 226',
            '--secondary-color': '#AEDFF7',
            '--background-color': 'rgba(232, 244, 250, var(--glass-opacity))',
            '--background-color-secondary': 'rgba(217, 238, 250, var(--glass-opacity))',
            '--color-primary': '#2A6DAF',
            '--color-primary-light': 'rgba(74, 144, 226, 0.1)',
            '--border-color': 'rgba(197, 224, 245, var(--glass-border))',
            '--hover-color': 'rgba(209, 233, 249, calc(var(--glass-opacity) * 0.8))',
            '--color-secondary-bg-for-transparent': 'rgba(174, 223, 247, 0.22)',
            '--color-box-shadow': 'rgba(74, 144, 226, 0.15)',
        };
    } else if (theme === 'green') {
        colors = {
            '--primary-color': '#34C759',
            '--primary-color-rgb': '52, 199, 89',
            '--secondary-color': '#A7F3D0',
            '--background-color': 'rgba(229, 249, 240, var(--glass-opacity))',
            '--background-color-secondary': 'rgba(208, 245, 230, var(--glass-opacity))',
            '--color-primary': '#28A745',
            '--color-primary-light': 'rgba(52, 199, 89, 0.1)',
            '--border-color': 'rgba(184, 236, 215, var(--glass-border))',
            '--hover-color': 'rgba(201, 242, 226, calc(var(--glass-opacity) * 0.8))',
            '--color-secondary-bg-for-transparent': 'rgba(167, 243, 208, 0.22)',
            '--color-box-shadow': 'rgba(52, 199, 89, 0.15)',
        };
    } else if (theme === 'orange') {
        colors = {
            '--primary-color': '#ff6b6b',
            '--primary-color-rgb': '255, 107, 107',
            '--secondary-color': '#FFB6C1',
            '--background-color': 'rgba(255, 240, 245, var(--glass-opacity))',
            '--background-color-secondary': 'rgba(255, 230, 236, var(--glass-opacity))',
            '--color-primary': '#f36868',
            '--color-primary-light': 'rgba(255, 107, 107, 0.1)',
            '--border-color': 'rgba(255, 220, 227, var(--glass-border))',
            '--hover-color': 'rgba(255, 233, 239, calc(var(--glass-opacity) * 0.8))',
            '--color-secondary-bg-for-transparent': 'rgba(209, 209, 214, 0.22)',
            '--color-box-shadow': 'rgba(255, 107, 107, 0.15)',
        };
    } else {
        colors = {
            '--primary-color': '#E18FA8',
            '--primary-color-rgb': '225, 143, 168',
            '--secondary-color': '#F2C7D4',
            '--background-color': 'rgba(252, 240, 245, var(--glass-opacity))',
            '--background-color-secondary': 'rgba(250, 232, 240, var(--glass-opacity))',
            '--color-primary': '#C06C88',
            '--color-primary-light': 'rgba(225, 143, 168, 0.12)',
            '--border-color': 'rgba(238, 213, 223, var(--glass-border))',
            '--hover-color': 'rgba(248, 235, 241, calc(var(--glass-opacity) * 0.8))',
            '--color-secondary-bg-for-transparent': 'rgba(209, 209, 214, 0.22)',
            '--color-box-shadow': 'rgba(225, 143, 168, 0.18)',
        };
    }

    Object.keys(colors).forEach(key => {
        document.documentElement.style.setProperty(key, colors[key]);
    });
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

let themeMediaQueryListener = null;
export const setTheme = (theme) => {
    const html = document.documentElement;
    const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');

    if (themeMediaQueryListener) {
        prefersDarkScheme.removeEventListener('change', themeMediaQueryListener);
        themeMediaQueryListener = null;
    }

    const applyTheme = (isDark) => {
        if (isDark) {
            html.classList.add('dark');
        } else {
            html.classList.remove('dark');
        }
    };

    switch (theme) {
        case 'dark':
            applyTheme(true);
            localStorage.setItem('theme', 'dark');
            break;
        case 'light':
            applyTheme(false);
            localStorage.setItem('theme', 'light');
            break;
        case 'auto':
            localStorage.setItem('theme', 'auto');
            applyTheme(prefersDarkScheme.matches);
            themeMediaQueryListener = (e) => {
                applyTheme(e.matches);
            };
            prefersDarkScheme.addEventListener('change', themeMediaQueryListener);
            break;
    }
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
