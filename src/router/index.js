import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import SigmaView from '../views/SigmaView.vue';
import LoginView from '../views/LoginView.vue';
import SettingsView from '../views/SettingsView.vue';
import LyricsView from '../views/LyricsView.vue';
import DesktopLyricsView from '../views/DesktopLyricsView.vue';
import SpectrumHudView from '../views/SpectrumHudView.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'sigma', component: SigmaView },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/lyrics', name: 'lyrics', component: LyricsView },
    { path: '/desktop-lyrics', name: 'desktop-lyrics', component: DesktopLyricsView },
    { path: '/spectrum', name: 'spectrum', component: SpectrumHudView },
    { path: '/dev', name: 'dev', component: HomeView }
  ]
});

export default router;
