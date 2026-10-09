package com.jello.music.model;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 酷狗接口所需的登录态与设备标识。
 *
 * <p>字段与拼装顺序严格对齐现有前端 {@code src/utils/request.js} 的请求拦截器，
 * 改动会导致接口返回 20028（需要验证）。
 *
 * <p>凭据来源：Electron 运行时存在 localStorage.MoeData，形如
 * <pre>
 *   {"UserInfo": {"token": "...", "userid": 123, ...},
 *    "Device":  {"dfid": "...", "mid": "...", "guid": "...", ...}}
 * </pre>
 * Java 版启动后可从同��位置读取，或让用户在设置页里粘贴。
 */
public final class KuGouCredentials {

    private String token;
    private String userid;
    private String t1;
    private String dfid;
    private String mid;
    private String guid;
    private String serverDev;
    private String mac;

    /** 顺序即拼装顺序，与前端保持一致，便于比对排错。 */
    private static final Map<String, String> FIELD_ORDER = new LinkedHashMap<>();

    static {
        FIELD_ORDER.put("token", "token");
        FIELD_ORDER.put("userid", "userid");
        FIELD_ORDER.put("dfid", "dfid");
        FIELD_ORDER.put("t1", "t1");
        FIELD_ORDER.put("KUGOU_API_MID", "mid");
        FIELD_ORDER.put("KUGOU_API_GUID", "guid");
        FIELD_ORDER.put("KUGOU_API_DEV", "serverDev");
        FIELD_ORDER.put("KUGOU_API_MAC", "mac");
    }

    public String getToken() {
        return token;
    }

    public void setToken(String token) {
        this.token = token;
    }

    public String getUserid() {
        return userid;
    }

    public void setUserid(String userid) {
        this.userid = userid;
    }

    public String getT1() {
        return t1;
    }

    public void setT1(String t1) {
        this.t1 = t1;
    }

    public String getDfid() {
        return dfid;
    }

    public void setDfid(String dfid) {
        this.dfid = dfid;
    }

    public String getMid() {
        return mid;
    }

    public void setMid(String mid) {
        this.mid = mid;
    }

    public String getGuid() {
        return guid;
    }

    public void setGuid(String guid) {
        this.guid = guid;
    }

    public String getServerDev() {
        return serverDev;
    }

    public void setServerDev(String serverDev) {
        this.serverDev = serverDev;
    }

    public String getMac() {
        return mac;
    }

    public void setMac(String mac) {
        this.mac = mac;
    }

    /** 拼成 {@code token=...;userid=...;dfid=...} 形式的 Authorization 头值。 */
    public String toAuthorizationHeader() {
        StringBuilder sb = new StringBuilder();
        Map<String, String> values = new LinkedHashMap<>();
        values.put("token", token);
        values.put("userid", userid);
        values.put("dfid", dfid);
        values.put("t1", t1);
        values.put("KUGOU_API_MID", mid);
        values.put("KUGOU_API_GUID", guid);
        values.put("KUGOU_API_DEV", serverDev);
        values.put("KUGOU_API_MAC", mac);

        for (Map.Entry<String, String> e : FIELD_ORDER.entrySet()) {
            String v = values.get(e.getValue());
            if (v != null && !v.isBlank()) {
                if (sb.length() > 0) {
                    sb.append(';');
                }
                sb.append(e.getKey()).append('=').append(v);
            }
        }
        return sb.toString();
    }

    public boolean isEmpty() {
        return toAuthorizationHeader().isEmpty();
    }

    @Override
    public String toString() {
        // 避免日志泄露完整 token
        String t = token == null || token.length() < 8 ? "null" : token.substring(0, 8) + "…";
        return "KuGouCredentials{token=" + t + ", userid=" + userid + ", dfid=" + dfid
                + ", 其余字段=" + (mid == null && guid == null && t1 == null ? "空" : "已设置") + "}";
    }
}