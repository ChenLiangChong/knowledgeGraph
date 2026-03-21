/**
 * Embedding pipeline via external llama.cpp server (OpenAI-compatible API).
 * Supports any GGUF embedding model served by llama-server --embedding.
 * Falls back gracefully when server is unavailable (FTS5 + graph only).
 * LRU cache to avoid recomputation.
 */

const EMBEDDING_URL = process.env.KG_EMBEDDING_URL || 'http://localhost:11434/v1/embeddings';
const EMBEDDING_DIM = parseInt(process.env.KG_EMBEDDING_DIM || '2560', 10);
const EMBEDDING_MODEL = process.env.KG_EMBEDDING_MODEL || 'qwen3-embedding:4b';
const TIMEOUT_MS = parseInt(process.env.KG_EMBEDDING_TIMEOUT || '30000', 10);
const CACHE_SIZE = 256;
const HEALTH_CHECK_INTERVAL_MS = 60000;

let serverAvailable = null; // null = untested, true/false
let lastHealthCheck = 0;

// Simple LRU cache
class LRUCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) this.cache.delete(key);
    if (this.cache.size >= this.maxSize) {
      // Delete oldest (first entry)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
}

const embeddingCache = new LRUCache(CACHE_SIZE);

/**
 * Check if the embedding server is reachable.
 * Updates serverAvailable state.
 */
async function healthCheck() {
  try {
    const res = await fetch(EMBEDDING_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: 'health check', encoding_format: 'float' }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const body = await res.json();
      if (body?.data?.[0]?.embedding) {
        serverAvailable = true;
        lastHealthCheck = Date.now();
        return true;
      }
    }
    serverAvailable = false;
  } catch {
    serverAvailable = false;
  }
  lastHealthCheck = Date.now();
  return false;
}

/**
 * Generate embedding for a single text string.
 * Returns Float32Array of length EMBEDDING_DIM.
 */
export async function embed(text, { instruct = '' } = {}) {
  const inputText = instruct
    ? `Instruct: ${instruct}\nQuery: ${text}`
    : text;

  const cached = embeddingCache.get(inputText);
  if (cached) return cached;

  // Check server availability (with periodic re-check)
  if (serverAvailable === null || (serverAvailable === false && Date.now() - lastHealthCheck > HEALTH_CHECK_INTERVAL_MS)) {
    await healthCheck();
  }
  if (!serverAvailable) {
    throw new Error('Embedding server not available');
  }

  const res = await fetch(EMBEDDING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputText, encoding_format: 'float' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Embedding server returned ${res.status}: ${errText.substring(0, 200)}`);
  }

  const body = await res.json();
  if (!body?.data?.[0]?.embedding) {
    throw new Error(`Unexpected response format: ${JSON.stringify(body).substring(0, 200)}`);
  }

  const raw = body.data[0].embedding;
  const embedding = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) embedding[i] = raw[i];

  // L2 normalize (idempotent — safe even if server already normalized)
  let norm = 0;
  for (let j = 0; j < embedding.length; j++) norm += embedding[j] * embedding[j];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let j = 0; j < embedding.length; j++) embedding[j] /= norm;
  }

  embeddingCache.set(inputText, embedding);
  return embedding;
}

/**
 * Check if embedding server is available and ready.
 */
export function isReady() {
  return serverAvailable === true;
}

/**
 * Get embedding dimension.
 */
export function getDimension() {
  return EMBEDDING_DIM;
}

/**
 * Probe the embedding server. Call on startup to verify connectivity.
 */
export async function checkServer() {
  const ok = await healthCheck();
  if (!ok) {
    throw new Error(`Cannot reach embedding server at ${EMBEDDING_URL}`);
  }
}
