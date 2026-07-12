DROP TABLE IF EXISTS image_tags;
DROP TABLE IF EXISTS images;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS crawl_accounts;
DROP TABLE IF EXISTS storage_stats;

-- 圖片/推文卡片表格
CREATE TABLE images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  r2_keys TEXT NOT NULL,         -- 逗號分隔的 R2 keys, e.g. "key1,key2"
  author TEXT NOT NULL,          -- 博主 Twitter 帳號 (handle)
  author_display_name TEXT,      -- 博主 Twitter 顯示名稱 (nick)
  author_url TEXT,               -- 博主 Twitter 連結
  post_url TEXT,                 -- 原推文連結
  description TEXT,              -- 感想 / 內文
  likes INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT,               -- 最後編輯時間
  published INTEGER DEFAULT 1,
  photo_bytes INTEGER DEFAULT 0,
  video_bytes INTEGER DEFAULT 0
);

-- 標籤表格
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- 關聯表格
CREATE TABLE image_tags (
  image_id INTEGER REFERENCES images(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (image_id, tag_id)
);

-- 爬取帳號管理表格
CREATE TABLE crawl_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,        -- Twitter 帳號（不含 @）
  enabled INTEGER DEFAULT 1,            -- 是否啟用自動爬取
  crawl_all INTEGER DEFAULT 0,          -- 是否抓取全部歷史圖片 (0: 僅最新20, 1: 全部)
  last_crawled_at TEXT,                  -- 上次爬取時間
  last_crawl_type TEXT,                  -- 上次爬取來源: 'auto' | 'manual'
  last_crawl_mode TEXT,                  -- 上次爬取模式: 'latest' | 'all'
  last_crawl_count INTEGER DEFAULT 0,    -- 上次爬取新增圖片數量
  last_crawl_error TEXT,                 -- 上次爬取錯誤（不阻止其他帳號繼續）
  created_at TEXT DEFAULT (datetime('now'))
);

-- R2 容量統計表（單列，id=1）
-- 上傳時 +bytes，刪除時 -bytes，後台顯示 used / 10GB
CREATE TABLE storage_stats (
  id INTEGER PRIMARY KEY,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO storage_stats (id, total_bytes) VALUES (1, 0);
