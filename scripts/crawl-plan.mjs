import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mediaIdFromUrl } from './media-items.mjs';

export function splitCrawlWork(work) {
  // ponytail: history stays serial until overlapping cross-account uploads can be coordinated.
  if (work.some(({ account }) => account.crawl_all)) return [work];
  const parents = work.map((_, index) => index);
  const root = (index) => {
    while (parents[index] !== index) index = parents[index];
    return index;
  };
  const owners = new Map();
  work.forEach((entry, index) => {
    for (const media of entry.extracted?.media ?? []) {
      if (!media.url) continue;
      const id = mediaIdFromUrl(media.url);
      if (owners.has(id)) parents[root(index)] = root(owners.get(id));
      else owners.set(id, index);
    }
  });
  const groups = new Map();
  work.forEach((entry, index) => {
    const key = root(index);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  const shards = Array.from({ length: Math.min(2, groups.size) }, () => []);
  // ponytail: balance account counts; use measured costs if runtimes diverge.
  for (const group of [...groups.values()].sort((a, b) => b.length - a.length)) {
    const index = shards.length === 1 || shards[0].length <= shards[1].length ? 0 : 1;
    shards[index].push(...group);
  }
  return shards;
}

export function archiveDelta(base, archive, usernames) {
  const delta = Object.fromEntries(Object.entries(archive).filter(([key, value]) => value === 1 && base[key] !== 1));
  for (const key of archive.__recoveryTouched ?? []) delta[key] = archive[key] === 1 ? 1 : null;
  delta.__accounts = {};
  for (const username of usernames) {
    const key = username.toLowerCase();
    const checkpoint = archive.__accounts?.[key];
    if (checkpoint && JSON.stringify(checkpoint) !== JSON.stringify(base.__accounts?.[key])) {
      delta.__accounts[key] = checkpoint;
    }
  }
  return delta;
}

export function mergeCrawlArchives(base, deltas) {
  const merged = { ...base, __accounts: { ...base.__accounts } };
  for (const delta of deltas) {
    for (const [key, value] of Object.entries(delta)) {
      if (value === 1) merged[key] = 1;
      else if (value === null) delete merged[key];
    }
    Object.assign(merged.__accounts, delta.__accounts);
  }
  return merged;
}

function main() {
  const plan = JSON.parse(fs.readFileSync('scripts/.crawl-plan.json', 'utf8'));
  if (process.argv[2] === '--snapshot') {
    const shard = Number(process.argv[3]);
    if (!Number.isInteger(shard) || !plan.shards[shard]) throw new Error('Invalid crawl shard');
    const archive = fs.existsSync('scripts/.xtractor-archive.json')
      ? JSON.parse(fs.readFileSync('scripts/.xtractor-archive.json', 'utf8')) : plan.archive;
    const delta = archiveDelta(plan.archive, archive, plan.shards[shard].map(({ account }) => account.username));
    fs.writeFileSync('scripts/.crawl-shard-archive.json', JSON.stringify(delta));
  } else if (process.argv[2] === '--merge') {
    const directory = 'scripts/.crawl-results';
    const entries = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
    const snapshots = entries.map((name) => ({ name, match: /^crawl-archive-(\d+)-(\d+)$/.exec(name) }))
      .filter(({ match }) => match && Number(match[1]) < plan.shards.length)
      .sort((a, b) => Number(a.match[2]) - Number(b.match[2]));
    const deltas = snapshots.map(({ name }) => JSON.parse(fs.readFileSync(path.join(directory, name, '.crawl-shard-archive.json'), 'utf8')));
    const missing = plan.shards.filter((_, index) => !snapshots.some(({ match }) => Number(match[1]) === index)).length;
    const archivePath = 'scripts/.xtractor-archive.json';
    fs.writeFileSync(`${archivePath}.tmp`, JSON.stringify(mergeCrawlArchives(plan.archive, deltas)));
    fs.renameSync(`${archivePath}.tmp`, archivePath);
    console.log(`Merged ${snapshots.length} snapshot(s); ${missing} shard(s) missing.`);
    if (missing) process.exitCode = 1;
  } else {
    throw new Error('Expected --snapshot <shard> or --merge');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
}
