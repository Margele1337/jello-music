import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
import { t } from '../language/i18n.js';

let silentCheck = false;
autoUpdater.autoDownload = false; // 自动下载更新
autoUpdater.autoInstallOnAppQuit = false; // 自动安装更新
// 开发环境模拟打包状态（仅开发期覆盖，避免影响生产环境的 app.isPackaged 判断）
if (!app.isPackaged && process.env.NODE_ENV === 'development') {
    Object.defineProperty(app, 'isPackaged', {
        get() {
            return true;
        }
    });
}

function showUpdateUnavailableMessage() {
    dialog.showMessageBox({
        type: 'info',
        title: t('update-hint'),
        message: t('non-update'),
        buttons: [t('ok')]
    });
}

// 设置更新服务器地址
export function setupAutoUpdater(mainWindow) {
    autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'Margele1337',
        repo: 'jello-music',
        releaseType: 'release'
    });

    autoUpdater.channel = 'latest';
    // 检查更新错误
    autoUpdater.on('error', (error) => {
        console.error('Update check failed:', error.message);
        // 静默检查（应用启动时的后台检查）不弹窗：feed 源是 GitHub，
        // 网络不可达时每次启动都弹错误框会严重打扰用户
        if (silentCheck) return;
        // 把常见网络/可达性错误映射到已本地化的文案，避免直接弹英文 error.message
        const msg = error?.message || '';
        const isNetwork = /ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|getaddrinfo|network|socket/i.test(msg);
        dialog.showMessageBox({
            type: 'error',
            message: isNetwork ? t('update-timeout') : (t('update-failed') + (msg ? `\n${msg}` : ''))
        });
    });
    // 检查到新版本
    autoUpdater.on('update-available', (info) => {
        const notes = info.releaseNotes?.replace(/<[^>]*>/g, '') || t('no-release-notes');
        const msg = t('new-version-msg').replace('{version}', info.version).replace('{notes}', notes);
        dialog.showMessageBox({
            type: 'info',
            title: t('new-version'),
            message: msg,
            buttons: [t('update-now'), t('later')],
            cancelId: 1
        }).then(result => {
            if (result.response === 0) {
                autoUpdater.downloadUpdate();
            }
        });
    });
    // 当前已是最新版本
    autoUpdater.on('update-not-available', () => {
        if (!silentCheck) {
            dialog.showMessageBox({
                type: 'info',
                title: t('update-hint'),
                message: t('already-latest'),
                buttons: [t('ok')]
            });
        }
    });
    // 更新下载进度
    autoUpdater.on('download-progress', (progressObj) => {
        // 主窗口是隐藏的播放宿主，通常存活；但静默更新期间它可能已被销毁，判空防崩
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.setProgressBar(progressObj.percent / 100);
    });
    // 更新下载完成
    autoUpdater.on('update-downloaded', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setProgressBar(-1);
        }
        dialog.showMessageBox({
            type: 'info',
            title: t('update-ready'),
            message: t('update-ready-msg'),
            buttons: [t('install-now'), t('install-later')],
            cancelId: 1
        }).then(result => {
            if (result.response === 0) {
                app.isQuitting = true;
                // 告知 main.js 的 before-quit 不要强制 app.exit(0)，否则会抢在安装器启动前杀掉进程
                globalThis.JELLO_QUIT_FOR_INSTALL = true;
                autoUpdater.quitAndInstall(true, true);
            }
        });
    });
}
// 检查更新
export function checkForUpdates(silent = false) {
    silentCheck = silent;

    if (!autoUpdater.isUpdaterActive()) {
        if (!silent) {
            showUpdateUnavailableMessage();
        }
        return;
    }

    autoUpdater.checkForUpdates()
        .then(result => {
            if (!result && !silent) {
                showUpdateUnavailableMessage();
            }
        })
        .catch(error => {
            console.error('Update check error:', error);
        });
}

