import { defineStore } from 'pinia';
import axios from 'axios';
import { getApiBaseUrl } from '../utils/apiBaseUrl';

// 用于设备注册的独立 axios 实例（不带拦截器，避免循环依赖）
// baseURL 动态取：设置里改了 API 地址不用重启也能生效
const registerDeviceApi = axios.create({
    timeout: 10000,
});
registerDeviceApi.interceptors.request.use((config) => {
    config.baseURL = getApiBaseUrl();
    return config;
});

export const MoeAuthStore = defineStore('MoeData', {
    state: () => ({
        UserInfo: null, // 用户信息
        Config: null, // 配置信息
        Device: null, // 设备信息
    }),
    actions: {
        fetchConfig(key) {
            if (!this.Config) return null;
            const configItem = this.Config.find(item => item.key === key);
            return configItem ? configItem.value : null;
        },
        async setData(data) {
            if (data.UserInfo) this.UserInfo = data.UserInfo;
            if (data.Config) this.Config = data.Config;
        },
        clearData() {
            this.UserInfo = null; // 清除用户信息
        },
        async initDevice() {
            if (this.Device) return this.Device;
            try {
                const response = await registerDeviceApi.get('/register/dev');
                const device = response?.data?.data;
                if (device) {
                    this.Device = device;
                    return device;
                }
            } catch (error) {
                console.error('Failed to register device:', error);
            }
            return null;
        }
    },
    getters: {
        // 原写法是 !!state.UserInfo && !!state.UserInfo（复制粘贴笔误）：
        // UserInfo 存在但 token 为空也算已登录。以 token 为准。
        isAuthenticated: (state) => !!state.UserInfo?.token, // 是否已登录
    },
    persist: {
        enabled: true,
        strategies: [
            {
                key: 'MoeData',
                storage: localStorage,
                paths: ['UserInfo', 'Config', 'Device'],
            },
        ],
    },
});