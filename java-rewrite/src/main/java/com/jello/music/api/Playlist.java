package com.jello.music.api;

/**
 * 用户歌单条目（来自 {@code /user/playlist}）。
 *
 * @param gid      {@code global_collection_id}，原版优先取 {@code list_create_gid}。
 *                 {@code /playlist/track/all} 要的是它，不是 {@code listid}
 * @param name     歌单名
 * @param count    歌曲数
 * @param sort     原版按它<b>升序</b>排列表（不是按 count）
 * @param ownerId  {@code list_create_userid}，用来判断是不是「自己的」歌单
 */
public record Playlist(String gid, String name, int count, int sort, String ownerId) {

    public boolean isLike() {
        return "我喜欢".equals(name);
    }

    /** 原版判断「自己的歌单」：名字是「我喜欢」，或创建者是自己。 */
    public boolean isMine(String myUserid) {
        return isLike() || (myUserid != null && !myUserid.isBlank()
                && myUserid.equals(ownerId));
    }

    @Override
    public String toString() {
        return name + " (" + count + ")";
    }
}