import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import SigmaView from '../views/SigmaView.vue';
import LoginView from '../views/LoginView.vue';
import SettingsView from '../views/SettingsView.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'sigma', component: SigmaView },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/dev', name: 'dev', component: HomeView }
  ]
});

export default router;
