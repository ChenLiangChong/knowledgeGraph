

# Knowledge Graph MCP Server

[繁體中文](README.zh-TW.md) | English

Long-term memory system for AI agents. Enables agents to accumulate domain expertise through mentorship or professional practice, automatically recall relevant knowledge, and grow from apprentice to independent expert.

Works with any domain requiring **continuous learning + knowledge evolution**: software engineering, music production, design, medical diagnosis, legal analysis, etc. Any scenario with an "expert teaches → student practices → gradual internalization" knowledge transfer pattern.

## Why This Exists

Claude starts every conversation from zero. In professional apprenticeship-style teaching:

- **Expert lessons are forgotten** — context compaction drops critical lessons, same mistakes repeat
- **AI fabricates terminology** — without ground truth, it over-generalizes from single demonstrations
- **Knowledge can't evolve** — new teachings can't replace contradicted old knowledge
- **Search is path-dependent** — rephrasing a question yields no results
- **Forever a student** — no mechanism for the AI's own discoveries to become durable knowledge

## Installation

```bash
cd mcp/knowledge-graph
npm install
```

On first startup, the Qwen3-Embedding-0.6B ONNX model (~560MB) is automatically downloaded (one-time only).

### MCP Configuration

In your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "knowledge-graph": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/knowledge-graph/main.js"]
    }
  }
}
```

### Hook Configuration

Add hooks to `~/.claude/settings.json` (see [Hooks section](#hooks-automation) for full configuration).

### Import Existing Knowledge (Optional)

```bash
node scripts/import-skills.js <skills-directory>  # Import markdown files as KG nodes
node scripts/backfill-embeddings.js  # Add vector indexes + structural edges
node scripts/backfill-decay.js       # Add stability + memory_level + category
```

---

## Core Design

### Why Build From Scratch

After researching 25+ Claude Code memory systems (Claude-Recall, A-MEM, Mnemon, Graphiti, memsearch, etc.), none simultaneously satisfied:

| Requirement | Existing Solutions | This System |
|-------------|-------------------|-------------|
| Domain-specific edge types | Generic edges only | 10 semantic edge types (must_precede, aligns_to, etc.) |
| Trust level distinction | No source differentiation | principle (expert-taught) > pattern (observed) > inference (AI-guessed) |
| Anti-fabrication | No protection | principle requires expert's exact quote |
| Fundamentals vs creative space | Treated equally | fundamental never decays, creative is challengeable |
| Memory decay + growth path | Decay exists but no growth | FSRS desirable difficulty + Benna-Fusi 4-level cascade |
| Automation | Depends on user action | 6 hooks covering full lifecycle |

### Inspiration Sources

| Source | What We Borrowed |
|--------|-----------------|
| **Claude-Recall** | Hook architecture (search enforcer, correction detector) |
| **A-MEM** | Edge data model (relation_type + reasoning + weight) |
| **CortexGraph** | Two-component decay (fast + slow exponential, more realistic than single decay) |
| **FSRS (Anki)** | Desirable difficulty (fading memories gain MORE stability when recalled) |
| **Benna-Fusi** | Memory cascade (4-level durability, independent of knowledge source) |
| **Stanford Generative Agents** | Three-signal retrieval (recency + importance + relevance) |
| **Graphiti/Zep** | Temporal awareness (valid_from / valid_until) |

---

## Three-Layer Architecture

```
┌──────────────────────────────────────────────────┐
│ Layer 1: Persona (CLAUDE.md)                      │
│ Agent identity + behavioral rules                 │
│ → Loaded every turn for consistent behavior       │
├──────────────────────────────────────────────────┤
│ Layer 2: Memory (Knowledge Graph MCP)             │
│ SQLite + sqlite-vec + FTS5                        │
│ 12 MCP tools + hybrid search                      │
│ → On-demand, doesn't consume context              │
├──────────────────────────────────────────────────┤
│ Layer 3: Automation (Hooks)                       │
│ 6 hooks covering full lifecycle                   │
│ → Expert doesn't need to remind, fully automatic  │
└──────────────────────────────────────────────────┘
```

---

## Memory Decay & Growth System

### Design Philosophy

```
Apprentice phase: Expert's words carry highest weight → learn fundamentals
Growth phase:     Own observations get validated → develop judgment
Expert phase:     Own inferences confirmed by practice → form independent views
```

**Trust is a source label (who said it), not a permanent rank.** AI's own validated knowledge can become equally durable.

### Decay: CortexGraph Two-Component × FSRS Stability

```
R = W_fast × e^(-λ_fast × t) + W_slow × e^(-λ_slow × t)
```

- **Fast decay** (half-life = S days): "newly learned things are easily forgotten"
- **Slow decay** (half-life = S×10 days): "what survives is remembered for a long time"
- **S (stability)**: initialized by trust + category, grows on access via FSRS

Why not pure exponential or pure power-law: pure exponential forgets too fast, pure power-law retains too much. Two-component blend best fits human forgetting data.

| Knowledge Type | Initial S | Fast Half-Life | Slow Half-Life |
|---------------|:---------:|:--------------:|:--------------:|
| Fundamental (has right/wrong) | 365 days | — | — |
| Expert's creative choice | 30 days | 30d | 300d |
| Observed pattern | 7 days | 7d | 70d |
| AI inference | 3 days | 3d | 30d |

### Reinforcement: FSRS Desirable Difficulty

```
stabilityGain = e^(1 - R) × gradeMultiplier
```

Core insight (from FSRS analysis of millions of Anki reviews): **A fading memory that gets recalled gains MORE stability than a fresh one.**

- R = 0.9 (just accessed) → 1.11× growth
- R = 0.3 (almost forgotten) → 2.01× growth

Grade sources:
- 4 = Successfully applied (Auto-Capture detects no correction)
- 3 = Normal access
- 1 = Corrected by expert

### Growth Path: Benna-Fusi Memory Cascade

Trust (source label) stays unchanged; memory_level (durability) grows independently:

| Level | Condition | Auto-expire? |
|:-----:|-----------|:------------:|
| 1 New | Default | ✅ when R < 0.02 |
| 2 Verifying | Accessed across 3+ sessions | ✅ when R < 0.02 |
| 3 Consolidated | 14 days + access ≥ 5 | ❌ Never |
| 4 Core | Fundamental, or access ≥ 50 | ❌ Never |

An inference node accessed 50 times reaches level 4 — as durable as a fundamental principle.

### Fundamentals vs Creative Space

| Type | metadata.category | Behavior |
|------|:-----------------:|----------|
| Fundamental | `"fundamental"` | R = 1.0, never decays. Has right/wrong answers |
| Creative | `"creative"` | Can decay, can be challenged. No right/wrong, only fit |

---

## Search System

### Hybrid Three-in-One Search

```
score = 0.4 × vector + 0.2 × keyword + 0.3 × graph + memoryScore
```

| Layer | Mechanism | Strength |
|-------|-----------|----------|
| Vector | sqlite-vec cosine KNN (Qwen3 1024d) | Same meaning, different words |
| Keyword | FTS5 BM25 (unicode61) | Exact match, multilingual |
| Graph | Recursive CTE, 1-hop expansion | Causal relationships |
| memoryScore | R × 0.1 + levelBonus | More used = more important |

### Embedding Design

- **Model**: Qwen3-Embedding-0.6B (ONNX quantized, ~560MB)
- **Runs locally**: Zero API dependency, works offline
- **Why Qwen3**: #1 on MTEB multilingual leaderboard, #1 on C-MTEB (Chinese)
- **Embeds**: `name + content` (full text) — vector handles semantic matching, keyword handles exact matching, clear separation of concerns

---

## Anti-Fabrication

AI tends to treat its own guesses as facts. Protection rules:

| Rule | Mechanism |
|------|-----------|
| Principle requires quote | No expert's exact words → rejected |
| Inference can't create causal edges | must_precede / reason_for reject inference nodes |
| Trust never auto-upgrades | Inference won't become principle (needs expert confirmation + quote) |
| Level is independent of trust | Inference can consolidate to level 4 but still labeled "AI's idea" |

---

## Tools (12)

### Knowledge Management
| Tool | Purpose |
|------|---------|
| `store_knowledge` | Store a knowledge node. Auto embedding/FTS + suggests edges + initializes decay params |
| `connect_knowledge` | Create a causal edge. Includes anti-fabrication validation |
| `update_knowledge` | Update node in-place. Preserves ID and all edges, auto-updates indexes |
| `forget_knowledge` | Mark as expired. Auto-expires edges + cleans indexes |

### Search
| Tool | Purpose |
|------|---------|
| `search_memory` | Hybrid search (vector + keyword + graph + memoryScore) |
| `traverse_graph` | Walk causal edges (supports direction/depth/edge type filtering) |
| `list_knowledge` | List by filters (trust/type/element/source, sort by time/access/strength) |

### Experience
| Tool | Purpose |
|------|---------|
| `record_experience` | Record workflow trace (steps + decisions + outcomes) |
| `recall_experience` | Find similar past experiences by context |

### Maintenance
| Tool | Purpose |
|------|---------|
| `maintain_graph` | Memory Enzyme — prune / merge / validate / orphan |
| `crystallize_skill` | Check KG-to-skill-file sync status |
| `memory_stats` | Graph statistics |

---

## Hooks (Automation)

### Lifecycle Coverage

```
[New Session]
  └─ session-start → auto-repair + memory decay + consolidation detection + edge review

