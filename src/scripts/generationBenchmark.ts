import fs from "fs/promises";

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export type GenerationResult = {
  query: string;
  ttftMs: number;
  totalMs: number;
  tokens: number;
};

export async function runGenerationBenchmark(opts?: {
  mode?: "mock" | "real";
  queries?: number;
  out?: string;
}) {
  const mode = opts?.mode ?? "mock";
  const queries = opts?.queries ?? 10;
  const out = opts?.out ?? "dist/scripts/generation_benchmark_results.csv";

  const sampleQueries = [
    "What are the GDPR requirements for data retention?",
    "Summarize the confidentiality clause in the sample agreement.",
    "List steps to remediate a data breach for an SME.",
    "Explain SOX internal control requirements.",
    "What are the landlord obligations in the lease template?",
  ];

  const results: GenerationResult[] = [];

  for (let i = 0; i < queries; i++) {
    const query = sampleQueries[i % sampleQueries.length] ?? "";

    if (mode === "real") {
      throw new Error("Real mode is not implemented in this safe mock runner.");
    }

    const start = process.hrtime.bigint();

    // simulate time-to-first-token (TTFT) uniformly 40-180ms
    const ttftSim = 40 + Math.floor(Math.random() * 140);
    await sleep(ttftSim);
    const ttftMs = Number(process.hrtime.bigint() - start) / 1e6;

    // simulate remaining generation 80-500ms
    const remainder = 80 + Math.floor(Math.random() * 420);
    await sleep(remainder);
    const totalMs = Number(process.hrtime.bigint() - start) / 1e6;

    // tokens generated simulated 20-180
    const tokens = 20 + Math.floor(Math.random() * 160);

    const r: GenerationResult = { query, ttftMs: Math.round(ttftMs), totalMs: Math.round(totalMs), tokens };
    results.push(r);
    // small console-friendly line
    // eslint-disable-next-line no-console
    console.log(`query=${i + 1}/${queries} ttft=${r.ttftMs}ms total=${r.totalMs}ms tokens=${r.tokens}`);
  }

  // write CSV
  const lines = ["query,ttft_ms,total_ms,tokens", ...results.map((r) => {
    return `"${r.query.replace(/"/g, '""')}",${r.ttftMs},${r.totalMs},${r.tokens}`;
  })];

  await fs.mkdir("dist/scripts", { recursive: true });
  await fs.writeFile(out, lines.join("\n"), "utf8");

  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Simple CLI
  const argv = process.argv.slice(2);
  const params: any = {};
  for (const a of argv) {
    if (a.startsWith("--mode=")) params.mode = a.split("=")[1];
    if (a.startsWith("--queries=")) params.queries = Number(a.split("=")[1]);
    if (a.startsWith("--out=")) params.out = a.split("=")[1];
  }

  runGenerationBenchmark(params).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
