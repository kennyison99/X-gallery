# Navbar Version Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the existing build version immediately left of the navbar theme button and remove it from the footer.

**Architecture:** `BaseLayout.astro` continues to read the build version and passes it to `Header.astro`. The header owns the badge markup and presentation while the footer retains only its existing descriptive text.

**Tech Stack:** Astro 6, scoped CSS, in-app Chromium browser

---

### Task 1: Move the Version Badge

**Files:**
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `src/components/Header.astro`
- Verify: navbar and footer DOM at desktop and 390px widths

- [x] **Step 1: Run the failing browser assertions**

Inspect the current page and verify the desired state is absent:

```text
.header-nav .version-tag count == 0
.footer .version-tag count == 1
```

- [x] **Step 2: Add the Header version prop and badge**

Add the prop contract and render the badge before the theme button:

```astro
---
interface Props {
  version: string;
}

const { version } = Astro.props;
---

<div class="nav-actions">
  <span class="version-tag">{version}</span>
  <button id="theme-toggle" class="theme-toggle-btn" aria-label="Toggle light/dark theme">
```

Add scoped layout and badge styling:

```css
.nav-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.version-tag {
  display: inline-block;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  background-color: var(--border-color);
  color: var(--text-secondary);
  font-family: monospace;
  font-size: 0.75rem;
  line-height: 1.4;
  white-space: nowrap;
  opacity: 0.8;
}
```

- [x] **Step 3: Pass the version and remove the footer badge**

Update the header call:

```astro
<Header version={versionString} />
```

Keep only the footer description:

```astro
<p>© 2026 Twitter Gallery. Built with Astro & Cloudflare Pages.</p>
```

Remove the obsolete `.version-tag` style from `BaseLayout.astro`.

- [x] **Step 4: Run browser DOM and layout assertions**

At desktop and 390x844 viewports, verify:

```text
.header-nav .version-tag count == 1
.footer .version-tag count == 0
version badge right edge < theme button left edge
navbar scrollWidth <= navbar clientWidth
```

Toggle light and dark modes and verify the badge remains visible in both.

- [x] **Step 5: Run repository verification**

```powershell
rtk npm run build
rtk git diff --check
```

Expected: build exits 0 and the diff check reports no errors.

- [x] **Step 6: Commit the implementation**

```powershell
rtk git add src/layouts/BaseLayout.astro src/components/Header.astro docs/superpowers/plans/2026-06-18-navbar-version-badge.md
rtk git commit -m "feat: move version badge to navbar"
```
