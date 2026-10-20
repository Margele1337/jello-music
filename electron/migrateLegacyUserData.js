// 从旧版（MoeKoe-NextGen）迁移用户数据：设置、登录态、窗口位置等
//
// 注意：必须是 main.js 的第一个 import。
// appServices.js / language/i18n.js 在模块加载阶段就会 new Store() 并读取磁盘，
// 如果迁移发生在它们之后，已创建的 Store 实例读不到迁移来的数据（表现为要重启两次才生效）。
// ES 模块按 import 声明顺序求值，把本模块放在最前面即可保证先拷贝、后读盘。
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const migrateLegacyUserData = () => {
    try {
        const newDir = app.getPath('userData');
        if (path.basename(newDir) !== 'Jello Music') return;
        if (fs.existsSync(path.join(newDir, 'config.json'))) return; // 已迁移过
        const legacyDir = path.join(path.dirname(newDir), 'MoeKoe-NextGen');
        if (!fs.existsSync(legacyDir)) return;
        fs.mkdirSync(newDir, { recursive: true });
        fs.cpSync(legacyDir, newDir, { recursive: true, force: false, errorOnExist: false });
        console.log('[Migration] 已迁移旧版用户数据:', legacyDir, '->', newDir);
    } catch (error) {
        console.error('[Migration] 迁移旧版用户数据失败:', error);
    }
};

// 在本模块被求值时立即执行（而不是等 main.js 主体调用），
// 这样保证先拷贝、后读盘。
migrateLegacyUserData();

export { migrateLegacyUserData };