[User Sends Message]
  └─ auto-recall → query KG → inject relevant knowledge
                 → correction detector → detect corrections

[AI About to Act]
  └─ search-enforcer → block operations without prior memory search (in specific modes)

[AI Finishes Response]
  └─ auto-capture → analyze learning signals → block → main Claude stores via MCP

[Context Compaction]
  └─ post-compact → re-inject core knowledge
```

### settings.json Example

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [{
          "type": "command",
          "command": "node /path/to/hooks/session-start.js",
          "timeout": 10
        }]
      },
      {
        "matcher": "compact",
        "hooks": [{
          "type": "command",
          "command": "node /path/to/hooks/post-compact.js",
          "timeout": 10
        }]
      }
    ],
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "node /path/to/hooks/auto-recall.js",
        "timeout": 10
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "agent",
        "model": "claude-opus-4-6",
        "prompt": "See auto-capture prompt in settings.json",
        "timeout": 60
      }]
    }],
    "PreToolUse": [{
      "hooks": [{
        "type": "command",
        "command": "node /path/to/hooks/search-enforcer.js",
        "timeout": 5
      }]
    }]
  }
}
```

### Auto-Capture Design

Agent hooks cannot call MCP tools. Solution: the agent analyzes the conversation → outputs `<auto-capture>` instructions → blocks the main Claude → main Claude uses MCP tools to store knowledge → Stop fires again → `stop_hook_active=true` → allows stop.

