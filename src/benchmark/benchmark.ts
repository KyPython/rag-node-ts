#!/usr/bin/env node
/**
 * Benchmark Script for RAG API
 * 
 * Measures API performance with different configurations:
 * - Cache enabled vs disabled
 * - Different concurrency levels
 * - Request latency (average, P95)
 * - Success rate
 * 
 * Usage:
 *   npm run bench -- --url http://localhost:3000 --concurrency 5 --requests 20 --cacheMode on
 * 
 * Performance Analysis:
 * - Cache hits should show dramatically lower latency (10-100x faster)
 * - Helps identify bottlenecks and validate caching effectiveness
 * - Useful for capacity planning and cost estimation
 */

import { performance } from 'perf_hooks';

interface BenchmarkOptions {
  url: string;
  concurrency: number;
  requests: number;
  cacheMode: 'on' | 'off';
  mode?: 'mock' | 'real';
  confirmReal?: boolean;
}

interface RequestResult {
  success: boolean;
  duration: number;
  error?: string;
}

/**
 * Sample queries for benchmarking
 */
const SAMPLE_QUERIES = [
  'What is machine learning?',
  'Explain neural networks',
  'How does deep learning work?',
  'What are the benefits of AI?',
  'Describe natural language processing',
  'What is reinforcement learning?',
  'How do transformers work in NLP?',
  'Explain computer vision',
  'What is transfer learning?',
  'Describe the attention mechanism',
];

/**
 * Parse command line arguments
 */
function parseArgs(): BenchmarkOptions {
  const args = process.argv.slice(2);
  const options: BenchmarkOptions = {
    url: 'http://localhost:3000',
    concurrency: 5,
    requests: 20,
    cacheMode: 'on',
    confirmReal: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    if (arg === '--url' && value) {
      options.url = value;
      i++;
    } else if (arg === '--concurrency' && value) {
      options.concurrency = parseInt(value, 10);
      i++;
    } else if (arg === '--requests' && value) {
      options.requests = parseInt(value, 10);
      i++;
    } else if (arg === '--cacheMode' && value) {
      if (value === 'on' || value === 'off') {
        options.cacheMode = value;
        i++;
      }
    } else if (arg === '--mode' && value) {
      if (value === 'mock' || value === 'real') {
        options.mode = value as any;
        i++;
      }
    } else if (arg === '--confirm-real') {
      options.confirmReal = true;
    } else if (typeof arg === 'string' && arg.startsWith('--mode=')) {
      const v = arg.split('=')[1];
      if (v === 'mock' || v === 'real') options.mode = v as any;
    }
  }

  return options;
}

function printHelp() {
  console.log('\nUsage: node benchmark/benchmark.ts [options]');
  console.log('Options:');
  console.log('  --url <url>            Target server URL (default: http://localhost:3000)');
  console.log('  --concurrency <n>      Number of concurrent requests (default: 5)');
  console.log('  --requests <n>         Total number of requests to send (default: 20)');
  console.log("  --cacheMode on|off     Whether to use cache (default: on)");
  console.log("  --mode mock|real       Run in 'mock' (safe) or 'real' mode (requires ALLOW_REAL_BENCH=1)");
  console.log('  --confirm-real         Required when running with --mode=real to acknowledge real API usage and costs');
  console.log('  --help, -h             Show this help message');
  console.log('');
}

/**
 * Make a single query request
 */
