import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { RecursiveCharacterTextSplitter } from '@langchain/classic/text_splitter';

function tokenize(text: string): Map<string, number> {
  const m = new Map<string, number>();
  const matches = text.toLowerCase().match(/\b\w+\b/g) || [];
  for (const w of matches) {
    m.set(w, (m.get(w) || 0) + 1);
  }
  return m;
}

function dot(a: Map<string, number>, b: Map<string, number>): number {
  let s = 0;
  for (const [k, va] of a.entries()) {
    const vb = b.get(k) || 0;
    s += va * vb;
  }
  return s;
}

function norm(a: Map<string, number>): number {
  let s = 0;
  for (const v of a.values()) s += v * v;
  return Math.sqrt(s);
}

async function main() {
  const file = resolve(process.cwd(), 'samples/compliance/gdpr-data-protection.md');
  const content = await readFile(file, 'utf-8');

  const chunkSize = 500;
  const chunkOverlap = 100;
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });
  const chunks = await splitter.splitText(content);

  const query = process.argv.slice(2).join(' ') ||
    'Within how many hours must a personal data breach be reported to the supervisory authority under GDPR?';
  const topK = parseInt(process.env.TOPK || '5', 10);

  const qvec = tokenize(query);
  const qnorm = norm(qvec) || 1;

  const scored = chunks.map((text, i) => {
    const cvec = tokenize(text || '');
    const cnorm = norm(cvec) || 1;
    const s = dot(qvec, cvec) / (qnorm * cnorm);
    const matched = Array.from(qvec.keys()).filter((k) => (cvec.get(k) || 0) > 0);
    return { index: i, text, score: s, matched };
  });

  scored.sort((a, b) => b.score - a.score);

  console.log(`Query: ${query}`);
  console.log(`Chunks: ${chunks.length}, showing top ${topK}`);
  for (let i = 0; i < Math.min(topK, scored.length); i++) {
    const r = scored[i]!;
    console.log(`\n#${i + 1} -> chunk ${r.index} (score=${r.score.toFixed(4)}) matched=[${r.matched.join(', ')}]`);
    console.log((r.text || '').slice(0, 400).replace(/\n/g, '\\n'));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
