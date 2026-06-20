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

const parts = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Hong_Kong'
}).formatToParts(new Date());

const getVal = (type) => parts.find(p => p.type === type)?.value ?? '';
const YYYY = getVal('year');
const MM = getVal('month');
const DD = getVal('day');
const HH = getVal('hour');
const mm = getVal('minute');

const versionString = `v${YYYY}.${MM}.${DD}(${HH}${mm})-${commitHash}`;

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