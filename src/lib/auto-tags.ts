export function generateAutoTags(author: string | null, description: string | null): string[] {
  const autoTags = new Set<string>();

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

  // --- Proposed Costume & Style Tags ---
  if (matchesAny(descLower, ['男娘', '男の娘', '伪娘', '偽娘', '女装大佬', '女裝大佬', '可爱的男孩子', '可爱の男孩子', 'femboy', 'crossdress', 'crossdresser', '阿斯托尔福', '阿斯托爾福', 'astolfo', 'アストルフォ'])) {
    autoTags.add('男娘');
  }

  if (matchesAny(descLower, ['地雷系', '地雷女子', '地雷'])) {
    autoTags.add('地雷系');
  }

  if (matchesAny(descLower, ['水手服', 'セーラー服', 'sailor'])) {
    autoTags.add('水手服');
  }

  if (matchesAny(descLower, ['吊帶襪', '吊带袜', 'ガーター', 'garter'])) {
    autoTags.add('吊帶襪');
  }

  if (matchesAny(descLower, ['足控', '美足', '足控福利', '足底'])) {
    autoTags.add('足控');
  }

  if (matchesAny(descLower, ['反差'])) {
    autoTags.add('反差');
  }

  if (matchesAny(descLower, ['绳缚', '繩縛', '紧缚', '緊縛', 'shibari', 'bondage'])) {
    autoTags.add('繩縛');
  }

  if (matchesAny(descLower, ['泳衣', '泳裝', '泳装', '水着', 'bikini', 'swimsuit', '死庫水', 'スク水'])) {
    autoTags.add('泳裝');
  }

  if (matchesAny(descLower, ['內衣', '内衣', '下着', 'lingerie', 'underwear', '胸罩', 'ブラジャー', '內褲', '内裤', 'ショーツ'])) {
    autoTags.add('內衣');
  }

  if (matchesAny(descLower, ['女僕', '女仆', 'メイド', 'maid'])) {
    autoTags.add('女僕');
  }

  if (matchesAny(descLower, ['兔女郎', '兔女', 'バニー', 'bunny girl', 'bunny suit'])) {
    autoTags.add('兔女郎');
  }

  if (matchesAny(descLower, ['高跟鞋', '高跟', 'パンプス', 'ハイヒール', 'heels', 'high heels'])) {
    autoTags.add('高跟鞋');
  }

  if (matchesAny(descLower, ['眼鏡', '眼镜', 'メガネ', 'glasses'])) {
    autoTags.add('眼鏡');
  }

  if (matchesAny(descLower, ['體操服', '体操服', '体操着', 'ブルマ', 'bloomers', 'gym uniform'])) {
    autoTags.add('體操服');
  }

  if (matchesAny(descLower, ['和服', '着物', '浴衣', 'kimono', 'yukata'])) {
    autoTags.add('和服');
  }

  if (matchesAny(descLower, ['ol', '西裝', '西装', 'スーツ', 'office lady', '職服', '工作服'])) {
    autoTags.add('OL');
  }

  if (matchesAny(descLower, ['jk', '制服', '校服', '學生服', '学生服', 'school uniform'])) {
    autoTags.add('JK');
  }

  // --- Game, Anime & Character Tags ---
  if (matchesAny(descLower, ['bluearchive', 'blue archive', '碧藍檔案', '蔚藍檔案', '碧蓝档案', '蔚蓝档案', 'ブルアカ', '妃咲', 'kisaki', '夏目', 'natsume', 'コハル', '下江コハル', 'hoshino', 'takanashihoshino', '星野', '小鸟游星野', 'キキョウ', '桐生桔梗', '桐生キキョウ'])) {
    autoTags.add('蔚藍檔案');
  }

  if (matchesAny(descLower, ['明日方舟', 'arknights', 'アークナイツ', '阿米娅', '阿米婭', '阿尔图罗', '塑心', '德克萨斯', 'texas', '普瑞赛斯', 'endfield', '終末地', '终末地', 'エンドフィールド', '千咲'])) {
    autoTags.add('明日方舟');
  }

  if (matchesAny(descLower, ['崩壊スターレイル', '崩壞星穹鐵道', '崩坏星穹铁道', 'honkaistarrail', 'starrail', 'star rail', 'スターレイル', '银狼', '銀狼', 'firefly', '流萤', '流螢', 'sparkle', '花火'])) {
    autoTags.add('星穹鐵道');
  }

  if (matchesAny(descLower, ['原神', 'genshin', 'genshinimpact', '纳西妲', 'nahida', '草神'])) {
    autoTags.add('原神');
  }

  if (matchesAny(descLower, ['zzz', 'zenless', '絕區零', '绝区零'])) {
    autoTags.add('絕區零');
  }

  if (matchesAny(descLower, ['mygo', '丰川祥子', '祥子', '若叶睦', '若葉睦', '睦ちゃん'])) {
    autoTags.add('MyGO');
  }

  if (matchesAny(descLower, ['azurlane', 'azur lane', '碧藍航線', '碧蓝航线', 'アズールレーン'])) {
    autoTags.add('碧藍航線');
  }

  if (matchesAny(descLower, ['赛马娘', '賽馬娘', 'ウマ娘', 'umamusume'])) {
    autoTags.add('賽馬娘');
  }

  if (matchesAny(descLower, ['東方project', '東方', '十六夜咲夜', '咲夜', '古明地', 'こいし', 'koishi', '博丽灵梦', '博麗靈夢', '灵梦', '靈夢', 'れいむ'])) {
    autoTags.add('東方Project');
  }

  if (matchesAny(descLower, ['プロセカ', 'proseka', '曉山瑞希', '晓山瑞希', '瑞希'])) {
    autoTags.add('世界計畫');
  }

  if (matchesAny(descLower, ['nikke', '妮姬', 'メガニケ'])) {
    autoTags.add('妮姬');
  }

  if (matchesAny(descLower, ['フリーレン', 'frieren', '芙莉蓮', '芙莉连', '葬送'])) {
    autoTags.add('芙莉蓮');
  }

  if (matchesAny(descLower, ['小鸟游六花', '小鳥遊六花', '六花', 'rikka'])) {
    autoTags.add('中二病');
  }

  if (matchesAny(descLower, ['カルテジア', 'cartethyia', 'cartesia', '卡尔特西娅', '卡爾特西婭'])) {
    autoTags.add('遊戲王');
  }

  if (matchesAny(descLower, ['miside'])) {
    autoTags.add('MiSide');
  }

  return [...autoTags];
}

function matchesAny(description: string, keywords: string[]): boolean {
  return keywords.some((keyword) => description.includes(keyword));
}
