# ContextClaw Multi-Agent Shared Context Protocol

## RFC Status: DRAFT
## Author: dodge1218
## Date: 2026-04-07

## Abstract

This document proposes a protocol for managing context across multiple AI agents sharing a workspace. While single-agent context management (classification + eviction + cold storage) is solved by ContextClaw v1, the multi-agent case introduces new challenges: duplicated context across agents, stale cross-agent references, and the absence of a structured communication channel that doesn't waste tokens.

## Problem

Given N agents each with a context window of W tokens:

**Naive approach**: Each agent loads the full workspace context independently.
- Total tokens: N × W
- Duplication: ~60-80% of context is identical across agents (workspace files, system prompt, tool definitions)
- No awareness of what other agents know or have done

**Current approach** (OpenClaw subagents): Parent agent describes task in natural language. Child agent starts fresh, re-reads everything it needs.
- Total tokens: Parent W + Child (task description + file reads)
- Better, but child has zero benefit from parent's cached context
- Results communicated via files (good) but no structured protocol for "what do you already know?"

## Proposed Architecture

### Layer 1: Shared Context Registry

A lightweight JSON file (`/.contextclaw/registry.json`) that tracks what each agent has in context:

```json
{
  "agents": {
    "main": {
      "sessionId": "abc123",
      "contextSnapshot": {
        "files": ["src/budget.ts@sha256:abc", "README.md@sha256:def"],
        "lastUserTurn": 42,
        "hotTopics": ["eval pipeline", "test fixes"],
        "tokensUsed": 91000,
        "tokensAvailable": 59000
      }
    },
    "builder-1": {
      "sessionId": "def456",
      "contextSnapshot": {
        "files": ["src/circuit-breaker.ts@sha256:ghi"],
        "lastUserTurn": 0,
        "hotTopics": ["circuit breaker implementation"],
        "tokensUsed": 14000,
        "tokensAvailable": 136000
      }
    }
  }
}
```

### Layer 2: Context-Aware Task Delegation

When spawning a subagent, ContextClaw annotates the task with:
1. **What the parent already knows** (so the child doesn't re-read it)
2. **What files have changed since parent last read them** (so the child reads fresh versions)
3. **What decisions have been made** (so the child doesn't contradict them)

```
Task: Fix budget.ts tests
Context handoff:
  - budget.ts was read 3 turns ago (sha256:abc, 88 lines)
  - Decision: using tiktoken cl100k_base encoder (turn 12)
  - Decision: ContextBudget class replaces BudgetPlugin (turn 15)
  - Changed since parent read: circuit-breaker.ts (new implementation)
```

### Layer 3: Structured Q&A Channel

Instead of agents writing free-form files, a structured message bus:

```json
// Agent 1 → Shared State
{
  "from": "main",
  "type": "question",
  "topic": "circuit-breaker",
  "question": "Does the cooldown reset on successful retry?",
  "contextNeeded": "circuit-breaker.ts lines 40-58"
}

// Agent 2 → Shared State
{
  "from": "builder-1",
  "type": "answer",
  "topic": "circuit-breaker",
  "answer": "Yes, cooldown resets when failureCount is set to 0 in isOpen()",
  "evidence": "circuit-breaker.ts:49-52"
}
```

**Token cost of this exchange**: ~200 tokens total
**Token cost of Agent 1 re-reading the file**: ~500 tokens + context pollution

### Layer 4: Cross-Agent Eviction Coordination

When Agent 1 evicts a context block, it notifies the registry. If Agent 2 still has it cached, questions about that content get routed to Agent 2 instead of re-reading from disk.

## Token Economics

| Scenario | Single Agent | Multi-Agent (Naive) | Multi-Agent + ContextClaw |
|----------|-------------|--------------------|-----------------------|
| 2 agents, 50K shared context | 150K | 300K | 170K |
| Same with caching | 55K effective | 110K effective | 55K effective |
| 5 agents, 50K shared | 150K (can't fit) | 750K | 300K |
| 10 agents, project-scale | Impossible | 1.5M | 400K |

The savings scale superlinearly with agent count because shared context is read once and referenced via registry.

## Implementation Plan

### Phase 1 (v1.1): Registry file + context snapshots
- Each ContextClaw instance writes its context state to registry
- Read-only coordination (no active routing yet)
- ~200 lines of code

### Phase 2 (v1.2): Context-aware delegation
- Annotate subagent tasks with parent context state
- Skip redundant file reads
- ~400 lines of code

### Phase 3 (v2.0): Active cross-agent routing
- Q&A channel via structured messages
- Cross-agent eviction coordination
- Requires OpenClaw sessions_send integration
- ~800 lines of code

## Why This Matters for Anthropic

Claude's prompt caching handles the easy case (static prefixes). ContextClaw handles the hard case (dynamic mid-conversation content across multiple agents). Together, they make Claude the most token-efficient platform for multi-agent workloads.

This isn't competing with Anthropic's caching — it's making Claude agents dramatically cheaper and more capable than any other provider's multi-agent setup.
