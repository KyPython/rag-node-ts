import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { RecursiveCharacterTextSplitter } from '@langchain/classic/text_splitter';

async function main() {
  const file = resolve(process.cwd(), 'samples/compliance/gdpr-data-protection.md');
  const content = await readFile(file, 'utf-8');

  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 100 });
  const chunks = await splitter.splitText(content);

  console.log(`Total chunks: ${chunks.length}`);

  const query = '72 hours';
  const matches = chunks
    .map((c, i) => ({ index: i, text: c }))
    .filter((item) => item.text.toLowerCase().includes(query));

  if (matches.length === 0) {
    console.log(`No chunk contains "${query}"`);
  } else {
    for (const m of matches) {
      console.log(`Found in chunk ${m.index}: \n${m.text.slice(0, 400)}\n---`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
