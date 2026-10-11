package com.jello.music.api;

/**
 * 左栏一个可点的条目 —— 对应原版 {@code SigmaPlaylistPanel} 的 item。
 *
 * <p>原版列表是「猜你喜欢 / 每日推荐」两个固定项在前，后面才是「我喜欢」与自己的歌单，
 * 这一点之前的 Java 版完全没有（直接按歌曲数倒序排我的歌单）。
 */
public record PlaylistTab(String kind, String name, String gid) {

    public static final String GUESS = "guess";
    public static final String DAILY = "daily";
    public static final String PLAYLIST = "playlist";

    public boolean isGuess() {
        return GUESS.equals(kind);
    }

    public boolean isDaily() {
        return DAILY.equals(kind);
    }
}