User experience: the main AI naturally "remembers" to save knowledge, seamlessly using MCP tools.

---

## Session-Start Auto-Maintenance

Automatically runs on every new session:

1. **Repair dangling edges** — edges pointing to expired nodes
2. **Clean residual indexes** — FTS5/vec entries for expired nodes
3. **Report orphan nodes** — nodes with no edges (>5 triggers warning)
4. **Memory decay** — R < 0.02 and level < 3 → expire
5. **Decay report** — show nodes with R < 0.3 (actively decaying)
6. **Consolidation detection** — vector similarity < 0.25 node pairs
7. **Weak edge cleanup** — weight < 0.3 → expire
8. **Recent edge review** — edges created in last 24 hours

---

## Data Model

### Nodes

| Field | Description |
|-------|-------------|
| type | rule / procedure / observation / insight / core / preference |
| trust | principle (expert-taught) / pattern (observed) / inference (AI-guessed) |
| stability | FSRS S (days), controls decay speed |
| memory_level | Benna-Fusi level 1-4, controls durability |
| metadata.category | fundamental (has right/wrong) / creative (no right/wrong) |
| source | session ID / "teacher" / "auto-capture" |
| quote | Expert's exact words (required for principle) |

### Edges

| Edge | Meaning |
|------|---------|
| `must_precede` | A must come before B |
| `requires_reading` | Must read B before operating on A |
| `refines` | A refines/extends B |
| `contradicts` | A contradicts B |
| `reason_for` | A is the reason for B |
| `causes` / `implies` / `aligns_to` / `tends_to` / `observed_in` | Other semantic relations |

---

## Security

| Risk | Protection |
|------|-----------|
| SQL injection | Parameterized queries + whitelist validation |
| FTS5 special characters | Sanitize + double-quote wrapping |
| Non-atomic store | Node + FTS wrapped in transaction |
| Invalid ID timeout | try/except returns clear error |
| Stability overflow | Capped at 365 days |
| Single-session level inflation | metadata.sessions tracks cross-session usage |

