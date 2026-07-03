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
    keywords: ['bluearchive', 'blue archive', 'bulearchive', 'bluearhcive', 'bluearchieve', '蔚藍檔案', '蔚蓝档案', '碧藍檔案', '碧蓝档案', 'ブルアカ', 'ブルーアーカイブ', '블루아卡池', '블루아卡池', '키보托스', '키보토斯', '키보토斯', '키보토스'],
    characters: [
      { tag: '龍華妃咲', keywords: ['龍華妃咲', '龙华妃咲', '妃咲', 'kisaki', 'キサキ', '竜華キサキ'] },
      { tag: '桐生桔梗', keywords: ['桐生桔梗', '桐生キキョウ', 'キキョウ', 'kikyou'] },
      { tag: '柚鳥夏', keywords: ['柚鳥夏', '柚鸟夏', '柚鳥ナツ', '柚鸟ナツ', 'natsu', 'ナツ'] },
      { tag: '小鳥遊星野', keywords: ['小鳥遊星野', '小鸟游星野', '星野', 'hoshino', 'takanashihoshino', 'ホシノ', '小鳥遊ホシノ'] },
      { tag: '聖園彌香', keywords: ['聖園彌香', '圣园未花', 'misonomika', 'mika', 'ミカ', '聖園ミカ'] },
      { tag: '早瀬優香', keywords: ['早瀬優香', '早瀨優香', '早濑优香', '優香', '优香', '体操服优香', 'yuuka', 'ユウカ', '早瀬ユウ加', '早瀬ユウカ'] },
      { tag: '靜山マシロ', keywords: ['静山マシロ', '靜山マシロ', '静山真白', '靜山真白', 'mashiro', 'マシロ'] },
      { tag: '陸八魔亞瑠', keywords: ['陸八魔亞瑠', '陆八魔爱露', '陸八魔アル', 'アル', '아루', 'aru', '阿露'] },
      { tag: '杏山和紗', keywords: ['杏山和紗', '杏山和纱', '杏山カズサ', 'カズサ', 'kazusa', 'kyoyama kazusa'] },
      { tag: '下江小春', keywords: ['下江小春', '下江コハル', 'コハル', 'koharu', '小春'] },
      { tag: '才羽桃井', keywords: ['才羽桃井', '才羽モモイ', 'モモイ', 'momoi', '桃井'] },
      { tag: '伊落瑪麗', keywords: ['伊落瑪麗', '伊落玛丽', '伊落マリー', 'マリー', 'marie', '瑪麗', '玛丽'] },
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
      { tag: '阿米婭', keywords: ['阿米婭', '阿米娅', 'amiya', 'アーミヤ'] },
      { tag: '霍爾海雅', keywords: ['霍爾海雅', '霍尔海雅', 'ho\'olheyak', 'hoolheyak', 'ホルハイヤ'] },
    ],
  },
  {
    work: '星穹鐵道',
    keywords: ['星穹鐵道', '星穹铁道', '崩壞星穹鐵道', '崩坏星穹铁道', '崩壊スターレイル', 'honkaistarrail', 'starrail', 'star rail', 'スターレイル'],
    characters: [
      { tag: '流螢', keywords: ['流螢', '流萤', 'firefly', 'ホタル'] },
      { tag: '花火', keywords: ['花火', 'sparkle', 'ハナビ'] },
      { tag: '風堇', keywords: ['風堇', '风堇', '雅辛忒絲', '雅辛忒丝', 'hyacine', 'hyacinthia', 'ヒアシンシア'] },
      { tag: '昔漣', keywords: ['昔漣', '昔涟', 'cyrene', 'キュレネ'] },
      { tag: '長夜月', keywords: ['長夜月', '长夜月', 'evernight', 'エバーナイト', 'ながよづき'] },
      { tag: '銀狼', keywords: ['銀狼', '銀狼', '银狼', 'silver wolf', 'silverwolf', 'シルバーウルフ'] },
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
    keywords: ['mygo', '豐川祥子', '丰川祥子', '若葉睦', '若叶睦', 'avemujica'],
    characters: [
      { tag: '豐川祥子', keywords: ['豐川祥子', '丰川祥子', '祥子', 'sakiko', 'さきこ', 'サキコ', '豊川祥子'] },
      { tag: '若葉睦', keywords: ['若葉睦', '若叶睦', '睦ちゃん', 'mutsumi', 'むつみ', 'ムツミ'] },
      { tag: '千早愛音', keywords: ['千早愛音', '千早爱音', 'anon', 'chihaya anon', 'あのん', 'アノン', '愛音', '爱音'] },
    ],
  },
  {
    work: '碧藍航線',
    keywords: ['碧藍航線', '碧蓝航线', 'azurlane', 'azur lane', 'アズールレーン'],
    characters: [
      { tag: '綾波', keywords: ['綾波', '绫波', 'ayanami', 'アヤナミ'] },
      { tag: '埃塞克斯', keywords: ['埃塞克斯', 'essex', 'エセックス'] },
      { tag: '拉菲', keywords: ['拉菲', 'laffey', 'ラフィー'] },
    ],
  },
  {
    work: '東方Project',
    keywords: ['東方project', '东方project', '東方', '东方'],
    characters: [
      { tag: '十六夜咲夜', keywords: ['十六夜咲夜', '咲夜', 'sakuya', 'さくや', 'サクヤ'] },
      { tag: '博麗靈夢', keywords: ['博麗靈夢', '博丽灵梦', '靈夢', '灵梦', 'reimu', 'れいむ', 'レイム', '博麗霊夢', '霊夢'] },
      { tag: '古明地戀', keywords: ['古明地戀', '古明地恋', 'こいし', 'koishi', 'コイシ', '古明地こいし'] },
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
    keywords: ['魔法少女ノ魔女裁判', '魔女裁判', 'まのさば', 'まのさば二次創作'],
    characters: [
      { tag: '橘雪莉', keywords: ['橘雪莉', '橘シェリー', 'sherry', 'tachibana sherry'] },
      { tag: '櫻羽艾瑪', keywords: ['櫻羽艾瑪', '樱羽艾玛', '桜羽エマ', 'sakuraba ema', 'ema'] },
    ],
  },
  {
    work: '物語系列',
    keywords: ['物語シリーズ', '物語系列', '物语系列'],
    characters: [
      { tag: '忍野忍', keywords: ['忍野忍', 'oshino shinobu', 'shinobu', 'シノブ'] },
    ],
  },
  {
    work: '偶像大師',
    keywords: ['偶像大師', '偶像大师', 'idolmaster'],
    characters: [
      { tag: '樋口圓香', keywords: ['樋口圓香', '樋口円香', 'madoka', 'higuchi madoka', 'マドカ'] },
    ],
  },
  {
    work: '星光咖啡館與死神之蝶',
    keywords: ['星光咖啡館與死神之蝶', '星光咖啡馆与死神之蝶', '喫茶ステラと死神の蝶', '死神之蝶', '柚子社', 'yuzusoft'],
    characters: [
      { tag: '四季夏目', keywords: ['四季夏目', 'natsume', 'ナツメ', '四季ナツメ'] },
    ],
  },
  {
    work: '明日方舟：終末地',
    keywords: ['明日方舟：終末地', '明日方舟终末地', 'endfield', 'arknights: endfield', 'エンドフィールド'],
    characters: [
      { tag: '佩麗卡', keywords: ['佩麗卡', '佩丽卡', 'perlica', 'ペリカ'] },
      { tag: '陳千語', keywords: ['陳千語', '陈千语', 'chen qianyu', 'qianyu', 'チェン・センユー', 'チェン センユー'] },
      { tag: '伊馮', keywords: ['伊馮', '伊风', 'yvonne', 'イヴォン', 'イヴォンヌ'] },
    ],
  },
  {
    work: '賽馬娘',
    keywords: ['賽馬娘', '赛马娘', 'umamusume', 'uma musume', 'ウマ娘'],
    characters: [
      { tag: '特別週', keywords: ['特別週', '特别周', 'special week', 'スペシャルウィーク'] },
      { tag: '無聲鈴鹿', keywords: ['無聲鈴鹿', '无声铃鹿', 'silence suzuka', 'サイレンススズカ'] },
      { tag: '東海帝皇', keywords: ['東海帝皇', '东海帝皇', '東海帝王', '东海帝王', 'tokai teio', 'トウカイテイオー'] },
      { tag: '黃金船', keywords: ['黃金船', '黄金船', 'gold ship', 'ゴールドシップ'] },
      { tag: '目白麥昆', keywords: ['目白麥昆', '目白麦昆', 'mejiro mcqueen', 'メジロマックイーン'] },
      { tag: '米浴', keywords: ['米浴', 'rice shower', 'ライスシャワー'] },
    ],
  },
  {
    work: 'VTuber',
    keywords: ['vtuber', 'virtual youtuber', 'バーチャルyoutuber', 'hololive', 'ホロライブ', 'ホロ'],
    characters: [
      { tag: 'Gawr Gura', keywords: ['gawr gura', 'gura', 'がうるぐら', 'がうる・ぐら', '古拉'] },
      { tag: '星街彗星', keywords: ['星街彗星', '星街すいせい', 'suisei', 'hoshimachi suisei'] },
      { tag: '兔田佩克拉', keywords: ['兔田佩克拉', '兔田佩克菈', '兔田佩科拉', '兎田ぺこら', 'pekora', 'usada pekora'] },
      { tag: '寶鐘瑪琳', keywords: ['寶鐘瑪琳', '宝钟 marine', '宝钟玛琳', '宝钟マリン', '宝鐘マリン', 'marine', 'houshou marine'] },
      { tag: '湊阿庫婭', keywords: ['湊阿庫婭', '凑阿库娅', 'minato aqua', 'aqua', '湊あくあ', 'あくあ'] },
      { tag: '永雛塔菲', keywords: ['永雛塔菲', '永雏塔菲', 'taffy', 'タフィ'] },
      { tag: '東雪蓮', keywords: ['東雪蓮', '东雪莲', 'azuma ren', 'アズマレン'] },
      { tag: '時雨羽衣', keywords: ['時雨羽衣', '时雨羽衣', 'shigure ui', 'しぐれうい', 'ういちゃん'] },
    ],
  },
  {
    work: '中二病也想談戀愛！',
    keywords: ['中二病也想談戀愛！', '中二病也想谈恋爱', '中二病', 'love, chunibyo & other delusions', '中二病でも恋がしたい'],
    characters: [
      { tag: '小鳥遊六花', keywords: ['小鳥遊六花', '小鸟游六花', 'rikka', 'takanashi rikka', 'たかなし りっか'] },
    ],
  },
  {
    work: 'Vocaloid',
    keywords: ['vocaloid', '初音未來', '初音未来', 'miku', '初音ミク'],
    characters: [
      { tag: '初音未來', keywords: ['初音未來', '初音未来', 'miku', 'hatsune miku', '初音ミク'] },
    ],
  },
  {
    work: '世界計畫',
    keywords: ['世界計畫', '世界计划', 'proseka', 'project sekai', 'プロセカ'],
    characters: [
      { tag: '曉山瑞希', keywords: ['曉山瑞希', '晓山瑞希', 'akiyama mizuki', 'mizuki', '暁山瑞希', 'みずき'] },
    ],
  },
  {
    work: '魔女之旅',
    keywords: ['魔女之旅', 'majo no tabitabi', 'wandering witch', '魔女の旅々'],
    characters: [
      { tag: '伊蕾娜', keywords: ['伊蕾娜', 'elaina', 'イレイナ'] },
    ],
  },
  {
    work: '名偵探光之美少女',
    keywords: ['名偵探光之美少女', '名侦探光之美少女', '名探偵プリキュア', '名探偵ぷりきゅあ'],
    characters: [
      { tag: '森亞露露卡', keywords: ['森亞露露卡', '森亚露露卡', 'るるか', 'ルルカ', 'ruruka', 'moria ruruka', '森亜るるか', 'キュアアルカナ', 'アルカナシャドウ'] },
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
