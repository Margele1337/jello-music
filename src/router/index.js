import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import SigmaView from '../views/SigmaView.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'sigma', component: SigmaView },
    { path: '/dev', name: 'dev', component: HomeView }
  ]
});

export default router;