---

## Integration

### Recommended Skill Structure

Knowledge Graph stores "knowledge"; Skill files define "behavior". They complement each other:

- **KG**: What the expert taught, what was observed, what the AI inferred (storage & retrieval)
- **Skill**: What to do with that knowledge (executable workflows & checklists)

Recommended skill directory structure:

```
skills/
├── <domain>/                    # Domain knowledge (e.g., coding/, design/, medical/)
│   ├── principles.md            # Core principles
│   ├── elements/                # Operation workflows per element/module
│   │   ├── <element>/
│   │   │   └── workflow.md      # Executable tool operation steps
│   │   └── checklist.md         # Element list + dependency graph + standard flow
│   └── evaluation/              # Quality evaluation criteria
├── specialty/                   # Specialty overrides (if applicable)
│   └── <specialty>/
│       └── <domain>/            # Specialty-specific knowledge overrides
├── tools/                       # Tool usage knowledge
│   ├── gotchas/                 # Dangerous operations / pitfalls
│   └── batch/                   # Batch tool reference
└── preflight.md                 # Pre-work required reading checklist
```

### Skill File Writing Principles

```markdown
# Element Name — Tool Operation Workflow

## Related Elements

| Dependency | Reason | Must Read |
|------------|--------|-----------|
| X | Why X is needed | `path/to/x.md` |

## Operation Steps

1. Specific enough to execute directly
2. Include tool call examples (tool_name + parameters)
3. No abstract descriptions ("do it well" → "use tool X to set param Y to Z")

## Quality Criteria

Concrete values or qualitative descriptions the agent can use to judge.
```

**Key**: Skill files must be "executable" — an agent (or subagent) should be able to operate directly after reading, without guessing.

### KG-Skill Synchronization

Use `crystallize_skill` to check if KG contains knowledge not yet reflected in skill files:

```
crystallize_skill(topic="authentication", skill_paths=["skills/coding/elements/auth/workflow.md"])
```

Returns unsynced knowledge list → manually update skill files.

### Pairing With Other MCP Servers

Knowledge Graph is the memory layer. It typically pairs with a **domain-specific MCP** for actual operations:

| Combination | Knowledge Graph Handles | Domain MCP Handles |
|-------------|------------------------|-------------------|
| Software Development | Architecture decisions, code review lessons, bug patterns | IDE / Git / CI operations |
| Design | Design principles, brand guidelines, user feedback | Figma / design tool operations |
| Data Analysis | Analysis methodology, domain knowledge, past analyses | DB / BI tool operations |
| Any Professional Domain | Domain knowledge, workflow experience, expert teaching | Corresponding operation tools |

Knowledge Graph doesn't perform domain operations — it only remembers "how to do it" and "why it's done this way", then automatically recalls relevant knowledge when needed.

### Pairing With Session Readers

Knowledge extraction requires reading historical conversations. Recommended to pair with MCP servers that can read Claude Code CLI or other session transcripts, enabling review of teaching processes and knowledge extraction.

---

## References

