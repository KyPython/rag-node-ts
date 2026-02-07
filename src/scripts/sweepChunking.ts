import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { RecursiveCharacterTextSplitter } from '@langchain/classic/text_splitter';

function tokenize(text: string): Map<string, number> {
  const m = new Map<string, number>();
  const matches = text.toLowerCase().match(/\b\w+\b/g) || [];
  for (const w of matches) m.set(w, (m.get(w) || 0) + 1);
  return m;
}

function dot(a: Map<string, number>, b: Map<string, number>): number {
  let s = 0;
  for (const [k, va] of a.entries()) s += va * (b.get(k) || 0);
  return s;
}

function norm(a: Map<string, number>): number {
  let s = 0;
  for (const v of a.values()) s += v * v;
  return Math.sqrt(s);
}

async function runConfig(name: string, chunkSize: number, chunkOverlap: number, content: string, query: string) {
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });
  const chunks = await splitter.splitText(content);

  // find target chunk containing '72 hours'
  const targetIdx = chunks.findIndex((c) => /\b72\s*hours\b/i.test(c || ''));

  const qvec = tokenize(query);
  const qnorm = norm(qvec) || 1;

  const scored = chunks.map((text, i) => {
    const cvec = tokenize(text || '');
    const cnorm = norm(cvec) || 1;
    const s = dot(qvec, cvec) / (qnorm * cnorm);
    return { index: i, score: s };
  });

  const sorted = [...scored].sort((a, b) => b.score - a.score);

  const rank = targetIdx === -1 ? -1 : (sorted.findIndex((r) => r.index === targetIdx) + 1);

  const topKs = [1, 3, 5];
  const precision: Record<string, number> = {};
  for (const k of topKs) {
    const topIndices = sorted.slice(0, k).map((r) => r.index);
    precision[`p@${k}`] = targetIdx === -1 ? 0 : (topIndices.includes(targetIdx) ? 1 : 0);
  }

  const topScore = sorted[0]?.score ?? 0;
  const secondScore = sorted[1]?.score ?? 0;

  return {
    name,
    chunkSize,
    chunkOverlap,
    totalChunks: chunks.length,
    targetIdx,
    rank,
    topScore: topScore.toFixed(4),
    secondScore: secondScore.toFixed(4),
    margin: (topScore - secondScore).toFixed(4),
    precision,
  };
}

async function main() {
  const file = resolve(process.cwd(), 'samples/compliance/gdpr-data-protection.md');
  const content = await readFile(file, 'utf-8');

  const query = 'Within how many hours must a personal data breach be reported to the supervisory authority under GDPR?';

  const configs = [
    { name: 'OptionA', chunkSize: 500, chunkOverlap: 100 },
    { name: 'Original', chunkSize: 1000, chunkOverlap: 200 },
    { name: 'OptionB', chunkSize: 1500, chunkOverlap: 300 },
  ];

  const results = [] as any[];
  for (const cfg of configs) {
    const res = await runConfig(cfg.name, cfg.chunkSize, cfg.chunkOverlap, content, query);
    results.push(res);
  }

  console.log('Sweep results for GDPR query:\n');
  for (const r of results) {
    console.log(`- ${r.name} (chunkSize=${r.chunkSize}, overlap=${r.chunkOverlap})`);
    console.log(`  totalChunks: ${r.totalChunks}`);
    console.log(`  targetIdx: ${r.targetIdx}, rank: ${r.rank}`);
    console.log(`  topScore: ${r.topScore}, secondScore: ${r.secondScore}, margin: ${r.margin}`);
    console.log(`  precision: p@1=${r.precision['p@1']}, p@3=${r.precision['p@3']}, p@5=${r.precision['p@5']}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
