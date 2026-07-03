export interface WorkCharacterTag {
  tag: string;
  keywords: string[];
}

export interface WorkTagGroup {
  work: string;
  keywords: string[];
  characters: WorkCharacterTag[];
}

export const WORK_TAG_GROUPS: WorkTagGroup[] = [
  {
    work: '蔚藍檔案',
    keywords: ['bluearchive', 'blue archive', 'bulearchive', 'bluearhcive', 'bluearchieve', '蔚藍檔案', '蔚蓝档案', '碧藍檔案', '碧蓝档案', 'ブルアカ', 'ブルーアーカイブ', '블루아카', '블루아카이브', '키보토스'],
    characters: [
      { tag: '龍華妃咲', keywords: ['龍華妃咲', '龙华妃咲', '妃咲', 'kisaki', 'キサキ'] },
      { tag: '四季夏目', keywords: ['四季夏目', 'natsume', 'ナツメ'] },
      { tag: '桐生桔梗', keywords: ['桐生桔梗', '桐生キキョウ', 'キキョウ', 'kikyou'] },
      { tag: '柚鳥夏', keywords: ['柚鳥夏', '柚鸟夏', '柚鳥ナツ', '柚鸟ナツ', 'natsu', 'ナツ'] },
      { tag: '小鳥遊星野', keywords: ['小鳥遊星野', '小鸟游星野', '星野', 'hoshino', 'takanashihoshino', 'ホシノ'] },
      { tag: '聖園ミカ', keywords: ['聖園ミカ', 'misonomika', 'ミカ', '聖園美香', '圣园美香'] },
      { tag: '早瀬優香', keywords: ['早瀬優香', '優香', '优香', '体操服优香', 'yuuka', 'ユウカ'] },
      { tag: '靜山マシロ', keywords: ['静山マシロ', '靜山マシロ', 'mashiro', 'マシロ', '靜山真白', '静山真白'] },
      { tag: '陸八魔アル', keywords: ['陸八魔アル', 'アル', '아루', 'aru', '陸八魔亞瑠', '陆八魔亚瑠'] },
    ],
  },
  {
    work: '明日方舟',
    keywords: ['明日方舟', 'arknights', 'アークナイツ'],
    characters: [
      { tag: '阿爾圖羅', keywords: ['阿爾圖羅', '阿尔图罗', '塑心', 'virtuosa', 'ヴィルトゥオーサ'] },
      { tag: '普瑞賽斯', keywords: ['普瑞賽斯', '普瑞赛斯', 'priestess', 'プリースティス'] },
      { tag: '艾雅法拉', keywords: ['艾雅法拉', 'eyjafjalla', 'エイヤフィヤトラ'] },
      { tag: '能天使', keywords: ['能天使', 'exusiai', 'エクシア'] },
      { tag: '德克薩斯', keywords: ['德克薩斯', '德克萨斯', 'texas', 'テキサス'] },
      { tag: '伊馮', keywords: ['伊馮', '伊冯', 'イヴォン', 'yvonne'] },
    ],
  },
  {
    work: '星穹鐵道',
    keywords: ['星穹鐵道', '星穹铁道', '崩壞星穹鐵道', '崩坏星穹铁道', '崩壊スターレイル', 'honkaistarrail', 'starrail', 'star rail', 'スターレイル'],
    characters: [
      { tag: '流螢', keywords: ['流螢', '流萤', 'firefly', 'ホタル'] },
      { tag: '花火', keywords: ['花火', 'sparkle', 'ハナビ'] },
      { tag: '風堇', keywords: ['風堇', '风堇', '雅辛忒絲', '雅辛忒丝', 'hyacine', 'ヒアンシー'] },
      { tag: '昔漣', keywords: ['昔漣', '昔涟', 'cyrene', 'キュレネ'] },
      { tag: '長夜月', keywords: ['長夜月', '长夜月', 'evernight', 'エバーナイト'] },
    ],
  },
  {
    work: '鳴潮',
    keywords: ['鳴潮', '鸣潮', 'wutheringwaves', 'wuthering waves', 'wuwa'],
    characters: [
      { tag: '千咲', keywords: ['千咲', '千咲ちゃん', 'chisa'] },
      { tag: '尤諾', keywords: ['尤諾', '尤诺', 'iuno', 'yuno', 'ユーノ'] },
      { tag: '守岸人', keywords: ['守岸人', 'ショアキーパー', 'shorekeeper'] },
      { tag: '卡提希婭', keywords: ['卡提希婭', '卡提希娅', '卡提西娅', 'cartethyia', 'カルテジア'] },
      { tag: '達妮婭', keywords: ['達妮婭', '達妮亞', '达妮娅', '达妮亚', 'denia', 'ダニア'] },
    ],
  },
  {
    work: '絕區零',
    keywords: ['絕區零', '绝区零', 'zenless', 'zzz', 'ゼンゼロ'],
    characters: [
      { tag: '儀玄', keywords: ['儀玄', '仪玄', 'yixuan', 'イーシェン'] },
      { tag: '千夏', keywords: ['千夏', 'chinatsu', 'ちなつ', 'チナツ', 'sunna'] },
    ],
  },
  {
    work: '原神',
    keywords: ['原神', 'genshin', 'genshinimpact', 'genshinlmpact'],
    characters: [
      { tag: '甘雨', keywords: ['甘雨', 'ganyu', 'カンウ'] },
      { tag: '茜特菈莉', keywords: ['茜特菈莉', '茜特拉莉', 'citlali', 'シトラリ'] },
      { tag: '安柏', keywords: ['安柏', 'amber', 'アンバー'] },
      { tag: '克洛琳德', keywords: ['克洛琳德', 'clorinde', 'クロリンデ'] },
      { tag: '納西妲', keywords: ['納西妲', '纳西妲', 'nahida', 'ナヒーダ'] },
    ],
  },
  {
    work: 'MyGO',
    keywords: ['mygo', '豐川祥子', '丰川祥子', '若葉睦', '若叶睦'],
    characters: [
      { tag: '豐川祥子', keywords: ['豐川祥子', '丰川祥子', '祥子', 'sakiko', 'さきこ', 'サキコ'] },
      { tag: '若葉睦', keywords: ['若葉睦', '若叶睦', '睦ちゃん', 'mutsumi', 'むつみ', 'ムツミ'] },
    ],
  },
  {
    work: '碧藍航線',
    keywords: ['碧藍航線', '碧蓝航线', 'azurlane', 'azur lane', 'アズールレーン'],
    characters: [
      { tag: '綾波', keywords: ['綾波', '绫波', 'ayanami', 'アヤナミ'] },
      { tag: '埃塞克斯', keywords: ['埃塞克斯', 'essex', 'エセックス'] },
    ],
  },
  {
    work: '東方Project',
    keywords: ['東方project', '东方project', '東方', '东方'],
    characters: [
      { tag: '十六夜咲夜', keywords: ['十六夜咲夜', '咲夜', 'sakuya', 'さくや', 'サクヤ'] },
      { tag: '博麗靈夢', keywords: ['博麗靈夢', '博丽灵梦', '靈夢', '灵梦', 'reimu', 'れいむ', 'レイム'] },
      { tag: '古明地戀', keywords: ['古明地戀', '古明地恋', 'こいし', 'koishi', 'コイシ'] },
    ],
  },
  {
    work: 'Fate',
    keywords: ['fgo', 'fate', 'fate/grand order', 'fategrandorder', 'fate/stay night'],
    characters: [
      { tag: '阿斯托爾福', keywords: ['阿斯托爾福', '阿斯托尔福', '阿福', 'astolfo', 'アストルフォ'] },
    ],
  },
  {
    work: '魔女裁判',
    keywords: ['魔法少女ノ魔女裁判', '魔女裁判'],
    characters: [
      { tag: '橘シェリー', keywords: ['橘シェリー'] },
      { tag: '桜羽エマ', keywords: ['桜羽エマ', 'sakuraba ema'] },
    ],
  },
  {
    work: '物語系列',
    keywords: ['物語シリーズ', '物語系列', '物语系列'],
    characters: [
      { tag: '忍野忍', keywords: ['忍野忍', 'oshino shinobu', 'shinobu'] },
    ],
  },
  {
    work: '偶像大師',
    keywords: ['偶像大師', '偶像大师', 'idolmaster'],
    characters: [
      { tag: '樋口円香', keywords: ['樋口円香', '樋口圓香', 'higuchi madoka', 'madoka'] },
    ],
  },
];

export const WORK_TAGS = WORK_TAG_GROUPS.map((group) => group.work);

export function applyWorkCharacterTags(autoTags: Set<string>, description: string): void {
  for (const group of WORK_TAG_GROUPS) {
    const matchedCharacters = group.characters.filter((character) => matchesAny(description, character.keywords));
    if (matchedCharacters.length > 0 || matchesAny(description, group.keywords)) {
      autoTags.add(group.work);
    }
    for (const character of matchedCharacters) {
      autoTags.add(character.tag);
    }
  }
}

function matchesAny(description: string, keywords: string[]): boolean {
  return keywords.some((keyword) => description.includes(keyword.toLowerCase()));
}
