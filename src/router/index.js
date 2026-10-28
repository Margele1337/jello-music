import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import LoginView from '../views/LoginView.vue';
import SettingsView from '../views/SettingsView.vue';
import LyricsView from '../views/LyricsView.vue';
import DesktopLyricsView from '../views/DesktopLyricsView.vue';
import SpectrumHudView from '../views/SpectrumHudView.vue';

// 播放器视图由 App.vue 常驻挂载（设置/登录/歌词是叠在它上面的浮层，
// 与旧版 SigmaUI 的 view 结构一致），路由里的 '/' 只是个空占位。
const EmptyView = { render: () => null };

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'sigma', component: EmptyView },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/lyrics', name: 'lyrics', component: LyricsView },
    { path: '/desktop-lyrics', name: 'desktop-lyrics', component: DesktopLyricsView },
    { path: '/spectrum', name: 'spectrum', component: SpectrumHudView },
    { path: '/dev', name: 'dev', component: HomeView }
  ]
});

export default router;
