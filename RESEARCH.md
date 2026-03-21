# Multi-Layer Knowledge Graph Architecture for Domain-Specific LLM Quality Improvement

## Abstract

This document proposes a multi-layer Knowledge Graph (KG) architecture designed to systematically improve LLM output quality in specialized domains. Inspired by the autoresearch loop (Karpathy, 2026) and cognitive apprenticeship models, the system uses structured knowledge graphs to capture error patterns, encode domain reasoning workflows, and enable personalized expert workflows — ultimately replacing brute-force RAG with graph-traversal-based knowledge retrieval.

## Motivation

LLMs in specialized domains (law, medicine, engineering) face recurring quality issues:

1. **Hallucination persistence**: Models repeatedly make the same factual errors across sessions
2. **Reasoning opacity**: Models cite correct sources but apply incorrect reasoning chains
3. **Expert divergence**: Domain experts follow workflows that differ from textbook procedures
4. **Retrieval inefficiency**: RAG systems retrieve chunks by semantic similarity, missing structural relationships

Current solutions (prompt engineering, fine-tuning, RAG) address these problems individually. We propose a unified KG architecture that addresses all four simultaneously.

## Architecture: Four Knowledge Graph Layers

### Layer 1: Error Correction KG

**Purpose**: Capture and prevent recurring LLM errors.

Each node represents either a verified fact or an observed error pattern. Edges encode the relationship between correct and incorrect knowledge.

Key edge semantics:
- `contradicts`: Correct knowledge vs. model's incorrect memory
- `implies`: If error A occurs, error B will also occur (error propagation)
- `causes`: Root cause analysis of why the model makes this error
- `observed_in`: Which scenarios trigger this error

**Mechanism**: An auto-recall hook searches this KG before each LLM invocation, injecting relevant corrections into context. This is more targeted than prompt rules — only relevant corrections are injected based on the user's query.

### Layer 2: Domain Workflow Reasoning Chains

**Purpose**: Encode the correct reasoning process for domain-specific tasks.

Unlike Layer 1 (which stores isolated facts), Layer 2 stores **directed reasoning paths** — the sequence of steps a domain expert follows to solve a problem. The KG is organized into subgraphs, each representing a distinct workflow (e.g., contract review, case analysis, document generation, research, evidence analysis).

Key edge semantics:
- `must_precede`: Step A must be completed before Step B (strict ordering)
- `causes`: Input facts → legal/domain conclusions
- `implies`: If conclusion A holds, conclusion B also applies
- `requires_reading`: Understanding step A requires reading document B

**Mechanism**: When the LLM enters a specific workflow mode, it traverses the corresponding subgraph to determine the next reasoning step, rather than relying on prompt instructions alone.

### Layer 3: Expert Personalization

**Purpose**: Capture individual expert preferences and workflows.

Layer 3 shares the same schema as Layer 2 but contains per-expert knowledge. A lawyer may prefer different case analysis orderings, rely on different legal doctrines, or follow unique workflow patterns.

Key design decisions:
- Layer 3 nodes can `refines` Layer 2 nodes (personalizing the standard workflow)
- Aggregated patterns across multiple experts can feed back to strengthen Layer 2
- Privacy isolation: each expert's KG is stored separately
- Only workflow improvements flow back to Layer 2; personal preferences (writing style, client relationships) remain private

**Feedback loop**:
```
Layer 2 (standard) → provides baseline → Layer 3 (per-expert)
Layer 3 (aggregated patterns) → strengthens → Layer 2 (updated standard)
```

### Layer 4: Citation Graph (Replacing RAG)

**Purpose**: Replace vector-similarity-based RAG with graph-traversal-based retrieval.

In domains with explicit citation structures (law: case citations, medicine: paper citations), the citation graph provides a natural retrieval mechanism:

1. Find an entry node matching the query
2. Traverse citation edges to find related documents (ranked by citation count = authority)
3. Expand along causal edges to find the complete reasoning context
4. Inject only the relevant subgraph into the LLM context

Key edge semantics:
- `causes`: Document A's holding influenced Document B's reasoning
- `refines`: Later document refined earlier document's interpretation
- `contradicts`: Later document overruled earlier document
- `implies`: High citation count implies authoritative source

**Advantage over RAG**: Citation graphs encode **structural authority** (which documents are most relied upon) rather than **semantic similarity** (which chunks look similar to the query). This produces more precise and authoritative retrieval.

