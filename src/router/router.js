import { createRouter, createWebHashHistory } from 'vue-router';
import HomeLayout from '@/layouts/HomeLayout.vue';
import Lyrics from '@/views/Lyrics.vue';

// 只保留必要路由：主窗口（隐藏播放宿主）、桌面歌词窗口、频谱窗口、Sigma 窗口
const routes = [
    { path: '/', component: HomeLayout },
    { path: '/lyrics', name: 'Lyrics', component: Lyrics },
    { path: '/sigma', name: 'SigmaWindow', component: () => import('@/views/SigmaWindow.vue') },
    { path: '/spectrum-hud', name: 'SpectrumHUD', component: () => import('@/views/SpectrumHUD.vue') },
];

const router = createRouter({
    history: createWebHashHistory(),
    routes
});

// Sigma 独立窗口只跑 /sigma：登录成功后 Login.vue 会 push('/library')，这里弹回播放器，
// 避免在 800x600 小窗里挂载主界面
const isSigmaWindow = typeof window !== 'undefined'
    && !!window.electron
    && window.location.hash.replace(/^#\/?/, '').split('?')[0] === 'sigma';

router.beforeEach((to, from, next) => {
    if (isSigmaWindow && to.path !== '/sigma') {
        return next('/sigma');
    }
    next();
});

export default router;
