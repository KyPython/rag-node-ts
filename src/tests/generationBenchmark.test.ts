import { runGenerationBenchmark } from "../scripts/generationBenchmark";
import fs from "fs";

describe('generationBenchmark', () => {
  test('produces expected mock results and CSV', async () => {
    const out = 'dist/scripts/test_generation_benchmark_results.csv';
    const results = await runGenerationBenchmark({ mode: 'mock', queries: 3, out });

    expect(results).toHaveLength(3);

    for (const r of results) {
      expect(r.ttftMs).toBeGreaterThan(0);
      expect(r.totalMs).toBeGreaterThanOrEqual(r.ttftMs);
      expect(r.tokens).toBeGreaterThanOrEqual(0);
    }

    expect(fs.existsSync(out)).toBe(true);

    const csv = fs.readFileSync(out, 'utf8').trim().split(/\r?\n/);
    expect(csv.length).toBe(4); // header + 3 rows
  }, 20000);
});
