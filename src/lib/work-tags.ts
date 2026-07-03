export interface WorkCharacterTag {
  tag: string;
  keywords: (string | RegExp)[];
}

export interface WorkTagGroup {
  work: string;
  keywords: (string | RegExp)[];
  characters: WorkCharacterTag[];
}

export const WORK_TAG_GROUPS: WorkTagGroup[] = [
  {
    work: '蔚藍檔案',
    keywords: ['bluearchive', 'blue archive', 'bulearchive', 'bluearhcive', 'bluearchieve', '蔚藍檔案', '蔚蓝档案', '碧藍檔案', '碧蓝档案', 'ブルアカ', 'ブルーアーカイブ', '블루아카', '블루아카이브', '키보토스'],
    characters: [
      { tag: '龍華妃咲', keywords: ['龍華妃咲', '龙华妃咲', '妃咲', 'kisaki', 'キサキ', '竜華キサキ'] },
      { tag: '桐生桔梗', keywords: ['桐生桔梗', '桐生キキョウ', 'キキョウ', 'kikyou'] },
      { tag: '柚鳥夏', keywords: ['柚鳥夏', '柚鸟夏', '柚鳥ナツ', '柚鸟ナツ', 'natsu', 'ナツ'] },
      { tag: '小鳥遊星野', keywords: ['小鳥遊星野', '小鸟游星野', '星野', 'hoshino', 'takanashihoshino', 'ホシノ', '小鳥遊ホシノ'] },
      { tag: '聖園彌香', keywords: ['聖園彌香', '圣园未花', 'misonomika', 'mika', 'ミカ', '聖園ミカ', '未花'] },
      { tag: '早瀬優香', keywords: ['早瀬優香', '早瀨優香', '早濑优香', '優香', '优香', '体操服优香', 'yuuka', 'ユウカ', '早瀬ユウカ'] },
      { tag: '靜山マシロ', keywords: ['静山マシロ', '靜山マシロ', '静山真白', '靜山真白', 'mashiro', 'マシロ'] },
      { tag: '陸八魔亞瑠', keywords: ['陸八魔亞瑠', '陆八魔爱露', '陸八魔アル', '#アル', 'アルちゃん', '아루', 'aru', '阿露'] },
      { tag: '杏山和紗', keywords: ['杏山和紗', '杏山和纱', '杏山カズサ', 'カズサ', 'kazusa', 'kyoyama kazusa'] },
      { tag: '下江小春', keywords: ['下江小春', '下江コハル', 'コハル', 'koharu', '小春'] },
      { tag: '才羽桃井', keywords: ['才羽桃井', '才羽モモイ', 'モモイ', 'momoi', '桃井'] },
      { tag: '伊落瑪麗', keywords: ['伊落瑪麗', '伊落玛丽', '伊落マリー', 'マリー', 'marie', '瑪麗', '玛丽'] },
      { tag: '阿羅娜', keywords: ['阿羅娜', '阿罗娜', 'arona', 'アロナ'] },
      { tag: '天童愛麗絲', keywords: ['天童愛麗絲', '天童爱丽丝', 'アリス', 'alice', 'tendou alice', 'テンドウアリス'] },
      { tag: '普拉娜', keywords: ['普拉娜', 'プラナ', 'prana'] },
      { tag: '砂狼白子', keywords: ['砂狼白子', '白子', 'シロコ', 'shiroko', 'sunaookami shiroko'] },
      { tag: '一之瀨明日奈', keywords: ['一之瀨明日奈', '一之濑明日奈', 'ichinose asuna', '一之瀬アスナ'] },
      { tag: '橘光', keywords: ['橘光', 'hikari', 'ヒカリ'] },
      { tag: '黑見芹香', keywords: ['黑見芹香', '黑见芹香', '芹香', 'serika', 'セリカ', '黒見セリカ'] },
    ],
  },
  {
    work: '明日方舟：終末地',
    keywords: ['明日方舟：終末地', '明日方舟终末地', 'endfield', /arknights[:\s-]*endfield/i, 'エンドフィールド', 'arknightsendfield', /アークナイツ[\sー・-]*エンドフィールド/i],
    characters: [
      { tag: '佩麗卡', keywords: ['佩麗卡', '佩丽卡', 'perlica', 'ペリカ'] },
      { tag: '陳千語', keywords: ['陳千語', '陈千语', 'chen qianyu', 'qianyu', 'チェン・センユー', 'チェン センユー'] },
      { tag: '伊馮', keywords: ['伊馮', '伊风', 'yvonne', 'イヴォン', 'イヴォンヌ'] },
    ],
  },
  {
    work: '明日方舟',
    keywords: [/明日方舟(?!：?終末地|：?终末地|之?终末地)/i, /arknights(?![:\s-]*endfield)/i, /アークナイツ(?![\sー・-]*エンドフィールド)/i],
    characters: [
      { tag: '阿爾圖羅', keywords: ['阿爾圖羅', '阿尔图罗', '塑心', 'virtuosa', 'ヴィルトゥオーサ'] },
      { tag: '普瑞賽斯', keywords: ['普瑞賽斯', '普瑞赛斯', 'priestess', 'プリースティス'] },
      { tag: '艾雅法拉', keywords: ['艾雅法拉', 'eyjafjalla', 'エイヤフィヤトラ'] },
      { tag: '能天使', keywords: ['能天使', 'exusiai', 'エクシア', '新约能天使'] },
      { tag: '德克薩斯', keywords: ['德克薩斯', '德克萨斯', 'texas', 'テキサス', '緘默德克薩斯', '缄默德克萨斯'] },
      { tag: '阿米婭', keywords: ['阿米婭', '阿米娅', 'amiya', 'アーミヤ'] },
      { tag: '霍爾海雅', keywords: ['霍爾海雅', '霍尔海雅', 'ho\'olheyak', 'hoolheyak', 'ホルハイヤ'] },
      { tag: '羽毛筆', keywords: ['羽毛筆', '羽毛笔', 'la pluma', 'lapluma', 'ラ・プーマ', 'ラプーマ'] },
      { tag: '拉普蘭德', keywords: ['拉普蘭德', '拉普兰德', 'lappland', 'ラップランド', '荒芜拉普兰德'] },
      { tag: 'W', keywords: ['w', 'ダブルユー', 'ダブリュー'] },
      { tag: '澄閃', keywords: ['澄閃', '澄闪', 'goldenglow', 'ゴールデングロー'] },
    ],
  },
  {
    work: '星穹鐵道',
    keywords: ['星穹鐵道', '星穹铁道', '崩壞星穹鐵道', '崩坏星穹铁道', '崩壊スターレイル', 'honkaistarrail', 'starrail', 'star rail', 'スターレイル'],
    characters: [
      { tag: '流螢', keywords: ['流螢', '流萤', 'firefly', 'ホタル'] },
      { tag: '花火', keywords: ['花火', 'sparkle', 'ハナビ', '스파كل'] },
      { tag: '火花', keywords: ['火花', 'sparxie', 'ひばな'] },
      { tag: '風堇', keywords: ['風堇', '风堇', '雅辛忒絲', '雅辛忒丝', 'hyacine', 'hyacinthia', 'ヒアシンシア', 'ヒアンシー'] },
      { tag: '昔漣', keywords: ['昔漣', '昔涟', 'cyrene', 'キュレネ'] },
      { tag: '長夜月', keywords: ['長夜月', '长夜月', 'evernight', 'エバーナイト', 'ながよづき'] },
      { tag: '銀狼', keywords: ['銀狼', '银狼', 'silver wolf', 'silverwolf', 'シルバーウルフ'] },
      { tag: '賽飛兒', keywords: ['賽飛兒', '赛飞儿', 'cipher', 'サフェル'] },
      { tag: '遐蝶', keywords: ['遐蝶', 'castorice', 'キャストリス'] },
    ],
  },
  {
    work: '鳴潮',
    keywords: ['鳴潮', '鸣潮', 'wutheringwaves', 'wuthering waves', 'wuwa'],
    characters: [
      { tag: '千咲', keywords: ['千咲', '千咲ちゃん', 'chisa'] },
      { tag: '尤諾', keywords: ['挑戰者', '尤諾', '尤诺', 'iuno', 'yuno', 'ユーノ'] },
      { tag: '守岸人', keywords: ['守岸人', 'ショアキーパー', 'shorekeeper'] },
      { tag: '卡提希婭', keywords: ['卡提希婭', '卡提希娅', '卡提西娅', 'cartethyia', 'カルテジア'] },
      { tag: '達妮婭', keywords: ['達妮婭', '達妮亞', '达妮娅', '达妮亚', 'denia', 'ダニア', 'ダーニャ', 'danya'] },
      { tag: '菲比', keywords: ['菲比', 'phoebe', 'フィービー'] },
      { tag: '愛彌斯', keywords: ['愛彌斯', '爱弥斯', 'aemeath', 'エイメス'] },
    ],
  },
  {
    work: '絕區零',
    keywords: ['絕區零', '绝区零', 'zenless', 'zzz', 'ゼンゼロ'],
    characters: [
      { tag: '儀玄', keywords: ['儀玄', '仪玄', 'yixuan', 'イーシェン'] },
      { tag: '千夏', keywords: ['千夏', 'chinatsu', 'ちなつ', 'チナツ', 'sunna'] },
      { tag: '星見雅', keywords: ['星見雅', '星见雅', 'miyabi', 'hoshimi miyabi', 'ほしみ みやび', 'みやび', 'ミヤビ'] },
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
      { tag: '納西妲', keywords: ['納西妲', '纳西妲', 'nahida', 'ナヒーダ', '草神'] },
      { tag: '八重神子', keywords: ['八重神子', 'yae miko', 'yaemiko', 'やえみこ', 'ヤエミコ'] },
      { tag: '刻晴', keywords: ['刻晴', 'keqing', 'コクセイ', 'こくせい', '각청'] },
      { tag: '千織', keywords: ['千織', '千织', 'chiori', 'ちおり', 'チオリ', '치오리'] },
      { tag: '胡桃', keywords: ['胡桃', 'hu tao', 'hutao', 'フータオ'] },
      { tag: '優菈', keywords: ['優菈', '优菈', 'eula', 'エウルア'] },
      { tag: '菲謝爾', keywords: ['菲謝爾', '菲谢尔', 'fischl', 'フィッシュル'] },
      { tag: '芙寧娜', keywords: ['芙寧娜', '芙宁娜', 'furina', 'フリーナ'] },
      { tag: '申鶴', keywords: ['申鶴', '申鹤', 'shenhe', 'シェンヘ'] },
    ],
  },
  {
    work: 'MyGO',
    keywords: ['mygo', '豐川祥子', '丰川祥子', '若葉睦', '若叶睦', 'avemujica', 'バンドリ'],
    characters: [
      { tag: '豐川祥子', keywords: ['豐川祥子', '丰川祥子', '祥子', 'sakiko', 'さきこ', 'サキコ', '豊川祥子'] },
      { tag: '若葉睦', keywords: ['若葉睦', '若叶睦', '睦ちゃん', 'mutsumi', 'むつみ', 'ムツミ', '睦'] },
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
      { tag: '尾張', keywords: ['尾張', '尾张', 'owari', 'オワリ', 'おわり'] },
      { tag: '能代', keywords: ['能代', 'noshiro', 'のしろ', 'ノシロ'] },
      { tag: '塔什干', keywords: ['塔什干', 'tashkent', 'タシュケント'] },
      { tag: '帕薩迪納', keywords: ['帕薩迪納', '帕萨迪纳', 'pasadena', 'パサデナ'] },
      { tag: '柴郡', keywords: ['柴郡', 'cheshire', 'チェシャー'] },
    ],
  },
  {
    work: '東方Project',
    keywords: ['東方project', '东方project', '東方', '东方'],
    characters: [
      { tag: '十六夜咲夜', keywords: ['十六夜咲夜', '咲夜', 'sakuya', 'さくや', 'サクヤ'] },
      { tag: '博麗靈夢', keywords: ['博麗靈夢', '博丽灵梦', '靈夢', '灵梦', 'reimu', 'れいむ', 'レイム', '博麗霊夢', '霊夢'] },
      { tag: '古明地戀', keywords: ['古明地戀', '古明地恋', 'こいし', 'koishi', 'コイシ', '古明地こいし', '恋恋'] },
      { tag: '鈴仙', keywords: ['鈴仙', '铃仙', 'reisen', 'reisen udongein inaba', '鈴仙・優曇華院・イナバ'] },
    ],
  },
  {
    work: 'Fate',
    keywords: ['fgo', 'fate', 'fate/grand order', 'fategrandorder', 'fate/stay night'],
    characters: [
      { tag: '阿斯托爾福', keywords: ['阿斯托爾福', '阿斯托尔福', '阿福', 'astolfo', 'アストルフォ'] },
      { tag: '美遊', keywords: ['美遊', '美游', 'miyu', 'ミユ'] },
      { tag: '伊莉雅', keywords: ['伊莉雅', 'ilyasviel', 'イリヤ'] },
      { tag: '克洛伊', keywords: ['克洛伊', 'chloe', 'クロエ'] },
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
    work: '賽馬娘',
    keywords: ['賽馬娘', '赛马娘', 'umamusume', 'uma musume', 'ウマ娘', 'ウマ娘プリティーダービー'],
    characters: [
      { tag: '特別週', keywords: ['特別週', '特别周', 'special week', 'スペシャルウィーク'] },
      { tag: '無聲鈴鹿', keywords: ['無聲鈴鹿', '无声铃鹿', 'silence suzuka', 'サイレンススズカ'] },
      { tag: '東海帝皇', keywords: ['東海帝皇', '东海帝皇', '東海帝王', '东海帝王', 'tokai teio', 'トウカイテイオー'] },
      { tag: '黃金船', keywords: ['黃金船', '黄金船', 'gold ship', 'ゴールドシップ'] },
      { tag: '目白麥昆', keywords: ['目白麥昆', '目白麦昆', 'mejiro mcqueen', 'メジロマックイーン'] },
      { tag: '米浴', keywords: ['米浴', 'rice shower', 'ライスシャワー'] },
      { tag: '小栗帽', keywords: ['小栗帽', 'oguri cap', 'オグリキャップ', 'オグリキャップ生誕祭2023'] },
      { tag: '玉藻十字', keywords: ['玉藻十字', 'tamamo cross', 'タマモクロス'] },
      { tag: '黃金旅程', keywords: ['黃金旅程', '黄金旅程', 'stay gold', 'staygold', 'ステイゴールド'] },
    ],
  },
  {
    work: '勝利女神：妮姬',
    keywords: ['勝利女神：妮姬', '胜利女神：妮姬', '妮姬', 'nikke', '勝利の女神：nikke', '勝利の女神', 'メガニケ', 'ニケ', 'nikkecosplay'],
    characters: [
      { tag: '毒蛇', keywords: ['毒蛇', 'viper', 'バイパー', '바이퍼'] },
      { tag: '愛麗絲', keywords: ['愛麗絲', '艾丽丝', 'alice', 'アリス'] },
      { tag: '馬斯特', keywords: ['馬斯特', '马斯特', 'mast', 'マスト', '마스트'] },
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
    keywords: ['vocaloid', '初音未來', '初音未来', 'miku', '初音ミク', 'hatsunemiku'],
    characters: [
      { tag: '初音未來', keywords: ['初音未來', '初音未来', 'miku', 'hatsune miku', '初音ミク'] },
    ],
  },
  {
    work: '世界計畫',
    keywords: ['世界計畫', '世界计划', 'proseka', 'project sekai', 'プロセカ', 'mzk'],
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
  {
    work: '葬送的芙莉蓮',
    keywords: ['葬送的芙莉蓮', '葬送的芙丽莲', 'frieren', '葬送のフリーレン'],
    characters: [
      { tag: '芙莉蓮', keywords: ['芙莉蓮', '芙丽莲', 'frieren', 'フリーレン', '芙莉莲'] },
      { tag: '費倫', keywords: ['費倫', '费伦', 'fern', 'フェルン'] },
    ],
  },
  {
    work: '無職轉生',
    keywords: ['無職轉生', '无职转生', 'mushokutensei', 'mushoku tensei', '無職轉生', '無職轉生', '無職転生'],
    characters: [
      { tag: '洛琪希', keywords: ['洛琪希', 'roxy', 'roxy migurdia', 'ロキシー'] },
    ],
  },
  {
    work: 'Maimai',
    keywords: ['maimai', 'マイマイ'],
    characters: [],
  },
  {
    work: 'MiSide',
    keywords: ['miside', 'ミサイド'],
    characters: [
      { tag: '米塔', keywords: ['米塔', 'mita', 'ミタ'] },
    ],
  },
  {
    work: '埃羅芒阿老師',
    keywords: ['埃羅芒阿老師', '埃罗芒阿老师', 'eromanga sensei', 'エロマンガ先生'],
    characters: [
      { tag: '和泉紗霧', keywords: ['和泉紗霧', '和泉纱雾', 'sagiri', 'izumi sagiri', '和泉サギリ', 'サキリ', 'サギリ'] },
    ],
  },
  {
    work: '超かぐや姫',
    keywords: ['超かぐや姫', 'chokaguyahime', 'cosmic princess kaguya', '超竹取物語'],
    characters: [
      { tag: '駒澤乃依', keywords: ['駒澤乃依', '驹泽乃依', 'noi komazawa', 'こまざわ のい'] },
    ],
  },
  {
    work: '孤獨搖滾',
    keywords: ['孤獨搖滾', '孤独摇滚', 'bocchitherock', 'bocchi the rock', 'ぼっちざろっく', 'ぼっち・ざ・ろっく', 'ぼざろ'],
    characters: [
      { tag: '後藤一里', keywords: ['後藤一里', '后藤一里', '波奇', 'bocchi', 'hitori gotoh', 'gotoh hitori', '後藤ひとり', 'ぼっち'] },
      { tag: '喜多郁代', keywords: ['喜多郁代', 'kita ikuyo', 'ikuyo', 'きたちゃん', 'キタちゃん'] },
      { tag: '山田涼', keywords: ['山田涼', '山田凉', 'ryo yamada', 'yamada ryo', '山田リョウ', 'リョウ'] },
      { tag: '伊地知虹夏', keywords: ['伊地知虹夏', 'nijika ijichi', 'ijichi nijika', 'にじか', 'ニジカ'] },
    ],
  },
  {
    work: '少女前線',
    keywords: ['少女前線', '少女前线', 'girlsfrontline', 'girls frontline', 'ドールズフロントライン', 'ドルフロ', '소녀전선'],
    characters: [],
  },
  {
    work: '星之翼',
    keywords: ['星之翼', 'starward', '星の翼', 'star wings', 'starwings'],
    characters: [],
  },
  {
    work: '白聖女與黑牧師',
    keywords: ['白聖女與黑牧師', '白圣女与黑牧师', 'saint cecilia and pastor lawrence', '白聖女と黒牧師'],
    characters: [],
  },
  {
    work: 'Re:從零開始的異世界生活',
    keywords: ['re:從零開始的異世界生活', 're:从零开始的异世界生活', 're:zero', 're:ゼロ', 'reゼロ'],
    characters: [
      { tag: '愛蜜莉雅', keywords: ['愛蜜莉雅', '爱蜜莉雅', 'emilia', 'エミリア'] },
      { tag: '雷姆', keywords: ['雷姆', 'レム', 'rem'] },
      { tag: '拉姆', keywords: ['拉姆', 'ラム', 'ram'] },
    ],
  },
  {
    work: '異環',
    keywords: ['異環', '异环', 'neverness to everland', 'nte'],
    characters: [],
  },
  {
    work: '超異域公主連結 Re:Dive',
    keywords: ['超異域公主連結', '超异域公主连结', '公主連結', '公主连结', 'princess connect', 'priconne', 'プリンセスコネクト'],
    characters: [],
  },
  {
    work: '為美好的世界獻上祝福！',
    keywords: ['為美好的世界獻上祝福！', '为美好的世界献上祝福！', 'konosuba', 'この素晴らしい世界に祝福を', 'このすば'],
    characters: [
      { tag: '惠惠', keywords: ['惠惠', 'めぐみん', 'megumin'] },
      { tag: '阿庫婭', keywords: ['阿庫婭', '阿库娅', 'アクア', 'aqua'] },
      { tag: '達克妮絲', keywords: ['達克妮絲', '达克妮斯', 'ダクネス', 'darkness'] },
    ],
  },
  {
    work: '莉可麗絲',
    keywords: ['莉可麗絲', '莉可丽丝', 'lycoris recoil', 'リコリス・リコイル', 'リコリコ'],
    characters: [
      { tag: '錦木千束', keywords: ['錦木千束', '锦木千束', '千束', 'chisato'] },
      { tag: '井之上瀧奈', keywords: ['井之上瀧奈', '井之上泷奈', '瀧奈', '泷奈', 'takina'] },
    ],
  },
  {
    work: '刀劍神域',
    keywords: ['刀劍神域', '刀剑神域', 'sword art online', 'sao', 'ソードアート・オンライン'],
    characters: [
      { tag: '結城明日奈', keywords: ['結城明日奈', '结城明日奈', '亞絲娜', '亚丝娜', 'asuna'] },
    ],
  },
];

export const WORK_TAGS = WORK_TAG_GROUPS.map((group) => group.work);

export function applyWorkCharacterTags(autoTags: Set<string>, description: string): void {
  const descLower = description.toLowerCase();
  for (const group of WORK_TAG_GROUPS) {
    const matchedCharacters = group.characters.filter((character) => matchesAny(descLower, character.keywords));
    if (matchedCharacters.length > 0 || matchesAny(descLower, group.keywords)) {
      autoTags.add(group.work);
    }
    for (const character of matchedCharacters) {
      autoTags.add(character.tag);
    }
  }
}

function matchesAny(descLower: string, keywords: (string | RegExp)[]): boolean {
  return keywords.some((keyword) => {
    if (keyword instanceof RegExp) {
      return keyword.test(descLower);
    }
    const kw = keyword.toLowerCase();
    if (/^[a-z0-9\s-]+$/i.test(kw)) {
      const regex = new RegExp(`\\b${kw}\\b`);
      return regex.test(descLower);
    }
    return descLower.includes(kw);
  });
}
