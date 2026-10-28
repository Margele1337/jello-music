import { ref } from 'vue';

// 路由过渡跳过开关：收起态弹出时瞬时切回播放器（与旧版 skipViewTransition 一致）
export const skipRouteTransition = ref(false);

export const skipNextRouteTransition = () => {
  skipRouteTransition.value = true;
};
