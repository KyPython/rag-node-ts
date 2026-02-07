import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { RecursiveCharacterTextSplitter } from '@langchain/classic/text_splitter';

async function main() {
  const file = resolve(process.cwd(), 'samples/compliance/gdpr-data-protection.md');
  const content = await readFile(file, 'utf-8');

  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 100 });
  const chunks = await splitter.splitText(content);

  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i] || '';
    console.log(`--- Chunk ${i} ---\n${text.slice(0, 400).replace(/\n/g, '\\n')}\n`);
  }
  console.log(`Total chunks: ${chunks.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
