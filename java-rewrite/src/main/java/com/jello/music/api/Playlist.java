package com.jello.music.api;

/**
 * 用户歌单条目（来自 {@code /user/playlist}）。
 */
public record Playlist(String id, String name, int count) {
    @Override
    public String toString() {
        return name + " (" + count + ")";
    }
}