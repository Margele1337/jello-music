package com.jello.music.model;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 登录后的用户信息 —— 对应原版 {@code MoeAuthStore.UserInfo}。
 *
 * <p>原版 {@code handleLoginSuccess} 直接把响应的 {@code data} 整个塞进去，
 * 用到的字段就是下面这几个。{@code token} / {@code userid} / {@code t1} 会进
 * {@code Authorization} 头（见 {@link KuGouCredentials#toAuthorizationHeader()}）。
 *
 * <p>多账号选择列表里的每一项只有 {@code userid / nickname / pic / p_grade}。
 */
public final class UserInfo {

    private String token = "";
    private String userid = "";
    private String t1 = "";
    private String nickname = "";
    private String pic = "";
    private String grade = "";

    public static UserInfo fromApi(JsonNode n) {
        if (n == null || n.isNull()) {
            return null;
        }
        UserInfo u = new UserInfo();
        u.token = text(n, "token");
        u.userid = text(n, "userid");
        u.t1 = text(n, "t1");
        u.nickname = text(n, "nickname", "user_name");
        u.pic = text(n, "pic", "avatar", "user_pic");
        u.grade = text(n, "p_grade", "pGrade");
        return u.userid.isEmpty() && u.token.isEmpty() ? null : u;
    }

    private static String text(JsonNode n, String... keys) {
        for (String k : keys) {
            JsonNode v = n.get(k);
            if (v != null && !v.isNull() && v.isValueNode()) {
                String s = v.asText();
                if (s != null && !s.isEmpty()) {
                    return s;
                }
            }
        }
        return "";
    }

    /** 有 userid 就算登录态有效（对齐原版 {@code isAuthenticated: !!UserInfo}）。 */
    public boolean isAuthenticated() {
        return !userid.isEmpty() || !token.isEmpty();
    }

    public String getToken() {
        return token;
    }

    public void setToken(String v) {
        token = v;
    }

    public String getUserid() {
        return userid;
    }

    public void setUserid(String v) {
        userid = v;
    }

    public String getT1() {
        return t1;
    }

    public void setT1(String v) {
        t1 = v;
    }

    public String getNickname() {
        return nickname;
    }

    public void setNickname(String v) {
        nickname = v;
    }

    public String getPic() {
        return pic;
    }

    public void setPic(String v) {
        pic = v;
    }

    public String getGrade() {
        return grade;
    }

    public void setGrade(String v) {
        grade = v;
    }

    /** 把登录态填进请求凭据（dfid 仍来自设备信息，不在登录响应里）。 */
    public void applyTo(KuGouCredentials cred) {
        if (!token.isEmpty()) {
            cred.setToken(token);
        }
        if (!userid.isEmpty()) {
            cred.setUserid(userid);
        }
        if (!t1.isEmpty()) {
            cred.setT1(t1);
        }
    }

    @Override
    public String toString() {
        // 与 KuGouCredentials 一样不打印完整 token
        String t = token.length() < 8 ? "null" : token.substring(0, 8) + "…";
        return "UserInfo{nickname=" + nickname + ", userid=" + userid + ", token=" + t + "}";
    }
}