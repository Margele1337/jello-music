package com.jello.music.model;

import com.fasterxml.jackson.databind.JsonNode;
import javafx.beans.property.SimpleStringProperty;
import javafx.beans.property.SimpleIntegerProperty;

/**
 * 一首歌曲。
 *
 * <p>字段命名与 api 返回对齐（KuGouMusicApi 的 {@code /playlist/track/all} 等端点）。
 * 注意 api 的 {@code name} 字段是「歌手 - 歌名」拼接形式，纯歌名在 {@code remark}，
 * 所以解析时拆开分别存放。
 *
 * <p>用 JavaFX Property 而非普通字段，便于 {@code ListView} 做细粒度绑定，
 * 队列滚动时不会整表刷新。
 */
public final class Song {

    private final SimpleStringProperty hash = new SimpleStringProperty(this, "hash", "");
    private final SimpleStringProperty title = new SimpleStringProperty(this, "title", "");
    private final SimpleStringProperty artist = new SimpleStringProperty(this, "artist", "");
    private final SimpleStringProperty album = new SimpleStringProperty(this, "album", "");
    private final SimpleStringProperty coverUrl = new SimpleStringProperty(this, "coverUrl", "");
    /** 时长毫秒，api 的 timelen 就是毫秒 */
    private final SimpleIntegerProperty durationMs = new SimpleIntegerProperty(this, "durationMs", 0);

    public Song() {
    }

    public Song(String hash, String title, String artist, String album, String coverUrl, int durationMs) {
        this.hash.set(hash == null ? "" : hash);
        this.title.set(title == null ? "" : title);
        this.artist.set(artist == null ? "" : artist);
        this.album.set(album == null ? "" : album);
        this.coverUrl.set(coverUrl == null ? "" : coverUrl);
        this.durationMs.set(durationMs);
    }

    /** 从 api 的歌曲对象解析。 */
    public static Song fromApi(JsonNode n) {
        if (n == null || n.isNull()) {
            return null;
        }
        String hash = text(n, "hash", "Hash");
        if (hash == null || hash.isEmpty()) {
            return null;
        }
        // name 是「歌手 - 歌名」；remark 是纯歌名，没有则退回从 name 拆
        String rawName = text(n, "name", "AudioName", "SongName", "songname");
        String remark = text(n, "remark", "AudioName");
        String title = remark != null && !remark.isEmpty() ? remark : rawName;

        String artist = "";
        var singer = n.get("singerinfo");
        if (singer != null && singer.isArray() && !singer.isEmpty()) {
            StringBuilder sb = new StringBuilder();
            for (var s : singer) {
                if (sb.length() > 0) {
                    sb.append(" / ");
                }
                sb.append(text(s, "name", "SingerName"));
            }
            artist = sb.toString();
        }
        if (artist.isEmpty() && rawName != null) {
            // 没有 singerinfo 时，从「歌手 - 歌名」里拆出歌手
            int idx = rawName.indexOf(" - ");
            if (idx > 0) {
                artist = rawName.substring(0, idx);
                if (title.equals(rawName)) {
                    title = rawName.substring(idx + 3);
                }
            }
        }

        String album = "";
        var albumInfo = n.get("albuminfo");
        if (albumInfo != null) {
            album = text(albumInfo, "name", "AlbumName");
        }
        if (album == null || album.isEmpty()) {
            album = text(n, "album_name", "AlbumName");
        }

        String cover = text(n, "cover", "img", "Cover", "album_img");
        if (cover != null) {
            // api 的 {size} 占位符替换为实际尺寸，ImageView 会再按需缩放
            cover = cover.replace("{size}", "400");
        }

        int durationMs = n.has("timelen") ? n.get("timelen").asInt(0)
                : n.has("duration") ? n.get("duration").asInt(0) : 0;

        return new Song(hash, title, artist, album, cover, durationMs);
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
        return null;
    }

    /** 「歌名 - 歌手」，用于托盘标题等单行场景。 */
    public String titleWithArtist() {
        // 注意：artist/title 是 Property 对象，判断内容要取 .get()，
        // 直接写 artist == null 恒为 false，且与绑定类型冲突
        String a = artist.get();
        if (a == null || a.isEmpty()) {
            return title.get();
        }
        return title.get() + " - " + a;
    }

    /** 时长格式化 mm:ss。 */
    public String durationText() {
        int totalSec = durationMs.get() / 1000;
        if (durationMs.get() <= 0) {
            return "";
        }
        return String.format("%d:%02d", totalSec / 60, totalSec % 60);
    }

    public SimpleStringProperty hashProperty() {
        return hash;
    }

    public SimpleStringProperty titleProperty() {
        return title;
    }

    public SimpleStringProperty artistProperty() {
        return artist;
    }

    public SimpleStringProperty albumProperty() {
        return album;
    }

    public SimpleStringProperty coverUrlProperty() {
        return coverUrl;
    }

    public SimpleIntegerProperty durationMsProperty() {
        return durationMs;
    }

    public String getHash() {
        return hash.get();
    }

    public void setHash(String v) {
        hash.set(v);
    }

    public String getTitle() {
        return title.get();
    }

    public void setTitle(String v) {
        title.set(v);
    }

    public String getArtist() {
        return artist.get();
    }

    public void setArtist(String v) {
        artist.set(v);
    }

    public String getAlbum() {
        return album.get();
    }

    public void setAlbum(String v) {
        album.set(v);
    }

    public String getCoverUrl() {
        return coverUrl.get();
    }

    public void setCoverUrl(String v) {
        coverUrl.set(v);
    }

    public int getDurationMs() {
        return durationMs.get();
    }

    @Override
    public String toString() {
        return titleWithArtist();
    }
}