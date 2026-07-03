import assert from 'node:assert/strict';
import test from 'node:test';

const { generateAutoTags = () => [] } = await import('../src/lib/auto-tags.ts').catch(() => ({}));

test('maps simplified Chinese keywords to canonical tags', () => {
  assert.deepEqual(
    generateAutoTags('ExampleUser', '黑丝 白丝 丝袜 网袜 赤脚 写真 周刊'),
    ['黑絲', '絲襪', '白絲', '裸足', '寫真']
  );
});

test('preserves existing traditional Chinese keyword behavior', () => {
  assert.deepEqual(
    generateAutoTags('ExampleUser', '黑絲 白絲 網襪 赤腳 寫真 週刊 日常'),
    ['黑絲', '絲襪', '白絲', '裸足', '寫真', '日常']
  );
});

test('maps observed gallery descriptions to existing and new canonical tags', () => {
  assert.deepEqual(
    generateAutoTags(
      'ExampleUser',
      '#蔚蓝档案 #BuleArchive #柚鸟夏 #阿尔图罗 #塑心 #MushokuTensei #maimai 袜子挺碍事的 搓搓脚'
    ),
    ['絲襪', '足控', '蔚藍檔案', '明日方舟', '無職轉生', 'maimai', '柚鳥夏', '阿爾圖羅']
  );
});

test('adds character tags together with their work tags', () => {
  assert.deepEqual(
    generateAutoTags('ExampleUser', '#Firefly #HonkaiStarRail #Chisa #WutheringWaves #仪玄'),
    ['星穹鐵道', '鳴潮', '絕區零', '流螢', '千咲', '儀玄']
  );
});
