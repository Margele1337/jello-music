/**
 * 给 api 子模块打补丁：让 /everyday/recommend 支持透传分页/会员相关参数
 *
 * 背景：上游 everyday_recommend.js 只转发 platform，普通账号只能拿到 30 首（会员 60）。
 * 这里不修改子模块的 git 历史，只覆盖工作区文件；根目录 npm install 时会自动执行（postinstall）。
 *
 * 可用参数（透传给酷狗 /everyday_song_recommend）：
 *   page / pagesize / mode / song_pool_id / remain_songcnt / vip_type / area_code / is_overplay
 * 例：/everyday/recommend?pagesize=60&page=1
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'api', 'module', 'everyday_recommend.js');
const MARKER = 'JELLO_DAILY_RECOMMEND_PATCH';

const PATCHED = `// ${MARKER}
// 由 Jello Music 的 tools/patch-api.cjs 生成：透传分页/会员相关参数（原版只转发 platform）
module.exports = (params, useAxios) => {
  const passthroughKeys = [
    'page',
    'pagesize',
    'mode',
    'song_pool_id',
    'remain_songcnt',
    'vip_type',
    'area_code',
    'is_overplay'
  ];

  const extra = {};
  for (const key of passthroughKeys) {
    const value = params?.[key];
    if (value === undefined || value === null || value === '') continue;
    extra[key] = Number.isNaN(Number(value)) ? value : Number(value);
  }

  return useAxios({
    url: '/everyday_song_recommend',
    encryptType: 'android',
    method: 'POST',
    params: { platform: params.platform || 'ios', ...extra },
    cookie: params?.cookie || {},
    headers: { 'x-router': 'everydayrec.service.kugou.com' }
  });
};
`;

if (!fs.existsSync(path.dirname(TARGET))) {
  console.log('[patch-api] 未找到 api 子模块，跳过（请先 git submodule update --init）');
  process.exit(0);
}

const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
if (current.includes(MARKER)) {
  console.log('[patch-api] 已打过补丁，跳过');
  process.exit(0);
}

fs.writeFileSync(TARGET, PATCHED, 'utf8');
console.log('[patch-api] 已为 /everyday/recommend 应用参数透传补丁:', path.relative(ROOT, TARGET));