async function makeRequest(
  url: string,
  query: string,
  cacheMode: 'on' | 'off'
): Promise<RequestResult> {
  const startTime = performance.now();
  // Default behavior: real HTTP request. Mock mode will override caller to use simulated requests.
  try {
    const cacheParam = cacheMode === 'on' ? '' : '?cacheMode=off';
    const response = await fetch(`${url}/query${cacheParam}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        topK: 5,
      }),
    });

    const duration = performance.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        duration,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    await response.json();

    return {
      success: true,
      duration,
    };
  } catch (error) {
    const duration = performance.now() - startTime;
    return {
      success: false,
      duration,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Process requests with concurrency limit
 */
async function runBenchmark(options: BenchmarkOptions): Promise<RequestResult[]> {
  const results: RequestResult[] = [];
  const queryPool = [...SAMPLE_QUERIES];
  
  // Generate query list by cycling through sample queries
  const queries: string[] = [];
  for (let i = 0; i < options.requests; i++) {
    queries.push(queryPool[i % queryPool.length]!);
  }

  console.log(`\n🚀 Starting benchmark...`);
  console.log(`   URL: ${options.url}`);
  console.log(`   Requests: ${options.requests}`);
  console.log(`   Concurrency: ${options.concurrency}`);
  console.log(`   Cache Mode: ${options.cacheMode}\n`);
  console.log(`   Mode: ${options.mode ?? 'real'}\n`);

  // Process requests in batches with concurrency limit
  for (let i = 0; i < queries.length; i += options.concurrency) {
    const batch = queries.slice(i, i + options.concurrency);
    const batchPromises = batch.map((query) => {
      if (options.mode === 'mock') {
        // Simulate a request: TTFT 40-180ms, total 120-700ms
        return (async () => {
          const start = performance.now();
          const ttft = 40 + Math.random() * 140;
          await new Promise((r) => setTimeout(r, ttft));
          const remainder = 80 + Math.random() * 580;
          await new Promise((r) => setTimeout(r, remainder));
          const duration = performance.now() - start;
          return { success: true, duration } as RequestResult;
        })();
      }

      return makeRequest(options.url, query, options.cacheMode);
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Progress indicator
    const completed = Math.min(i + options.concurrency, queries.length);
    process.stdout.write(`\r   Progress: ${completed}/${queries.length} requests`);
  }

  console.log('\n'); // New line after progress

  return results;
}

/**
 * Calculate statistics from results
 */
function calculateStats(results: RequestResult[]) {
  const successful = results.filter((r) => r.success);
  const durations = successful.map((r) => r.duration);

  if (durations.length === 0) {
    return {
      successRate: 0,
      avgLatency: 0,
      p95Latency: 0,
      minLatency: 0,
      maxLatency: 0,
      totalRequests: results.length,
      successfulRequests: 0,
      failedRequests: results.length,
    };
  }

  durations.sort((a, b) => a - b);

  const sum = durations.reduce((a, b) => a + b, 0);
  const avg = sum / durations.length;
  const p95Index = Math.floor(durations.length * 0.95);
  const p95 = durations[p95Index] || durations[durations.length - 1] || 0;

  return {
    successRate: (successful.length / results.length) * 100,
    avgLatency: avg,
    p95Latency: p95,
    minLatency: durations[0] || 0,
    maxLatency: durations[durations.length - 1] || 0,
    totalRequests: results.length,
    successfulRequests: successful.length,
    failedRequests: results.length - successful.length,
  };
}

/**
 * Print benchmark results
 */
function printResults(stats: ReturnType<typeof calculateStats>, options: BenchmarkOptions): void {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 BENCHMARK RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Configuration:`);
  console.log(`  URL: ${options.url}`);
  console.log(`  Cache Mode: ${options.cacheMode}`);
  console.log(`  Concurrency: ${options.concurrency}`);
  console.log(`  Total Requests: ${stats.totalRequests}`);
  console.log('');
  console.log(`Performance:`);
  console.log(`  Success Rate: ${stats.successRate.toFixed(2)}%`);
  console.log(`  Successful: ${stats.successfulRequests}`);
  console.log(`  Failed: ${stats.failedRequests}`);
  console.log('');
  console.log(`Latency (ms):`);
  console.log(`  Average: ${stats.avgLatency.toFixed(2)}ms`);
  console.log(`  P95: ${stats.p95Latency.toFixed(2)}ms`);
  console.log(`  Min: ${stats.minLatency.toFixed(2)}ms`);
  console.log(`  Max: ${stats.maxLatency.toFixed(2)}ms`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (stats.failedRequests > 0) {
    console.log('⚠️  Some requests failed. Check server logs for details.\n');
  }
}

/**
 * Main benchmark execution
 */
async function main() {
  const options = parseArgs();

  // Quick help
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // Safety guard: require explicit env var to allow real-mode benchmarking
  if (options.mode === 'real') {
    if (process.env.ALLOW_REAL_BENCH !== '1') {
      console.error("Refusing to run benchmark in 'real' mode. Set ALLOW_REAL_BENCH=1 to opt in.");
      process.exit(2);
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error("Refusing to run benchmark in 'real' mode: missing OPENAI_API_KEY environment variable.");
      console.error("Set OPENAI_API_KEY and retry, or run with --mode=mock for safe testing.");
      process.exit(2);
    }

    if (!options.confirmReal) {
      console.error("Refusing to run benchmark in 'real' mode. Pass --confirm-real to acknowledge real API usage and possible costs.");
      process.exit(2);
    }
  }

  try {
    const results = await runBenchmark(options);
    const stats = calculateStats(results);
    printResults(stats, options);

    // Exit with error code if all requests failed
    if (stats.successfulRequests === 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Benchmark failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();

