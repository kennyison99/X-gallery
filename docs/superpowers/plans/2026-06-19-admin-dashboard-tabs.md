# Admin Dashboard Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `/admin` into a single-page hash-tab dashboard and display every author consistently as `nick@handle` without allowing duplicate `@` characters.

**Architecture:** Pure helpers own author normalization/formatting and hash resolution. The current server data loading remains in `src/pages/admin/index.astro`, while the five visual areas move into focused Astro components that retain the existing element IDs used by client handlers. Existing API routes gain canonical author writes and optional display-name persistence.

**Tech Stack:** Astro 6, TypeScript, Cloudflare Workers/D1/R2, Node test runner, plain CSS and browser DOM APIs

---

## File Map

- Create `src/lib/admin-dashboard.ts`: pure author and hash-tab rules.
- Create `tests/admin-dashboard.test.ts`: unit coverage for all pure rules.
- Create `src/components/admin/AdminDashboardTabs.astro`: accessible top navigation.
- Create `src/components/admin/AdminOverview.astro`: counts, R2 widget, and quick actions.
- Create `src/components/admin/AdminUploadPanel.astro`: existing create/edit form and nick field.
- Create `src/components/admin/AdminPostManager.astro`: existing filters, views, pagination, and bulk controls.
- Create `src/components/admin/AdminCrawlerPanel.astro`: existing crawl-account controls.
- Create `src/components/admin/AdminAutoTagPanel.astro`: existing auto-tag controls.
- Create `src/styles/admin.css`: styles moved from the page plus responsive dashboard rules.
- Modify `src/pages/admin/index.astro`: compose components and wire hash tabs/nick behavior.
- Modify `src/pages/api/images.ts`: normalize author and persist `author_display_name` on create.
- Modify `src/pages/api/images/[id].ts`: normalize author and persist `author_display_name` on edit.
- Modify `src/pages/api/crawl-upload.ts`: enforce canonical author storage for crawler uploads.

### Task 1: Add tested author and tab rules

**Files:**
- Create: `src/lib/admin-dashboard.ts`
- Create: `tests/admin-dashboard.test.ts`

- [ ] **Step 1: Write the failing unit tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorSearchText,
  formatAuthorName,
  normalizeAuthorHandle,
  resolveAdminTab,
} from '../src/lib/admin-dashboard.ts';

test('normalizes whitespace and every leading at sign', () => {
  assert.equal(normalizeAuthorHandle('  @@elysia2kawaii  '), 'elysia2kawaii');
});

test('formats nick and handle without duplicate at signs', () => {
  assert.equal(formatAuthorName('笨蛋愛麗絲', '@ailisidabendan'), '笨蛋愛麗絲@ailisidabendan');
  assert.equal(formatAuthorName('', '@@ailisidabendan'), '@ailisidabendan');
});

test('builds searchable text from nick and handle', () => {
  assert.equal(authorSearchText('笨蛋愛麗絲', '@ailisidabendan'), '笨蛋愛麗絲 ailisidabendan');
});

