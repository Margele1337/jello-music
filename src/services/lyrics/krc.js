// 解析酷狗 KRC 逐字歌词（公开格式：[行起,行长]<字偏移,字长,0>文本），
// 附带 [language:base64] 的翻译（type 1）与音译（type 0）。
export const parseKrc = (text) => {
  const rawLines = String(text || '').split(/\r?\n/);
  let translations = [];
  let romanizations = [];

  for (const raw of rawLines) {
    const languageMatch = raw.match(/\[language:([^\]]*)\]/);
    if (!languageMatch) continue;
    try {
      const cleaned = languageMatch[1].replace(/[^A-Za-z0-9+/=]/g, '');
      const padded = cleaned.padEnd(cleaned.length + ((4 - (cleaned.length % 4)) % 4), '=');
      const data = JSON.parse(new TextDecoder().decode(
        Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
      ));
      const sections = Array.isArray(data?.content) ? data.content : [];
      for (const section of sections) {
        if (!Array.isArray(section?.lyricContent)) continue;
        if (section.type === 1) translations = section.lyricContent;
        else if (section.type === 0) romanizations = section.lyricContent;
      }
    } catch {
      /* 忽略无法解码的语言块 */
    }
    break;
  }

  const charTag = /<(\d+),(\d+),\d+>([^<]*)/g;
  const lines = [];

  for (const raw of rawLines) {
    const lineMatch = raw.match(/^\[(\d+),(\d+)\](.*)/);
    if (!lineMatch) continue;

    const start = Number(lineMatch[1]);
    const duration = Number(lineMatch[2]);
    const content = lineMatch[3];
    const characters = [];

    let charMatch = charTag.exec(content);
    while (charMatch) {
      const charStart = start + Number(charMatch[1]);
      characters.push({
        c: charMatch[3],
        s: charStart,
        e: charStart + Number(charMatch[2])
      });
      charMatch = charTag.exec(content);
    }

    if (!characters.length) {
      const plain = content.replace(/<[^>]*>/g, '');
      if (!plain.trim()) continue;
      for (let index = 0; index < plain.length; index += 1) {
        characters.push({
          c: plain[index],
          s: start + (index * duration) / plain.length,
          e: start + ((index + 1) * duration) / plain.length
        });
      }
    }

    lines.push({ characters });
  }

  if (!lines.length) return [];

  lines.forEach((line, index) => {
    line.text = line.characters.map((char) => char.c).join('');
    if (translations[index]?.[0]) line.translated = translations[index][0];
    if (romanizations[index]?.length) line.romanized = romanizations[index].join('');
  });

  return lines;
};
