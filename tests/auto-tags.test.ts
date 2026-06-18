import assert from 'node:assert/strict';
import test from 'node:test';

const { generateAutoTags = () => [] } = await import('../src/lib/auto-tags.ts').catch(() => ({}));

test('maps simplified Chinese keywords to canonical tags', () => {
  assert.deepEqual(
    generateAutoTags('ExampleUser', '黑丝 白丝 丝袜 网袜 赤脚 写真 周刊'),
    ['exampleuser', '黑絲', '絲襪', '白絲', '裸足', '寫真']
  );
});

test('preserves existing traditional Chinese keyword behavior', () => {
  assert.deepEqual(
    generateAutoTags('ExampleUser', '黑絲 白絲 網襪 赤腳 寫真 週刊 日常'),
    ['exampleuser', '黑絲', '絲襪', '白絲', '裸足', '寫真', '日常']
  );
});