### Academic Papers
| Paper | Contribution |
|-------|-------------|
| [FSRS Algorithm](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm) | Power-law forgetting curve + desirable difficulty. 19 ML parameters trained on millions of Anki reviews |
| [MemoryBank (AAAI 2024)](https://arxiv.org/abs/2305.10250) | LLM long-term memory + Ebbinghaus forgetting curve implementation |
| [Benna & Fusi (Nature Neuroscience 2016)](https://www.nature.com/articles/nn.4401) | Synaptic cascade model. Multi-timescale storage, memory lifetime scales linearly with synapse count |
| [Generative Agents (Stanford, UIST 2023)](https://dl.acm.org/doi/fullHtml/10.1145/3586183.3606763) | Recency + importance + relevance three-signal retrieval. Reflection mechanism compresses observations into higher-order insights |
| [Zep: Temporal KG Architecture](https://arxiv.org/abs/2501.13956) | Bi-temporal model (event time + ingestion time). Edge temporal validity intervals |
| [Theories of Synaptic Memory Consolidation](https://arxiv.org/html/2405.16922v1) | Elastic Weight Consolidation + Synaptic Intelligence. Critical parameter protection |
| [Mem0: AI Agent Memory](https://arxiv.org/html/2504.19413v1) | Production-ready agent memory architecture. Graph + vector hybrid |

### Open Source Implementations
| Project | What We Borrowed |
|---------|-----------------|
| [CortexGraph](https://github.com/prefrontal-systems/cortexgraph) | Two-component decay (power-law + exponential blend), consolidation threshold, sub-linear frequency n^0.6 |
| [Claude-Recall](https://github.com/anthropics/claude-recall) | Search enforcer hook, correction detector, skill crystallization |
| [A-MEM](https://github.com/a-mem/a-mem) | Typed edges (relation_type + reasoning + weight), memory enzyme maintenance |
| [Mnemon](https://github.com/mnemon-dev/mnemon) | 4-graph architecture, intent-aware traversal, importance decay + access-count boosting |
| [memsearch (Zilliz)](https://github.com/zilliztech/memsearch) | Standalone memory library extracted from OpenClaw. Hybrid dense+BM25+RRF, SHA-256 dedup |
| [second-brain (jugaad-lab)](https://github.com/jugaad-lab/second-brain) | Category-weighted decay, auto-consolidation (7-day window), entity graph weekly rebuild |
| [Graphiti (Zep)](https://github.com/getzep/graphiti) | Temporal knowledge graph, bi-temporal model, edge invalidation |
| [Hippocampus Memory Skill](https://github.com/openclaw/skills) | Salience formula (0.5×semantic + 0.2×reinforcement + 0.2×recency + 0.1×frequency), 4-tier memory |
| [YourMemory](https://dev.to/sachit_mishra_686a94d1bb5/i-built-memory-decay-for-ai-agents-using-the-ebbinghaus-forgetting-curve-1b0e) | Simplest implementation: `strength = importance × e^(-λ × days) × (1 + recall_count × 0.2)` |

### Cognitive Science
| Concept | Application |
|---------|-------------|
| [Ebbinghaus Forgetting Curve](https://en.wikipedia.org/wiki/Forgetting_curve) | Foundation model for memory strength decaying over time |
| [SM-2 Algorithm (SuperMemo)](https://super-memory.com/english/ol/sm2.htm) | Classic spaced repetition algorithm. EF (easiness factor) + interval growth |
| [Desirable Difficulty](https://en.wikipedia.org/wiki/Desirable_difficulty) | Robert Bjork: appropriate difficulty enhances long-term memory. Core theoretical basis of FSRS |
| Synaptic Tagging and Capture | Synaptic tag + protein synthesis = memory consolidation. Maps to our level promotion mechanism |

---

## Acknowledgments

This system's design integrates wisdom from multiple open-source communities and academic research. Special thanks to:

- **[open-spaced-repetition](https://github.com/open-spaced-repetition)** for the FSRS algorithm, providing a desirable difficulty model validated on millions of data points
- **[prefrontal-systems](https://github.com/prefrontal-systems)** for CortexGraph, whose two-component decay model forms the core of our memory decay engine
- **[Anthropic](https://github.com/anthropics)** for Claude-Recall, whose hook architecture and search enforcer patterns directly inspired our automation layer
- **Stanford HCI Group** for the Generative Agents paper (Park et al., 2023), whose three-signal retrieval and reflection mechanisms influenced our search scoring and consolidation design
- **Benna & Fusi** for their synaptic cascade model published in Nature Neuroscience, providing the neuroscience foundation for our memory level growth path
- **[Zilliz](https://github.com/zilliztech)** (memsearch), **[jugaad-lab](https://github.com/jugaad-lab)** (second-brain), **[Zep](https://github.com/getzep)** (Graphiti), and other open-source projects that each contributed valuable implementation experience

---

## Deployment

### Included in the Repository
- All `lib/`, `tools/`, `hooks/`, `scripts/` source code
- Hook configuration examples

### Generated by User
- `knowledge.db` — automatically created on first startup
- Qwen3 ONNX model — automatically downloaded on first embed
- `node_modules/` — `npm install`

### First-Time Setup
1. `npm install`
2. Configure `.mcp.json` + `~/.claude/settings.json` hooks
3. Start Claude Code → MCP auto-starts → model auto-downloads
4. Begin conversation → hooks auto-run → knowledge auto-accumulates

## License

MIT
