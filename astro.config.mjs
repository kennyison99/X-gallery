// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { execSync } from 'node:child_process';

// Get version at compile time (on the builder machine)
let commitHash = 'unknown';
try {
  commitHash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch (e) {
  // Fallback
}

const buildDate = new Date().toLocaleDateString('zh-TW', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Hong_Kong'
}).replace(/\//g, '.');

const versionString = `v${buildDate}-${commitHash}`;

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: {
      enabled: true
    }
  }),
  security: {
    checkOrigin: false
  },
  vite: {
    define: {
      'import.meta.env.PUBLIC_BUILD_VERSION': JSON.stringify(versionString)
    }
  }
});