## Unified Schema Design

All four layers share a common node and edge schema, enabling cross-layer connections:

### Node Schema
```
id: UUID
type: rule | procedure | observation | insight | core | preference
trust: principle (expert-verified) | pattern (observed) | inference (AI-derived)
name, content, quote (for principles)
metadata: {
  layer: 1-4,
  domain: string,
  ...layer-specific fields
}
stability: FSRS-based memory decay score
memory_level: 1-4 (Benna-Fusi durability cascade)
```

### Edge Schema
10 semantic edge types, each reinterpreted per layer:

| Edge Type | Layer 1 | Layer 2 | Layer 3 | Layer 4 |
|-----------|---------|---------|---------|---------|
| `must_precede` | Prerequisite knowledge | Workflow step ordering | Expert's preferred ordering | Appellate hierarchy |
| `requires_reading` | Fix requires reading source | Step requires input document | Expert requires specific reference | Understanding requires prior case |
| `refines` | Error variant of same mistake | Special case of general rule | Expert personalizes standard step | Later doc refines earlier |
| `contradicts` | Correct ⊗ incorrect knowledge | Conflicting doctrines | Expert disagrees with standard | Overruled precedent |
| `reason_for` | Error observation → fix motivation | Legislative purpose behind rule | Why expert chose this strategy | Statute is basis for holding |
| `causes` | Wrong knowledge → wrong answer | Facts → legal conclusion | Step produces result | Citation influence |
| `implies` | Error A → Error B propagation | Rule A → Rule B also applies | Strategy A → also do B | High citations → authoritative |
| `aligns_to` | Same error category | Consistent with authority | Expert agrees with doctrine | Document applies statute |
| `tends_to` | Model's error tendency | Empirical outcome tendency | Expert's habitual preference | Court's tendency on issue |
| `observed_in` | Error found in scenario X | Reasoning seen in case Y | Learned from engagement Z | Knowledge source marker |

### Database Separation Strategy

- **Layers 1 + 2**: Single database (frequent cross-references, moderate scale)
- **Layer 3**: Separate database per expert (privacy, commercial sensitivity)
- **Layer 4**: Separate database (potentially millions of documents, different update frequency)
- **Cross-layer edges**: Via metadata references (`external_ref: "layer4:node_xxx"`)

## Memory Dynamics

The system inherits the FSRS + Benna-Fusi memory model from the base KG:

- **Layer 1**: Error patterns that are no longer observed (model was fixed) naturally decay and eventually expire
- **Layer 2**: Workflow steps reinforced by expert validation grow stronger; unused steps decay
- **Layer 3**: Expert preferences reinforced by repeated use; one-time observations may decay
- **Layer 4**: Citation counts serve as a natural "memory strength" signal

**Important exception**: Some domain knowledge should NOT decay (e.g., statutory provisions remain valid until explicitly repealed). These are marked as `fundamental` in metadata and assigned high initial stability.

## Evaluation Methodology

Quality improvement is measured through a two-phase evaluation:

1. **Automated benchmark** (fast iteration): Synthetic questions with known correct answers, evaluated by regex and rule matching
2. **Expert verification** (ground truth): Real production conversations verified by a stronger model with tool access (MCP tools for fact-checking against authoritative databases)

The gap between Phase 1 and Phase 2 scores reveals the evaluator's blind spots and drives evaluator improvement — a meta-learning loop.

## Related Work

- **Autoresearch** (Karpathy, 2026): Autonomous experiment loop for ML model improvement
- **FSRS** (Anki): Spaced repetition scheduler based on millions of review records
- **Benna-Fusi synaptic cascade**: Multi-timescale memory consolidation model
- **Stanford Generative Agents**: Three-signal retrieval (recency, importance, relevance)
- **GraphRAG** (Microsoft, 2024): Graph-based retrieval augmented generation
- **CortexGraph**: Dual-component exponential memory decay
- **A-MEM**: Edge data model with relation_type, reasoning, and weight

## Future Directions

1. **Automated causal extraction**: Using stronger models to extract causal chains from verified expert interactions
2. **Cross-domain transfer**: Testing whether the architecture generalizes beyond law to other specialized domains
3. **Real-time expert feedback integration**: Live learning from expert corrections during production use
4. **Citation graph bootstrapping**: Automatically building Layer 4 from document metadata (cited_cases, cited_statutes fields)

## License

This architecture document is released under the same license as the parent repository.
