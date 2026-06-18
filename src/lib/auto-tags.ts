export function generateAutoTags(author: string | null, description: string | null): string[] {
  const autoTags = new Set<string>();

  if (author) {
    autoTags.add(author.trim().toLowerCase());
  }

  if (!description) {
    return [...autoTags];
  }

  const descLower = description.toLowerCase();

  if (matchesAny(descLower, ['黑絲', '黑丝', '黒タイツ', 'black tights', 'blacktights'])) {
    autoTags.add('黑絲');
    autoTags.add('絲襪');
  }

  if (matchesAny(descLower, ['白絲', '白丝', '白タイツ', '白ストッキング', 'white tights', 'white stockings', 'white pantyhose'])) {
    autoTags.add('白絲');
    autoTags.add('絲襪');
  }

  if (matchesAny(descLower, ['絲襪', '丝袜', 'タイツ', 'tights', 'pantyhose', 'ストッキング', '網襪', '网袜'])) {
    autoTags.add('絲襪');
  }

  if (matchesAny(descLower, ['裸足', '赤腳', '赤脚', '光腿', '生脚', '素足', 'barefoot', 'bare feet', 'bare legs'])) {
    autoTags.add('裸足');
  }

  if (matchesAny(descLower, ['cosplay', 'cos', 'コスプレ', '角色扮演'])) {
    autoTags.add('COS');
  }

  if (matchesAny(descLower, ['寫真', '写真', 'グラビア', 'gravure', 'photobook', '週刊', '周刊', 'young jump', 'friday'])) {
    autoTags.add('寫真');
  }

  if (matchesAny(descLower, ['日常', '日常服', 'casual', '私服', '散步'])) {
    autoTags.add('日常');
  }

  return [...autoTags];
}

function matchesAny(description: string, keywords: string[]): boolean {
  return keywords.some((keyword) => description.includes(keyword));
}
