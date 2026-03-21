/**
 * Knowledge Graph MCP Server
 * SQLite + sqlite-vec + FTS5 hybrid search for arrangement knowledge.
 *
 * 9 tools:
 *   store_knowledge, connect_knowledge, search_memory, traverse_graph,
 *   record_experience, recall_experience, forget_knowledge, maintain_graph, memory_stats
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerKnowledgeTools } from './tools/knowledge-tools.js';
import { registerSearchTools } from './tools/search-tools.js';
import { registerEpisodeTools } from './tools/episode-tools.js';
import { registerMaintenanceTools } from './tools/maintenance-tools.js';
import { getDb, closeDb } from './lib/db.js';

// Initialize database on startup
try {
  getDb();
} catch (e) {
  console.error('[knowledge-graph] Database initialization failed:', e.message);
  process.exit(1);
}

// Check embedding server in background (non-blocking)
import('./lib/embeddings.js').then(async (mod) => {
  try {
    await mod.checkServer();
    console.error(`[knowledge-graph] Embedding server ready (dim=${mod.getDimension()})`);
  } catch (e) {
    console.error('[knowledge-graph] Embedding server not available:', e.message);
    console.error('[knowledge-graph] Falling back to FTS5 + graph search only');
  }
});

const server = new McpServer({
  name: 'knowledge-graph',
  version: '1.0.0',
  description: 'Knowledge Graph — hybrid search for arrangement knowledge'
});

// Register all tools
registerKnowledgeTools(server);
registerSearchTools(server);
registerEpisodeTools(server);
registerMaintenanceTools(server);

// Graceful shutdown
process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[knowledge-graph] MCP server started');
