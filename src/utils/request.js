// src/services/request.js
import axios from 'axios';
import { MoeAuthStore } from '../stores/store';
import { getApiBaseUrl, DEFAULT_API_BASE_URL } from './apiBaseUrl';
import { handleRiskResponse } from './riskVerify';

// 创建一个 axios 实例
// baseURL 不在这里固化：用户在设置页改 API 地址后无需重启应用即可生效
// （每个请求在拦截器里重新读取当前值）。
const httpClient = axios.create({
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true,
});

// 请求拦截器
httpClient.interceptors.request.use(
    config => {
        // 动态取当前 API 基址：设置页保存后立即生效
        config.baseURL = getApiBaseUrl() || DEFAULT_API_BASE_URL;

        const MoeAuth = MoeAuthStore();
        const token = MoeAuth.UserInfo?.token;
        const userid = MoeAuth.UserInfo?.userid;
        const t1 = MoeAuth.UserInfo?.t1;
        const dfid = MoeAuth.Device?.dfid;
        const mid = MoeAuth.Device?.mid;
        const guid = MoeAuth.Device?.guid;
        const serverDev = MoeAuth.Device?.serverDev;
        const mac = MoeAuth.Device?.mac;

        const authParts = [];
        if (token) authParts.push(`token=${(token)}`);
        if (userid) authParts.push(`userid=${(userid)}`);
        if (dfid) authParts.push(`dfid=${(dfid)}`);
        if (t1) authParts.push(`t1=${(t1)}`);
        if (mid) authParts.push(`KUGOU_API_MID=${(mid)}`);
        if (guid) authParts.push(`KUGOU_API_GUID=${(guid)}`);
        if (serverDev) authParts.push(`KUGOU_API_DEV=${(serverDev)}`);
        if (mac) authParts.push(`KUGOU_API_MAC=${(mac)}`);

        if (authParts.length > 0) {
            config.headers = {
                ...config.headers,
                Authorization: authParts.join(';')
            };
        }
        return config;
    },
    error => Promise.reject(error)
);

// 响应拦截器
httpClient.interceptors.response.use(
    async response => {
        if (response.config.__rawResponse) {
            return response;
        }

        const riskResult = await handleRiskResponse(response, (retryConfig) =>
            httpClient.request({ ...retryConfig, __rawResponse: true }),
            (url, params) => httpClient.get(url, { params, __skipRisk: true }),
        );
        if (riskResult.handled) {
            return riskResult.data;
        }

        return response.data;
    },
    async error => {
        if (error.config?.__rawResponse) {
            return Promise.reject(error);
        }

        if (error.response) {
            const riskResult = await handleRiskResponse(error.response, (retryConfig) =>
                httpClient.request({ ...retryConfig, __rawResponse: true }),
                (url, params) => httpClient.get(url, { params, __skipRisk: true }),
            );
            if (riskResult.handled) {
                return riskResult.data;
            }
        }

        if (error.response) {
            console.error(`http error status:${error.response.status}`,error.response.data);
            if (error.response?.data?.data) {
                console.error(error.response.data.data);
            // } else {
            //     $message.error('服务器错误,请稍后再试!');
            }
        } else if (error.request) {
            console.error('No response received:', error.request);
            // $message 由 MessagePlugin 挂载，挂载前的早期请求用可选链兜底，避免 ReferenceError 掩盖真实错误
            window.$message?.error('服务器未响应,请稍后再试!');
        } else {
            console.error('Error:', error.message);
            window.$message?.error('请求错误,请稍后再试!');
        }
        return Promise.reject(error);
    }
);

// 封装 GET 请求
export const get = async (url, params = {}, config = {}, onSuccess = null, onError = null) => {
    try {
        const response = await httpClient.get(url, { params, ...config });
        if (onSuccess) onSuccess(response);
        return response;
    } catch (error) {
        if (onError) onError(error);
        throw error;
    }
};

// 封装 POST 请求
export const post = async (url, data = {}, config = {}, onSuccess = null, onError = null) => {
    try {
        const response = await httpClient.post(url, data, config);
        if (onSuccess) onSuccess(response);
        return response;
    } catch (error) {
        if (onError) onError(error);
        throw error;
    }
};

// 封装 PUT 请求
export const put = async (url, data = {}, config = {}, onSuccess = null, onError = null) => {
    try {
        const response = await httpClient.put(url, data, config);
        if (onSuccess) onSuccess(response);
        return response;
    } catch (error) {
        if (onError) onError(error);
        throw error;
    }
};

// 封装 DELETE 请求
export const del = async (url, config = {}, onSuccess = null, onError = null) => {
    try {
        const response = await httpClient.delete(url, config);
        if (onSuccess) onSuccess(response);
        return response;
    } catch (error) {
        if (onError) onError(error);
        throw error;
    }
};

// 封装 PATCH 请求
export const patch = async (url, data = {}, config = {}, onSuccess = null, onError = null) => {
    try {
        const response = await httpClient.patch(url, data, config);
        if (onSuccess) onSuccess(response);
        return response;
    } catch (error) {
        if (onError) onError(error);
        throw error;
    }
};

// 封装上传图片请求
export const uploadImage = async (url, file, additionalData = {}, config = {}, onSuccess = null, onError = null) => {
    try {
        const formData = new FormData();
        formData.append('file', file);

        // 如果有其他数据（如关联的商品信息等），也可以添加到 formData
        for (const key in additionalData) {
            if (Object.prototype.hasOwnProperty.call(additionalData, key)) {
                formData.append(key, additionalData[key]);
            }
        }

        // 需要确保 Content-Type 被设置为 multipart/form-data
        const response = await httpClient.post(url, formData, {
            ...config,
            headers: {
                ...config.headers,
                'Content-Type': 'multipart/form-data'
            }
        });

        if (onSuccess) onSuccess(response);
        return response;
    } catch (error) {
        if (onError) onError(error);
        throw error;
    }
};

// 导出 httpClient 以便在需要的时候直接使用 axios 实例
export default httpClient;
