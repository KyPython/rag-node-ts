import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { RecursiveCharacterTextSplitter } from '@langchain/classic/text_splitter';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: any = {};
  for (const a of args) {
    if (a === '--help' || a === '-h') {
      opts.help = true;
    }
    if (a.startsWith('--chunkSize=')) opts.chunkSize = Number(a.split('=')[1]);
    if (a.startsWith('--chunkOverlap=')) opts.chunkOverlap = Number(a.split('=')[1]);
    if (a.startsWith('--queryIndex=')) opts.queryIndex = Number(a.split('=')[1]);
    if (a.startsWith('--indices=')) opts.indices = a.split('=')[1];
    if (a.startsWith('--file=')) opts.file = a.split('=')[1];
  }
  return opts;
}

async function main() {
  const HELP = `Usage: node dist/scripts/editGroundTruth.js [options]

Options:
  --chunkSize=<n>       Chunk size used to split documents (default: 500)
  --chunkOverlap=<n>    Chunk overlap (default: 100)
  --queryIndex=<n>      Index of the query in samples/ground_truth.json to edit (default: 0)
  --indices=0,2,3       Non-interactive: set indices for the current config and exit
  --file=path           Ground-truth file path (default: samples/ground_truth.json)
  --help, -h            Show this help and exit
`;

  const opts = parseArgs();
  if (opts.help) {
    // eslint-disable-next-line no-console
    console.log(HELP);
    return;
  }
  const chunkSize = opts.chunkSize ?? 500;
  const chunkOverlap = opts.chunkOverlap ?? 100;
  const queryIndex = Number(opts.queryIndex ?? 0);
  const groundTruthFile = opts.file ?? 'samples/ground_truth.json';

  const mdPath = resolve(process.cwd(), 'samples/compliance/gdpr-data-protection.md');
  const content = await readFile(mdPath, 'utf8');

  const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });
  const chunks = await splitter.splitText(content);

  console.log(`Using chunkSize=${chunkSize} overlap=${chunkOverlap} -> totalChunks=${chunks.length}`);

  for (let i = 0; i < Math.min(chunks.length, 20); i++) {
    const c = chunks[i]!;
    console.log('---');
    console.log(`chunk ${i}: ${c.slice(0, 400).replace(/\n/g, ' ')}${c.length > 400 ? '...' : ''}`);
  }

  // If indices provided on CLI, write non-interactively
  if (opts.indices) {
    const indices = opts.indices.split(',').map((s: string) => Number(s.trim())).filter((n: number) => !Number.isNaN(n));
    await writeIndices(groundTruthFile, queryIndex, chunkSize, chunkOverlap, indices);
    console.log(`Wrote ${groundTruthFile} [queryIndex=${queryIndex}] c${chunkSize}_o${chunkOverlap} -> [${indices.join(',')}]`);
    return;
  }

  // Interactive prompt flow
  if (!process.stdin.isTTY) {
    console.log('\nNot a TTY and no --indices provided. Exiting.');
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    // Load existing ground truth for this query (if any)
    let existing: any = {};
    try {
      const raw = await readFile(resolve(process.cwd(), groundTruthFile), 'utf8');
      const parsed = JSON.parse(raw);
      existing = parsed[queryIndex] ? parsed[queryIndex].groundTruth || {} : {};
    } catch (e) {
      existing = {};
    }

    console.log('\nExisting ground-truth mappings for this query:');
    if (Object.keys(existing).length === 0) {
      console.log('  (none)');
    } else {
      for (const k of Object.keys(existing)) {
        console.log(`  ${k}: [${(existing as any)[k].join(',')}]`);
      }
    }

    console.log('\nActions: (a)dd/update, (d)elete config, (q)uit');
    const action = (await rl.question('Choose action: ')).trim().toLowerCase();
    if (action === 'q' || action === '') {
      console.log('No changes made.');
      return;
    }

    if (action === 'd') {
      const key = (await rl.question('Enter config key to delete (e.g. c500_o100): ')).trim();
      if (!key) {
        console.log('No key entered; aborting delete.');
        return;
      }
      const confirm = (await rl.question(`Confirm delete ${key}? (y/N): `)).trim().toLowerCase();
      if (confirm !== 'y') {
        console.log('Delete aborted.');
        return;
      }
      // read/modify/write
      let gt: any[] = [];
      try {
        const raw = await readFile(resolve(process.cwd(), groundTruthFile), 'utf8');
        gt = JSON.parse(raw);
      } catch (err) {
        gt = [];
      }
      if (!gt[queryIndex]) {
        console.log('No entry for this query; nothing to delete.');
        return;
      }
      if (gt[queryIndex].groundTruth && gt[queryIndex].groundTruth[key]) {
        delete gt[queryIndex].groundTruth[key];
        await writeFile(resolve(process.cwd(), groundTruthFile), JSON.stringify(gt, null, 2), 'utf8');
        console.log(`Deleted ${key} from ${groundTruthFile}`);
      } else {
        console.log(`Key ${key} not found for this query.`);
      }
      return;
    }

    if (action === 'a') {
      const keyDefault = `c${chunkSize}_o${chunkOverlap}`;
      const key = (await rl.question(`Enter config key to write (default: ${keyDefault}): `)).trim() || keyDefault;
      const indicesStr = (await rl.question('Enter comma-separated indices (e.g. 0,2): ')).trim();
      const indices = indicesStr.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
      if (indices.length === 0) {
        console.log('No valid indices provided; aborting.');
        return;
      }
      const confirm = (await rl.question(`Write ${key} -> [${indices.join(',')}] to ${groundTruthFile}? (y/N): `)).trim().toLowerCase();
      if (confirm !== 'y') {
        console.log('Aborted by user.');
        return;
      }
      await writeIndices(groundTruthFile, queryIndex, chunkSize, chunkOverlap, indices, key);
      console.log(`Wrote ${groundTruthFile} [queryIndex=${queryIndex}] ${key} -> [${indices.join(',')}]`);
      return;
    }

    console.log('Unknown action; exiting.');
  } finally {
    rl.close();
  }
}

async function writeIndices(groundTruthFile: string, queryIndex: number, chunkSize: number, chunkOverlap: number, indices: number[], keyOverride?: string) {
  let gt: any[] = [];
  try {
    const raw = await readFile(resolve(process.cwd(), groundTruthFile), 'utf8');
    gt = JSON.parse(raw);
  } catch (err) {
    gt = [];
  }

  if (!gt[queryIndex]) {
    gt[queryIndex] = { query: `query#${queryIndex}`, groundTruth: {} };
  }

  const key = keyOverride ?? `c${chunkSize}_o${chunkOverlap}`;
  gt[queryIndex].groundTruth = gt[queryIndex].groundTruth || {};
  gt[queryIndex].groundTruth[key] = indices;

  await writeFile(resolve(process.cwd(), groundTruthFile), JSON.stringify(gt, null, 2), 'utf8');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

