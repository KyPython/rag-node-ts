#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function usage() {
  console.log('Usage: node scripts/ci_check_metrics.js --file <path> [--backend vector] [--threshold 0.6]');
  process.exit(2);
}

const argv = require('minimist')(process.argv.slice(2));
const file = argv.file || argv.f;
const backend = argv.backend || 'vector';
const threshold = parseFloat(argv.threshold || argv.t || '0.6');

if (!file) usage();

const p = path.resolve(process.cwd(), file);
if (!fs.existsSync(p)) {
  console.error('Metrics snapshot file not found:', p);
  process.exit(1);
}

const raw = fs.readFileSync(p, 'utf8');
let all;
try { all = JSON.parse(raw); } catch (e) { console.error('Invalid JSON in metrics snapshot'); process.exit(1); }

function sumMetric(name) {
  const m = all.find(x => x.name === name);
  if (!m || !Array.isArray(m.values)) return 0;
  return m.values.reduce((acc, v) => {
    if ((v.labels && v.labels.backend === backend) || !v.labels) {
      return acc + Number(v.value || 0);
    }
    return acc;
  }, 0);
}

const hits = sumMetric('cache_hits_total');
const misses = sumMetric('cache_misses_total');
const denom = hits + misses;

console.log('CI metrics check: backend=', backend, 'hits=', hits, 'misses=', misses);

if (denom === 0) {
  console.error('No cache hit/miss data found for backend:', backend);
  process.exit(1);
}

const rate = hits / denom;
console.log(`Cache hit rate=${(rate*100).toFixed(2)}% (threshold ${(threshold*100).toFixed(1)}%)`);
if (rate < threshold) {
  console.error('Cache hit rate below threshold, failing CI');
  process.exit(1);
}

console.log('Cache hit rate OK');
process.exit(0);
