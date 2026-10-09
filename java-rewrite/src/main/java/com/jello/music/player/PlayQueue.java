package com.jello.music.player;

import com.jello.music.model.Song;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.function.Consumer;

/**
 * 播放队列。语义与原 Vue 版 {@code MusicQueue} 一致：
 * <ul>
 *   <li>点歌/切歌时若来源是「整表替换」，整表替换播放队列（原版播放队列的行为）</li>
 *   <li>上下首按当前索引在队列内前后移动</li>
 *   <li>到边界后的行为由 repeat 模式决定：单曲循环 / 列表循环 / 顺序(到边界停)</li>
 * </ul>
 *
 * <p>UI 通过 {@link ObservableList} 订阅队列变化；当前索引变化通过回调通知，
 * 让播放器面板能刷新「正在播放」高亮。
 */
public final class PlayQueue {

    public enum Repeat {
        /** 列表循环，到边界回到另一端 */
        ALL,
        /** 单曲循环 */
        ONE,
        /** 顺序，到尾停下 */
        NONE
    }

    private final List<Song> songs = new ArrayList<>();
    private int currentIndex = -1;
    private Repeat repeat = Repeat.ALL;
    private final List<Runnable> listeners = new ArrayList<>();

    public synchronized List<Song> snapshot() {
        return Collections.unmodifiableList(new ArrayList<>(songs));
    }

    public synchronized int size() {
        return songs.size();
    }

    public synchronized boolean isEmpty() {
        return songs.isEmpty();
    }

    public synchronized int currentIndex() {
        return currentIndex;
    }

    public synchronized Song current() {
        return currentIndex >= 0 && currentIndex < songs.size() ? songs.get(currentIndex) : null;
    }

    public Repeat repeat() {
        return repeat;
    }

    public void setRepeat(Repeat r) {
        this.repeat = r;
    }

    /** 注册队列变化回调（增删或切歌都会触发）。 */
    public void addListener(Consumer<Song> onCurrentChanged) {
        listeners.add(() -> onCurrentChanged.accept(current()));
    }

    private void fire() {
        for (Runnable r : listeners) {
            r.run();
        }
    }

    /** 整表替换播放队列（原版点歌时会把整张表灌进队列）。 */
    public synchronized void replaceAll(List<Song> newSongs) {
        songs.clear();
        songs.addAll(newSongs);
        currentIndex = newSongs.isEmpty() ? -1 : 0;
        fire();
    }

    /** 追加单曲（已存在则忽略，按 hash 去重）。 */
    public synchronized boolean add(Song song) {
        if (song == null) {
            return false;
        }
        for (Song s : songs) {
            if (s.getHash().equalsIgnoreCase(song.getHash())) {
                return false;
            }
        }
        songs.add(song);
        fire();
        return true;
    }

    /** 切到指定歌曲；切到后把该曲之后的歌裁掉（对应原版「点歌即整表替换」的简化）。 */
    public synchronized boolean setCurrent(String hash) {
        for (int i = 0; i < songs.size(); i++) {
            if (songs.get(i).getHash().equalsIgnoreCase(hash)) {
                currentIndex = i;
                fire();
                return true;
            }
        }
        return false;
    }

    /** 下一首。返回要播放的歌曲，null 表示无可播放。 */
    public synchronized Song next() {
        if (songs.isEmpty()) {
            return null;
        }
        if (repeat == Repeat.ONE && currentIndex >= 0) {
            return current();
        }
        if (currentIndex < songs.size() - 1) {
            currentIndex++;
        } else if (repeat == Repeat.ALL) {
            currentIndex = 0;
        } else {
            // 顺序播放到尾：停在最后一首
            currentIndex = songs.size() - 1;
            return current();
        }
        Song s = current();
        fire();
        return s;
    }

    /** 上一首。 */
    public synchronized Song previous() {
        if (songs.isEmpty()) {
            return null;
        }
        if (repeat == Repeat.ONE && currentIndex >= 0) {
            return current();
        }
        if (currentIndex > 0) {
            currentIndex--;
        } else if (repeat == Repeat.ALL) {
            currentIndex = songs.size() - 1;
        } else {
            currentIndex = 0;
            return current();
        }
        Song s = current();
        fire();
        return s;
    }
}