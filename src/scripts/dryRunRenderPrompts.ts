#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config();

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { renderRagPrompts } from '../utils/promptLoader.js';

async function main() {
  const samplePath = resolve(process.cwd(), 'samples', 'compliance', 'gdpr-data-protection.md');
  const content = await readFile(samplePath, 'utf-8');

  // Simple paragraph-based contexts (stand-in for retrieval)
  const paragraphs = content.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const contexts = paragraphs.slice(0, 6).map(p => p.replace(/\n/g, ' '));

  const question = 'Under GDPR, how long does the controller have to notify authorities?';

  const { systemPrompt, userPrompt } = await renderRagPrompts(contexts, question);

  console.log('----- SYSTEM PROMPT -----\n');
  console.log(systemPrompt);
  console.log('\n----- USER PROMPT -----\n');
  console.log(userPrompt);
}

main().catch((err) => {
  console.error('Dry run failed:', err);
  process.exit(1);
});
