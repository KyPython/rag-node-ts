import { readFile } from 'fs/promises';

type RenderedPrompts = {
  systemPrompt: string;
  userPrompt: string;
};

let cachedTemplate: string | null = null;

async function loadTemplate(path = 'src/prompts/rag_grounded_v2.txt'): Promise<string> {
  if (cachedTemplate) return cachedTemplate;
  const raw = await readFile(path, 'utf-8');
  cachedTemplate = raw;
  return raw;
}

function extractSections(template: string): { system: string; developer: string; user: string } {
  // Split by top-level section headers: 'System', 'Developer', 'User'
  const systemIndex = template.indexOf('\nDeveloper');
  const developerIndex = template.indexOf('\nUser');

  const system = template.slice(0, systemIndex).replace(/^System\s*/i, '').trim();
  const developer = template.slice(systemIndex + '\nDeveloper'.length, developerIndex).trim();
  const user = template.slice(developerIndex + '\nUser'.length).trim();

  return { system, developer, user };
}

export async function renderRagPrompts(contexts: string[], question: string): Promise<RenderedPrompts> {
  const template = await loadTemplate();
  const { system, developer, user } = extractSections(template);

  const systemPrompt = [system, developer].filter(Boolean).join('\n\n');

  const retrievedContext = contexts.join('\n\n');

  const userBlock = user.replace('{{retrieved_context}}', retrievedContext).replace('{{user_question}}', question);

  return { systemPrompt, userPrompt: userBlock };
}

export default { renderRagPrompts };
