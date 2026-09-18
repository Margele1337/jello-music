import fs from 'fs';
import { app } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import isDev from 'electron-is-dev';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_SHORTCUT_NAME = 'Jello Music.lnk';
const DEFAULT_ICON_NAME = 'icon.ico';

function getDesktopShortcutIconPath() {
    return path.join(process.resourcesPath, 'icons', DEFAULT_ICON_NAME);
}

function refreshIconCache() {
    exec('ie4uinit.exe -show', (err) => {
        if (!err) console.log('系统图标缓存已刷新');
    });
}

function escapePowerShellString(value) {
    return String(value).replace(/'/g, "''");
}

function createShortcut(targetPath, shortcutPath, description = '', iconPath = '') {
    const psScript = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('${escapePowerShellString(shortcutPath)}')
$Shortcut.TargetPath = '${escapePowerShellString(targetPath)}'
$Shortcut.WorkingDirectory = '${escapePowerShellString(path.dirname(targetPath))}'
$Shortcut.Description = '${escapePowerShellString(description)}'
${iconPath ? `$Shortcut.IconLocation = '${escapePowerShellString(iconPath)}'` : ''}
$Shortcut.Save()
`;
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');

    exec(`powershell -NoProfile -EncodedCommand ${encoded}`, (err, stdout, stderr) => {
        if (err) {
            console.error('桌面快捷方式重建失败:', err);
            if (stderr) {
                console.error(stderr);
            }
            return;
        }

        console.log('桌面快捷方式图标已更新');
    });
}

function syncDesktopShortcutIcon() {
    const exePath = path.dirname(app.getPath('exe'));
    const desktopPath = app.getPath('desktop');
    const shortcutPath = path.join(desktopPath, DESKTOP_SHORTCUT_NAME);
    if (!fs.existsSync(shortcutPath)) {
        return;
    }

    const iconPath = getDesktopShortcutIconPath();
    createShortcut(app.getPath('exe'), shortcutPath, path.basename(exePath), iconPath);
    // refreshIconCache();
}

export function setupDesktopShortcutIcon() {
    if (process.platform !== 'win32' || isDev) return;
    syncDesktopShortcutIcon();
}
