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
        /** 随机播放，按历史栈取歌 */
        SHUFFLE,
        /** 列表循环，到边界回到另一端 */
        ALL,
        /** 单曲循环 */
        ONE,
        /** 顺序，到尾停下 */
        NONE
    }

    /**
     * 随机播放的回溯上限：原版 {@code PlayerEngine.js:972} 的
     * {@code maxAttempts = queue.length * 2}，用来防止整张表都被排除时死循环。
     */
    private static final int RECENT_WINDOW = 10;
    private static final int RECENT_MIN_QUEUE = 10;

    private final List<Song> songs = new ArrayList<>();
    private int currentIndex = -1;
    private Repeat repeat = Repeat.ALL;

    /**
     * 随机播放走过的索引栈（对应原版 {@code playedSongsStack}）与栈上位置
     * （{@code currentStackIndex}）。栈是「最近的在栈尾」，
     * 上一首先往回退一格，播放历史里没有的才重新随机。
     */
    private final List<Integer> history = new ArrayList<>();
    private int historyIndex = -1;

    private final java.util.Random random = new java.util.Random();
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
        // 原版 setPlaybackMode 每次都清空随机历史（PlaybackMode.js:27-28）
        clearHistory();
    }

    private void clearHistory() {
        history.clear();
        historyIndex = -1;
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
        clearHistory();
        // 随机播放下开局就不该固定第一首
        // （原版 PlayerEngine.js:1703-1709 / 1730-1736 / 1775-1781 三处都是这一句）
        if (repeat == Repeat.SHUFFLE && !songs.isEmpty()) {
            currentIndex = random.nextInt(songs.size());
        }
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
        if (repeat == Repeat.SHUFFLE) {
            return pickShuffle(1);
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
        if (repeat == Repeat.SHUFFLE) {
            return pickShuffle(-1);
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

    /**
     * 随机播放取歌，1:1 移植原版 {@code handleRandomPlayback}（{@code PlayerEngine.js:962-1022}）。
     *
     * <p>原版逻辑：
     * <ol>
     *   <li>上一首（{@code direction=-1}）若栈上还有更早的，退一格直接取历史；取完没有就随机一首 {@code unshift}</li>
     *   <li>下一首若历史里「未来」还有（用户按过上一首再按下一首），前进一格取历史；否则随机一首追加到栈尾</li>
     *   <li>随机时最多试 {@code length * 2} 次，排除当前这首歌；
     *       队列 ≥10 首时还要排除最近 10 首里出现过的，避免连着听一样的</li>
     *   <li>取新的下一首之前，先把「未来」那段历史截掉</li>
     * </ol>
     */
    private Song pickShuffle(int direction) {
        if (direction < 0 && historyIndex > 0) {
            historyIndex--;
            currentIndex = history.get(historyIndex);
        } else if (direction > 0 && historyIndex < history.size() - 1) {
            historyIndex++;
            currentIndex = history.get(historyIndex);
        } else {
            int picked = randomPick();
            if (direction > 0) {
                // 截断「未来」：用户回退过之后再前进，历史里多出来的那段不再有效
                if (historyIndex < history.size() - 1) {
                    history.subList(historyIndex + 1, history.size()).clear();
                }
                history.add(picked);
                historyIndex = history.size() - 1;
            } else {
                // 原版这里是 unshift 且不动 currentStackIndex：
                // 新元素落到栈首，栈指针停在 0，正好指着它
                history.add(0, picked);
                historyIndex = 0;
            }
            currentIndex = picked;
        }
        Song s = current();
        fire();
        return s;
    }

    /**
     * 随机挑一个索引，排除当前这首；队列 ≥10 首时额外排除最近 10 首。
     *
     * <p>对照原版 {@code PlayerEngine.js:999-1010} 的 do/while 条件。
     */
    private int randomPick() {
        int size = songs.size();
        int current = historyIndex >= 0 && historyIndex < history.size() ? history.get(historyIndex) : currentIndex;
        int maxAttempts = size * 2;
        int picked = current;
        for (int attempt = 0; attempt < maxAttempts; attempt++) {
            picked = random.nextInt(size);
            if (picked != current && !inRecentWindow(picked)) {
                break;
            }
        }
        return picked;
    }

    private boolean inRecentWindow(int index) {
        if (history.isEmpty() || songs.size() < RECENT_MIN_QUEUE) {
            return false;
        }
        int from = Math.max(0, history.size() - RECENT_WINDOW);
        for (int i = from; i < history.size(); i++) {
            if (history.get(i) == index) {
                return true;
            }
        }
        return false;
    }
}