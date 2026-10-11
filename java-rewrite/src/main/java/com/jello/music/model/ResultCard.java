package com.jello.music.model;

/**
 * 右栏结果网格里的一张卡片。
 *
 * <p>原版网格里混着两种卡（{@code SigmaThumbnailButton} 的 {@code type}）：
 * <ul>
 *   <li>{@code song} —— 底色 {@code #010101}，点它 = 用当前整张列表替换队列并播放这首</li>
 *   <li>{@code playlist} —— 底色 {@code #037c8c}，点它 = 下钻到该歌单的曲目列表</li>
 * </ul>
 * 之前的 Java 版只有歌曲卡，搜索「歌」字看不到任何歌单结果。
 */
public final class ResultCard {

    private final Kind kind;
    private final String key;
    private final String hash;
    private final String gid;
    private final String title;
    private final String artist;
    private final String coverUrl;

    public enum Kind {
        SONG, PLAYLIST
    }

    private ResultCard(Kind kind, String key, String hash, String gid,
                       String title, String artist, String coverUrl) {
        this.kind = kind;
        this.key = key;
        this.hash = hash;
        this.gid = gid;
        this.title = title == null ? "" : title;
        this.artist = artist == null ? "" : artist;
        this.coverUrl = coverUrl == null ? "" : coverUrl;
    }

    public static ResultCard song(String hash, String title, String artist, String coverUrl) {
        return new ResultCard(Kind.SONG, "sn-" + hash, hash, null, title, artist, coverUrl);
    }

    public static ResultCard playlist(String gid, String title, String coverUrl) {
        return new ResultCard(Kind.PLAYLIST, "pl-" + gid, null, gid, title, "", coverUrl);
    }

    public Kind kind() {
        return kind;
    }

    public String key() {
        return key;
    }

    public String hash() {
        return hash;
    }

    public String gid() {
        return gid;
    }

    public String title() {
        return title;
    }

    public String artist() {
        return artist;
    }

    public String coverUrl() {
        return coverUrl;
    }

    public boolean isPlaylist() {
        return kind == Kind.PLAYLIST;
    }

    /** 歌曲卡 -> 队列对象，供点击后播放。 */
    public Song toSong() {
        return new Song(hash, title, artist, "", coverUrl, 0);
    }
}