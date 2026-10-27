import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coverUrl,
  normalizePlaylist,
  normalizeSong
} from '../src/services/api/normalize.js';

test('normalizes search song results', () => {
  assert.deepEqual(normalizeSong({
    FileHash: 'ABC123',
    SongName: '晴天',
    SingerName: '周杰伦',
    Duration: 269,
    AlbumID: '966846',
    MixSongID: '32100650',
    trans_param: { union_cover: 'http://imge.kugou.com/stdmusic/{size}/cover.jpg' }
  }), {
    hash: 'ABC123',
    name: '晴天',
    author: '周杰伦',
    img: 'https://imge.kugou.com/stdmusic/400/cover.jpg',
    timeLength: 269000,
    albumId: '966846',
    albumAudioId: '32100650'
  });
});

test('normalizes playlist tracks and strips the artist prefix', () => {
  assert.deepEqual(normalizeSong({
    hash: 'DBC123',
    name: '周杰伦 - 以父之名',
    timelen: 342047,
    singerinfo: [{ name: '周杰伦' }],
    albuminfo: { id: 966846 },
    mixsongid: 32100648,
    cover: 'http://imge.kugou.com/stdmusic/{size}/cover.jpg'
  }), {
    hash: 'DBC123',
    name: '以父之名',
    author: '周杰伦',
    img: 'https://imge.kugou.com/stdmusic/400/cover.jpg',
    timeLength: 342047,
    albumId: '966846',
    albumAudioId: '32100648'
  });
});

test('normalizes daily recommendation songs', () => {
  assert.deepEqual(normalizeSong({
    hash: 'E2F123',
    songname: '爱意随风起',
    author_name: 'Yang.lc',
    time_length: 199,
    album_id: '181493297',
    album_audio_id: '860304301',
    trans_param: { union_cover: 'http://imge.kugou.com/stdmusic/{size}/cover.jpg' }
  }), {
    hash: 'E2F123',
    name: '爱意随风起',
    author: 'Yang.lc',
    img: 'https://imge.kugou.com/stdmusic/400/cover.jpg',
    timeLength: 199000,
    albumId: '181493297',
    albumAudioId: '860304301'
  });
});

test('drops songs without a hash', () => {
  assert.equal(normalizeSong({ SongName: '无 hash' }), null);
  assert.equal(normalizeSong(null), null);
});

test('normalizes public and personal playlists', () => {
  assert.deepEqual(normalizePlaylist({
    gid: 'collection_3_2132029040_287_0',
    specialname: '周杰伦必听热歌',
    img: 'http://imge.kugou.com/soft/collection/150/cover.png',
    song_count: 154,
    nickname: '酷乐推荐'
  }), {
    id: 'collection_3_2132029040_287_0',
    listId: null,
    idType: 'collection',
    name: '周杰伦必听热歌',
    cover: 'https://imge.kugou.com/soft/collection/150/cover.png',
    songCount: 154,
    creator: '酷乐推荐',
    isDefault: false
  });

  assert.deepEqual(normalizePlaylist({
    listid: 8,
    name: '我喜欢的音乐',
    count: 3,
    is_def: '1'
  }), {
    id: '8',
    listId: 8,
    idType: 'user',
    name: '我喜欢的音乐',
    cover: '',
    songCount: 3,
    creator: '',
    isDefault: true
  });
});

test('coverUrl upgrades http and fills the size placeholder', () => {
  assert.equal(coverUrl('http://imge.kugou.com/a/{size}.jpg', 240), 'https://imge.kugou.com/a/240.jpg');
  assert.equal(coverUrl(''), '');
});
