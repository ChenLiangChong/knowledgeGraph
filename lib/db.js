/**
 * SQLite database initialization — knowledge graph schema
 * Tables: nodes, edges, episodes, episode_steps + FTS5 + sqlite-vec
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '..', 'knowledge.db');

let db = null;

export function getDb() {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Load sqlite-vec extension
  sqliteVec.load(db);

  // Create schema
  db.exec(`
    -- Knowledge nodes
    CREATE TABLE IF NOT EXISTS nodes (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL CHECK(type IN ('rule','procedure','observation','insight','core','preference')),
      trust        TEXT NOT NULL CHECK(trust IN ('principle','pattern','inference')),
      name         TEXT NOT NULL,
      content      TEXT NOT NULL,
      source       TEXT,
      quote        TEXT,
      metadata     TEXT,
      valid_from   TEXT,
      valid_until  TEXT,
      access_count INTEGER DEFAULT 0,
      last_accessed TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    -- Causal edges (A-MEM style: relation_type + reasoning + weight)
    CREATE TABLE IF NOT EXISTS edges (
      id             TEXT PRIMARY KEY,
      source_id      TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target_id      TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      relation_type  TEXT NOT NULL CHECK(relation_type IN (
        'must_precede','causes','implies','aligns_to','contradicts',
        'refines','observed_in','reason_for','tends_to','requires_reading'
      )),
      reasoning      TEXT,
      weight         REAL DEFAULT 1.0,
      source_session TEXT,
      valid_from     TEXT,
      valid_until    TEXT,
      created_at     TEXT NOT NULL
    );

    -- Procedural memory: episodes
    CREATE TABLE IF NOT EXISTS episodes (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL CHECK(type IN ('success','failure','lesson')),
      context    TEXT,
      summary    TEXT NOT NULL,
      outcome    TEXT,
      session_id TEXT,
      created_at TEXT NOT NULL
    );

    -- Episode steps
    CREATE TABLE IF NOT EXISTS episode_steps (
      id         TEXT PRIMARY KEY,
      episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      element    TEXT,
      action     TEXT NOT NULL,
      decision   TEXT,
      reason     TEXT,
      result     TEXT
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
    CREATE INDEX IF NOT EXISTS idx_nodes_trust ON nodes(trust);
    CREATE INDEX IF NOT EXISTS idx_nodes_valid ON nodes(valid_until);
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(relation_type);
    CREATE INDEX IF NOT EXISTS idx_episodes_type ON episodes(type);
    CREATE INDEX IF NOT EXISTS idx_episode_steps_episode ON episode_steps(episode_id);
  `);

  // Migration: add decay columns (safe on existing DBs — ALTER TABLE ADD COLUMN is non-destructive)
  const cols = db.prepare('PRAGMA table_info(nodes)').all().map(c => c.name);
  if (!cols.includes('stability')) {
    db.exec('ALTER TABLE nodes ADD COLUMN stability REAL DEFAULT NULL');
  }
  if (!cols.includes('memory_level')) {
    db.exec('ALTER TABLE nodes ADD COLUMN memory_level INTEGER DEFAULT 1');
  }

  // FTS5 full-text index
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_nodes USING fts5(
      node_id UNINDEXED,
      name,
      content,
      tokenize='unicode61'
    );
  `);

  // sqlite-vec vector index (dimension from env, default 2560 for Qwen3-Embedding-4B)
  // vec0 tables can't use IF NOT EXISTS, check manually
  const embeddingDim = parseInt(process.env.KG_EMBEDDING_DIM || '2560', 10);
  const vecTableExists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='vec_nodes'`
  ).get();

  if (vecTableExists) {
    // Recreate if table is empty (safe dimension change without migration)
    const vecCount = db.prepare('SELECT COUNT(*) as c FROM vec_nodes').get().c;
    if (vecCount === 0) {
      db.exec('DROP TABLE vec_nodes');
      db.exec(`CREATE VIRTUAL TABLE vec_nodes USING vec0(node_id TEXT, embedding float[${embeddingDim}]);`);
    }
  } else {
    db.exec(`
      CREATE VIRTUAL TABLE vec_nodes USING vec0(
        node_id TEXT,
        embedding float[${embeddingDim}]
      );
    `);
  }

  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
