import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import SigmaView from '../views/SigmaView.vue';
import LoginView from '../views/LoginView.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'sigma', component: SigmaView },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/dev', name: 'dev', component: HomeView }
  ]
});

export default router;