test('resolves supported hashes and defaults invalid hashes to overview', () => {
  assert.equal(resolveAdminTab('#posts'), 'posts');
  assert.equal(resolveAdminTab('upload'), 'upload');
  assert.equal(resolveAdminTab(''), 'overview');
  assert.equal(resolveAdminTab('#unknown'), 'overview');
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
rtk powershell -NoProfile -Command "node --experimental-strip-types --test tests/admin-dashboard.test.ts"
```

Expected: failure because `src/lib/admin-dashboard.ts` does not exist.

- [ ] **Step 3: Implement the pure rules**

```ts
export const ADMIN_TABS = ['overview', 'posts', 'upload', 'crawler', 'auto-tag'] as const;
export type AdminTab = typeof ADMIN_TABS[number];

export function normalizeAuthorHandle(value: unknown): string {
  return String(value ?? '').trim().replace(/^@+/, '').trim();
}

export function formatAuthorName(displayName: unknown, handle: unknown): string {
  const cleanDisplayName = String(displayName ?? '').trim();
  const cleanHandle = normalizeAuthorHandle(handle);
  if (!cleanHandle) return cleanDisplayName;
  return cleanDisplayName ? `${cleanDisplayName}@${cleanHandle}` : `@${cleanHandle}`;
}

export function authorSearchText(displayName: unknown, handle: unknown): string {
  return `${String(displayName ?? '').trim()} ${normalizeAuthorHandle(handle)}`.trim().toLowerCase();
}

export function resolveAdminTab(hash: string): AdminTab {
  const candidate = hash.replace(/^#/, '') as AdminTab;
  return ADMIN_TABS.includes(candidate) ? candidate : 'overview';
}
```

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run the Step 2 command. Expected: 4 tests pass, 0 fail.

- [ ] **Step 5: Commit the helper and tests**

```powershell
rtk powershell -NoProfile -Command "git add -- src/lib/admin-dashboard.ts tests/admin-dashboard.test.ts"
rtk powershell -NoProfile -Command "git commit -m 'test: define admin dashboard behavior'"
```

### Task 2: Canonicalize author writes and persist nick

**Files:**
- Modify: `src/pages/api/images.ts`
- Modify: `src/pages/api/images/[id].ts`
- Modify: `src/pages/api/crawl-upload.ts`
- Test: `tests/admin-dashboard.test.ts`

- [ ] **Step 1: Extend the helper tests for API-ready author input**

Add this import and test:

```ts
import { normalizeAuthorInput } from '../src/lib/admin-dashboard.ts';

test('normalizes author form fields at API boundaries', () => {
  assert.deepEqual(normalizeAuthorInput(' @@ailisidabendan ', ' 笨蛋愛麗絲 '), {
    handle: 'ailisidabendan',
    displayName: '笨蛋愛麗絲',
  });
  assert.deepEqual(normalizeAuthorInput('@@', 'Alice'), {
    handle: '',
    displayName: 'Alice',
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Expected: `normalizeAuthorInput` is not exported.

- [ ] **Step 3: Add the input helper**

```ts
export function normalizeAuthorInput(handle: unknown, displayName: unknown) {
  return {
    handle: normalizeAuthorHandle(handle),
    displayName: String(displayName ?? '').trim(),
  };
}
```

- [ ] **Step 4: Use the helper in all three write APIs**

In each route, read `author_display_name`, normalize before validation, validate `authorInput.handle`, and bind canonical values:

```ts
const rawAuthor = formData.get('author');
const rawAuthorDisplayName = formData.get('author_display_name');
const authorInput = normalizeAuthorInput(rawAuthor, rawAuthorDisplayName);

if (!authorInput.handle) {
  return new Response(JSON.stringify({ error: 'Author/Twitter handle is required' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

Create SQL becomes:

```sql
INSERT INTO images (title, r2_keys, author, author_display_name, author_url, post_url, description)
VALUES (?, ?, ?, ?, ?, ?, ?)
```

Update SQL becomes:

```sql
UPDATE images
SET title = ?, r2_keys = ?, author = ?, author_display_name = ?, author_url = ?,
    post_url = ?, description = ?, published = 1, updated_at = datetime('now')
WHERE id = ?
```

Bind `authorInput.handle` and `authorInput.displayName`; do not bind the raw author values.

- [ ] **Step 5: Run focused tests and production build**

```powershell
rtk powershell -NoProfile -Command "node --experimental-strip-types --test tests/admin-dashboard.test.ts"
rtk powershell -NoProfile -Command "npm.cmd run build"
```

Expected: focused tests and build exit 0.

- [ ] **Step 6: Commit API normalization**

```powershell
rtk powershell -NoProfile -Command "git add -- src/lib/admin-dashboard.ts tests/admin-dashboard.test.ts src/pages/api/images.ts 'src/pages/api/images/[id].ts' src/pages/api/crawl-upload.ts"
rtk powershell -NoProfile -Command "git commit -m 'fix: normalize admin author metadata'"
```

### Task 3: Build the accessible hash-tab shell

**Files:**
- Create: `src/components/admin/AdminDashboardTabs.astro`
- Modify: `src/pages/admin/index.astro`
- Test: `tests/admin-dashboard.test.ts`

- [ ] **Step 1: Add a structural regression test**

```ts
import { readFileSync } from 'node:fs';

test('admin navigation exposes all accessible hash tabs', () => {
  const source = readFileSync(
    new URL('../src/components/admin/AdminDashboardTabs.astro', import.meta.url),
    'utf8',
  );
  for (const tab of ['overview', 'posts', 'upload', 'crawler', 'auto-tag']) {
    assert.match(source, new RegExp(`href=["']#${tab}["']`));
    assert.match(source, new RegExp(`aria-controls=["']panel-${tab}["']`));
  }
});
```

- [ ] **Step 2: Confirm the test fails before the component exists**

Run the focused test command from Task 1. Expected: missing component failure.

- [ ] **Step 3: Create the top-tab component**

```astro
---
const tabs = [
  ['overview', '總覽'],
  ['posts', '貼文管理'],
  ['upload', '新增貼文'],
  ['crawler', '爬蟲帳號'],
  ['auto-tag', 'Auto-tag'],
] as const;
---

<nav class="dashboard-tabs" aria-label="管理後台分頁">
  <div role="tablist" aria-orientation="horizontal">
    {tabs.map(([id, label]) => (
      <a
        id={`tab-${id}`}
        class="dashboard-tab"
        href={`#${id}`}
        role="tab"
        aria-controls={`panel-${id}`}
        aria-selected="false"
        tabindex="-1"
        data-admin-tab={id}
      >
        {label}
      </a>
    ))}
  </div>
</nav>
```

- [ ] **Step 4: Wire hash state in the existing page script**

```ts
import { resolveAdminTab } from '../../lib/admin-dashboard';

function activateAdminTab() {
  const activeTab = resolveAdminTab(window.location.hash);
  if (window.location.hash !== `#${activeTab}`) {
    history.replaceState(null, '', `#${activeTab}`);
  }

  document.querySelectorAll<HTMLElement>('[data-admin-tab]').forEach((tab) => {
    const selected = tab.dataset.adminTab === activeTab;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });

  document.querySelectorAll<HTMLElement>('[data-admin-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.adminPanel !== activeTab;
  });
}

window.addEventListener('hashchange', activateAdminTab);
activateAdminTab();

document.querySelector('[role="tablist"]')?.addEventListener('keydown', (event) => {
  if (!(event instanceof KeyboardEvent) || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll<HTMLAnchorElement>('[data-admin-tab]')];
  const currentIndex = tabs.indexOf(document.activeElement as HTMLAnchorElement);
  if (currentIndex < 0) return;
  event.preventDefault();
  const direction = event.key === 'ArrowRight' ? 1 : -1;
  tabs[(currentIndex + direction + tabs.length) % tabs.length].focus();
});
```

- [ ] **Step 5: Run the focused tests and commit**

Expected: all admin-dashboard tests pass.

```powershell
rtk powershell -NoProfile -Command "git add -- src/components/admin/AdminDashboardTabs.astro src/pages/admin/index.astro tests/admin-dashboard.test.ts"
rtk powershell -NoProfile -Command "git commit -m 'feat: add admin hash tab navigation'"
```

### Task 4: Extract dashboard panels without changing behavior

**Files:**
- Create: `src/components/admin/AdminOverview.astro`
- Create: `src/components/admin/AdminUploadPanel.astro`
- Create: `src/components/admin/AdminPostManager.astro`
- Create: `src/components/admin/AdminCrawlerPanel.astro`
- Create: `src/components/admin/AdminAutoTagPanel.astro`
- Modify: `src/pages/admin/index.astro`

- [ ] **Step 1: Create typed component contracts**

Use these frontmatter contracts and preserve every existing element ID/class inside the moved markup:

```ts
// AdminOverview.astro
interface Props { totalPosts: number; pendingPosts: number; totalAccounts: number; enabledAccounts: number }

// AdminUploadPanel.astro
interface Props { allTags: Array<{ name: string }> }

// AdminPostManager.astro
interface Props { images: any[] }

// AdminCrawlerPanel.astro
interface Props { accounts: any[] }

// AdminAutoTagPanel.astro has no props.
```

Each component root must follow this exact panel contract; replace the example body by mechanically moving the corresponding current panel body without changing its IDs, classes, or control order:

```astro
<section
  id="panel-overview"
  class="dashboard-panel"
  role="tabpanel"
  aria-labelledby="tab-overview"
  data-admin-panel="overview"
  hidden
>
  <slot />
</section>
```

Use the matching tab ID for each component. Extract by the existing marker boundaries: `Upload Panel` to `Manage List Panel`, `Manage List Panel` to `Auto-tag Panel`, `Auto-tag Panel` to `Crawl Accounts Panel`, and `Crawl Accounts Panel` to the end of `.admin-grid`. Remove only the old outer `<section>` tags because the component roots replace them. This is a mechanical move: all inner markup remains byte-for-byte equivalent so current client handlers keep finding the same IDs.

- [ ] **Step 2: Implement the overview with real existing metrics**

```astro
---
interface Props {
  totalPosts: number;
  pendingPosts: number;
  totalAccounts: number;
  enabledAccounts: number;
}
const { totalPosts, pendingPosts, totalAccounts, enabledAccounts } = Astro.props;
---

<section id="panel-overview" class="dashboard-panel" role="tabpanel"
  aria-labelledby="tab-overview" data-admin-panel="overview" hidden>
  <div class="overview-grid">
    <article class="overview-card"><span>全部貼文</span><strong>{totalPosts}</strong></article>
    <article class="overview-card"><span>待審查</span><strong>{pendingPosts}</strong></article>
    <article class="overview-card"><span>爬蟲帳號</span><strong>{totalAccounts}</strong><small>{enabledAccounts} 個啟用</small></article>
    <article class="overview-card storage-panel" id="storage-panel">
      <span>R2 容量</span>
      <strong id="storage-used">讀取中...</strong>
      <div class="storage-bar-wrap"><div class="storage-bar-fill" id="storage-bar-fill"></div></div>
      <button type="button" id="storage-reconcile-btn" class="btn">重新計算</button>
      <p class="storage-warning" id="storage-warning" hidden></p>
    </article>
  </div>
  <div class="quick-actions" aria-label="快捷操作">
    <a href="#upload" class="btn btn-primary">新增貼文</a>
    <a href="#posts" class="btn" data-post-status="pending">查看待審查</a>
    <a href="#crawler" class="btn">管理爬蟲帳號</a>
    <a href="#auto-tag" class="btn">執行 Auto-tag</a>
  </div>
</section>
```

Connect the pending quick action to the existing inner published/pending controls:

```ts
document.querySelector('[data-post-status="pending"]')?.addEventListener('click', () => {
  document.getElementById('tab-pending')?.click();
});
```

- [ ] **Step 3: Compose the extracted components in the page**

```astro
<AdminDashboardTabs />
<main class="dashboard-content">
  <AdminOverview
    totalPosts={formattedImages.length}
    pendingPosts={formattedImages.filter((image) => image.published === 0).length}
    totalAccounts={crawlAccounts.length}
    enabledAccounts={crawlAccounts.filter((account) => account.enabled).length}
  />
  <AdminPostManager images={formattedImages} />
  <AdminUploadPanel allTags={allTags} />
  <AdminCrawlerPanel accounts={crawlAccounts} />
  <AdminAutoTagPanel />
</main>
```

- [ ] **Step 4: Build after each panel move**

Run `rtk powershell -NoProfile -Command "npm.cmd run build"` after moving each component. Expected each time: exit 0; no duplicate element IDs.

- [ ] **Step 5: Commit the component extraction**

```powershell
rtk powershell -NoProfile -Command "git add -- src/components/admin src/pages/admin/index.astro"
rtk powershell -NoProfile -Command "git commit -m 'refactor: split admin dashboard panels'"
```

### Task 5: Connect nick fields, formatting, filters, and edit state

**Files:**
- Modify: `src/components/admin/AdminUploadPanel.astro`
- Modify: `src/components/admin/AdminPostManager.astro`
- Modify: `src/pages/admin/index.astro`
- Test: `tests/admin-dashboard.test.ts`

- [ ] **Step 1: Add the optional nick field**

```astro
<div class="form-group">
  <label for="image-author-display-name">作者顯示名稱</label>
  <input type="text" id="image-author-display-name" name="author_display_name"
    placeholder="例如：笨蛋愛麗絲" />
</div>
```

- [ ] **Step 2: Render canonical author data attributes and labels**

For every table row and grid card:

```astro
data-author={normalizeAuthorHandle(image.author)}
data-author-display-name={image.author_display_name || ''}
data-author-search={authorSearchText(image.author_display_name, image.author)}
```

Render the visible label with:

```astro
{formatAuthorName(image.author_display_name, image.author)}
```

Pass `formatAuthorName`, `normalizeAuthorHandle`, and `authorSearchText` into the post-manager component or import the pure helpers directly in its frontmatter.

- [ ] **Step 3: Populate author filters from canonical row attributes**

Replace text-content parsing with a handle-keyed map:

```ts
const authors = new Map<string, string>();
imageRows.forEach((row) => {
  const element = row as HTMLElement;
  const handle = element.dataset.author || '';
  const displayName = element.dataset.authorDisplayName || '';
  if (handle) authors.set(handle, formatAuthorName(displayName, handle));
});

[...authors.entries()]
  .sort((a, b) => a[1].localeCompare(b[1]))
  .forEach(([handle, label]) => {
    const option = document.createElement('option');
    option.value = handle.toLowerCase();
    option.textContent = label;
    authorFilter?.appendChild(option);
  });
```

Use `data-author-search` in the free-text search and `data-author` for exact author filtering.

- [ ] **Step 4: Restore nick during edit**

```ts
const authorDisplayNameInput = document.getElementById('image-author-display-name') as HTMLInputElement | null;
const authorDisplayName = btn.getAttribute('data-author-display-name') || '';
if (authorDisplayNameInput) authorDisplayNameInput.value = authorDisplayName;
```

The named input is included automatically by `new FormData(uploadForm)` for create and update requests.

- [ ] **Step 5: Verify focused tests and build, then commit**

```powershell
rtk powershell -NoProfile -Command "node --experimental-strip-types --test tests/admin-dashboard.test.ts"
rtk powershell -NoProfile -Command "npm.cmd run build"
rtk powershell -NoProfile -Command "git add -- src/components/admin/AdminUploadPanel.astro src/components/admin/AdminPostManager.astro src/pages/admin/index.astro tests/admin-dashboard.test.ts"
rtk powershell -NoProfile -Command "git commit -m 'feat: show admin authors as nick and handle'"
```

### Task 6: Move and finish dashboard styling

**Files:**
- Create: `src/styles/admin.css`
- Modify: `src/pages/admin/index.astro`

- [ ] **Step 1: Move existing admin styles unchanged into the stylesheet**

Import it from page frontmatter:

```ts
import '../../styles/admin.css';
```

Remove the old page `<style>` block after confirming all selectors are present in `admin.css`.

- [ ] **Step 2: Add dashboard tab, overview, and responsive rules**

```css
.dashboard-tabs {
  position: sticky;
  top: 0;
  z-index: 20;
  overflow-x: auto;
  border-bottom: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-primary) 94%, transparent);
  backdrop-filter: blur(12px);
}
.dashboard-tabs [role='tablist'] { display: flex; min-width: max-content; }
.dashboard-tab { padding: .85rem 1rem; color: var(--text-secondary); border-bottom: 2px solid transparent; }
.dashboard-tab:hover, .dashboard-tab:focus-visible { color: var(--text-primary); }
.dashboard-tab.active { color: var(--text-primary); border-bottom-color: var(--text-primary); }
.dashboard-panel[hidden] { display: none; }
.overview-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; }
.overview-card { min-width: 0; padding: 1rem; border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-secondary); }
.overview-card strong { display: block; margin-top: .5rem; font-size: clamp(1.4rem, 3vw, 2rem); }
.quick-actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1rem; }
@media (max-width: 800px) { .overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 480px) { .overview-grid { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .dashboard-tab { transition: none; } }
```

- [ ] **Step 3: Run build and inspect for stylesheet regressions**

Run the production build. Expected: exit 0 and no missing asset errors.

- [ ] **Step 4: Commit styling**

```powershell
rtk powershell -NoProfile -Command "git add -- src/styles/admin.css src/pages/admin/index.astro"
rtk powershell -NoProfile -Command "git commit -m 'style: finish responsive admin dashboard'"
```

### Task 7: Full verification and browser QA

**Files:**
- Modify only if verification exposes a scoped regression.

- [ ] **Step 1: Run all automated checks**

```powershell
rtk powershell -NoProfile -Command "node --experimental-strip-types --test tests/*.test.ts"
rtk powershell -NoProfile -Command "npm.cmd run build"
rtk powershell -NoProfile -Command "git diff --check"
```

Expected: new dashboard tests pass and production build exits 0. Record the three pre-existing auto-tag expectation failures separately if they remain; do not hide or silently rewrite them as part of this feature.

- [ ] **Step 2: Start the local app and verify hash navigation**

Open `/admin#overview`, `/admin#posts`, `/admin#upload`, `/admin#crawler`, and `/admin#auto-tag`. For each URL, confirm exactly one panel is visible, the matching tab has `aria-selected="true"`, refresh preserves the tab, and browser back/forward changes panels.

- [ ] **Step 3: Verify author behavior**

Create or edit a test post with handle `@@ailisidabendan` and nick `笨蛋愛麗絲`. Confirm the API stores `ailisidabendan`, and the table, grid, search results, and author filter show `笨蛋愛麗絲@ailisidabendan` with no `@@`.

- [ ] **Step 4: Verify existing workflows**

Confirm published/pending switching, text/author/tag/media filters, table/grid switching, pagination, selection, approval, edit/cancel, deletion, crawl-account controls, R2 refresh, and auto-tag progress still operate.

- [ ] **Step 5: Verify responsive widths**

At 375, 768, 1024, and 1440 pixels, confirm no page-level horizontal scroll, tabs remain reachable, controls have visible focus, and overview cards reflow to 1/2/4 columns.

- [ ] **Step 6: Review final scope and commit any verification-only correction**

Run `rtk powershell -NoProfile -Command "git status --short"`. Confirm `.check-r2.err.log` and `.check-r2.out.log` remain untracked and unstaged.
