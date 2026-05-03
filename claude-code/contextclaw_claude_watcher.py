#!/usr/bin/env python3
"""ContextClaw Claude Code sidecar watcher — Phase 1 (read-only).

Walks Claude Code session transcripts (~/.claude/projects/-home-yin/*.jsonl by
default), classifies high-bloat items per contextclaw/claude-code/EQUIP_PLAN.md,
estimates token + dollar savings under ContextClaw policy, and appends one
auditable receipt per session to the ledger JSONL.

Phase-1 invariants (HARD):
  * READ-ONLY on transcripts.
  * No secrets in receipts (snippet scrub before write).
  * Every dollar/token figure is labeled estimated.
  * Snippets truncated to 200 chars with [truncated] marker.

Stdlib only. Python 3.8+.
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import math
import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

# ---------- Configuration ----------

DEFAULT_LEDGER = "~/.openclaw/workspace/contextclaw/logs/claude-code-savings-ledger.jsonl"
DEFAULT_GLOB = "~/.claude/projects/-home-yin/*.jsonl"
DEFAULT_MODEL = "claude-opus-4-1"
DEFAULT_INPUT_PRICE_PER_M = 15.0
DEFAULT_KEEP_HEAD_TAIL = 400
SNIPPET_MAX = 200

# Classification thresholds (chars)
THRESH_TOOL_OUTPUT = 10_000
THRESH_FILE_READ = 20_000
THRESH_LOG_BUILD = 8_000
THRESH_REPEAT_FRAGMENT = 2_000  # min size to even consider for repeat dedupe
THRESH_BASE64 = 4_000
THRESH_DOM = 4_000

# Tools whose output we treat as Read-style file dumps
FILE_READ_TOOLS = {"Read", "NotebookRead"}
# Tools whose output we treat as build/log/test dumps
LOG_TOOLS = {"Bash"}

# Secret-pattern denylist (snippet scrub)
SECRET_PATTERNS = [
    r"sk-ant-[A-Za-z0-9_\-]{6,}",
    r"sk-[A-Za-z0-9]{20,}",
    r"OPENAI_API_KEY\s*[:=]",
    r"ANTHROPIC_API_KEY\s*[:=]",
    r"password\s*=",
    r"Bearer\s+[A-Za-z0-9._\-]+",
    r"AWS_SECRET[A-Z_]*\s*[:=]",
    r"aws_secret_access_key",
    r"ghp_[A-Za-z0-9]{20,}",
    r"github_pat_[A-Za-z0-9_]{20,}",
    r"xox[baprs]-[A-Za-z0-9\-]{10,}",
    r"AIza[0-9A-Za-z\-_]{20,}",
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    r"client_secret\s*[:=]",
]
SECRET_RE = re.compile("|".join(SECRET_PATTERNS), re.IGNORECASE)

# Heuristic regexes
DOM_RE = re.compile(r"<(html|body|div|span|head|script|meta)\b", re.IGNORECASE)
BASE64_RE = re.compile(r"[A-Za-z0-9+/=]{200,}")
STACK_LINE_RE = re.compile(
    r"(Traceback \(most recent call last\)|^\s*at [\w$.<>]+ ?\(|^\s*File \".*\", line \d+)",
    re.MULTILINE,
)
LOCK_HINT_RE = re.compile(
    r'("lockfileVersion"|"resolved":\s*"https|"integrity":\s*"sha\d+|^Cargo\.lock|^Pipfile\.lock|^package-lock\.json)',
    re.MULTILINE,
)
ASSISTANT_PLAN_RE = re.compile(
    r"(?im)^\s*(?:#+\s*)?(plan|todos?|next steps|checklist|deliverables)\b"
)


# ---------- Helpers ----------

def utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def expand(p: str) -> str:
    return os.path.abspath(os.path.expanduser(p))


def short_hash(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode("utf-8", errors="ignore"))
        h.update(b"\x1f")
    return h.hexdigest()[:12]


def estimate_tokens(chars: int) -> int:
    return math.ceil(chars / 4) if chars > 0 else 0


def truncate_snippet(s: str) -> str:
    if not s:
        return ""
    flat = s.replace("\n", "\\n").replace("\r", "")
    if len(flat) <= SNIPPET_MAX:
        return flat
    return flat[: SNIPPET_MAX - len("[truncated]")] + "[truncated]"


def scrub_snippet(s: str) -> str:
    if not s:
        return ""
    if SECRET_RE.search(s):
        return "[REDACTED — secret pattern matched]"
    return truncate_snippet(s)


def fingerprint(s: str) -> str:
    """Stable fingerprint used to detect repeated stack/lock dumps within a session."""
    # Normalize whitespace and drop digits to merge near-identical traces.
    norm = re.sub(r"\s+", " ", s)
    norm = re.sub(r"\d+", "0", norm)
    return hashlib.sha1(norm[:4000].encode("utf-8", errors="ignore")).hexdigest()[:16]


# ---------- Extraction ----------

def iter_session_payloads(transcript_path: str) -> Iterable[Dict[str, Any]]:
    """Yield payload dicts found in tool_use / tool_result / assistant text blocks.

    Each payload dict:
      {
        'idx': int,                # transcript line index
        'role': 'tool_use'|'tool_result'|'assistant_text',
        'tool_name': str|None,     # for tool_use / tool_result if known
        'text': str,
      }
    """
    # First pass: build map of tool_use_id -> tool_name (so we can label tool_results).
    tool_name_by_id: Dict[str, str] = {}

    with open(transcript_path, "r", encoding="utf-8", errors="replace") as f:
        for idx, line in enumerate(f):
            line = line.rstrip("\n")
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("type") != "assistant":
                continue
            msg = obj.get("message") or {}
            content = msg.get("content")
            if not isinstance(content, list):
                continue
            for c in content:
                if not isinstance(c, dict):
                    continue
                if c.get("type") == "tool_use":
                    tu_id = c.get("id")
                    name = c.get("name")
                    if isinstance(tu_id, str) and isinstance(name, str):
                        tool_name_by_id[tu_id] = name

    # Second pass: yield payloads.
    with open(transcript_path, "r", encoding="utf-8", errors="replace") as f:
        for idx, line in enumerate(f):
            line = line.rstrip("\n")
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = obj.get("type")
            if t not in ("user", "assistant"):
                continue
            msg = obj.get("message") or {}
            content = msg.get("content")
            if not isinstance(content, list):
                # User content can also be a bare string (initial prompt). Skip; small.
                continue
            for c in content:
                if not isinstance(c, dict):
                    continue
                ctype = c.get("type")
                if ctype == "tool_result":
                    tu_id = c.get("tool_use_id")
                    tool_name = tool_name_by_id.get(tu_id) if isinstance(tu_id, str) else None
                    sub = c.get("content")
                    text = _flatten_tool_result(sub)
                    if text:
                        yield {
                            "idx": idx,
                            "role": "tool_result",
                            "tool_name": tool_name,
                            "text": text,
                        }
                elif ctype == "tool_use":
                    name = c.get("name")
                    inp = c.get("input")
                    txt = json.dumps(inp, ensure_ascii=False) if inp is not None else ""
                    if txt:
                        yield {
                            "idx": idx,
                            "role": "tool_use",
                            "tool_name": name,
                            "text": txt,
                        }
                elif ctype == "text":
                    txt = c.get("text") or ""
                    if txt:
                        yield {
                            "idx": idx,
                            "role": "assistant_text",
                            "tool_name": None,
                            "text": txt,
                        }


def _flatten_tool_result(sub: Any) -> str:
    """tool_result.content can be a string or a list of blocks. Return one string."""
    if sub is None:
        return ""
    if isinstance(sub, str):
        return sub
    if isinstance(sub, list):
        out = []
        for item in sub:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, dict):
                # text block
                txt = item.get("text")
                if isinstance(txt, str):
                    out.append(txt)
                elif item.get("type") == "tool_reference":
                    # tiny — skip from the savings perspective
                    out.append(item.get("tool_name", ""))
                else:
                    out.append(json.dumps(item, ensure_ascii=False))
        return "\n".join(out)
    return json.dumps(sub, ensure_ascii=False)


# ---------- Classification ----------

def classify(payload: Dict[str, Any], seen_fingerprints: Dict[str, int]) -> Optional[str]:
    """Return a bloat-class label or None if the payload is below thresholds."""
    text = payload["text"]
    n = len(text)
    if n == 0:
        return None
    role = payload["role"]
    tool = payload.get("tool_name")

    # tool_use is always small (the command/args). Skip from bloat classification
    # unless the input itself is huge (rare).
    if role == "tool_use" and n < THRESH_TOOL_OUTPUT:
        return None

    # Base64 / binary blob (high precedence — secret-y)
    if n >= THRESH_BASE64:
        m = BASE64_RE.search(text)
        if m and (m.end() - m.start()) >= 1000:
            return "base64_blob"

    # Browser DOM dump
    if n >= THRESH_DOM and DOM_RE.search(text[:4000]):
        return "browser_dom"

    # Stack trace (only flag as repeated if seen 2+ times)
    if STACK_LINE_RE.search(text):
        fp = fingerprint(text)
        seen_fingerprints[("stack", fp)] = seen_fingerprints.get(("stack", fp), 0) + 1
        if seen_fingerprints[("stack", fp)] >= 2 and n >= THRESH_REPEAT_FRAGMENT:
            return "repeated_stack_trace"

    # Lock / config dump (only flag as repeated if seen 2+ times)
    if LOCK_HINT_RE.search(text):
        fp = fingerprint(text)
        seen_fingerprints[("lock", fp)] = seen_fingerprints.get(("lock", fp), 0) + 1
        if seen_fingerprints[("lock", fp)] >= 2 and n >= THRESH_REPEAT_FRAGMENT:
            return "repeated_lock_dump"

    # File read
    if role == "tool_result" and tool in FILE_READ_TOOLS and n > THRESH_FILE_READ:
        return "file_read"

    # Log/build output
    if role == "tool_result" and tool in LOG_TOOLS and n > THRESH_LOG_BUILD:
        return "log_or_build"

    # Generic raw tool output
    if role == "tool_result" and n > THRESH_TOOL_OUTPUT:
        return "tool_output"

    # Stale assistant plan: an assistant text containing a "Plan/TODO/Checklist"
    # header that is followed later by another assistant plan in the same session.
    # (Per-session detection happens in classify_session, not here.)
    if role == "assistant_text" and ASSISTANT_PLAN_RE.search(text) and n >= 1500:
        return "stale_assistant_plan_candidate"

    return None


def classify_session(transcript_path: str) -> Dict[str, Any]:
    items_seen = 0
    items_compactable = 0
    raw_chars = 0
    kept_chars = 0
    by_class: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {"chars_saved": 0, "examples": [], "count": 0}
    )

    seen_fingerprints: Dict[Tuple[str, str], int] = {}
    plan_candidates: List[Dict[str, Any]] = []

    keep_ht = int(os.environ.get("CONTEXTCLAW_KEEP_HEAD_TAIL", DEFAULT_KEEP_HEAD_TAIL))
    # kept stub size = head + tail + small separator
    stub_size = keep_ht * 2 + len("\n[contextclaw: cold-stored, ref=session:line]\n")

    for payload in iter_session_payloads(transcript_path):
        items_seen += 1
        n = len(payload["text"])
        raw_chars += n
        cls = classify(payload, seen_fingerprints)
        if cls == "stale_assistant_plan_candidate":
            plan_candidates.append(payload)
            # Counted as kept-fully for now; resolved below.
            kept_chars += n
            continue
        if cls is None:
            kept_chars += n
            continue
        # We would compact this item.
        items_compactable += 1
        # kept stub is min(n, stub_size) — small items wouldn't shrink
        kept = min(n, stub_size)
        kept_chars += kept
        saved = n - kept
        bucket = by_class[cls]
        bucket["chars_saved"] += saved
        bucket["count"] += 1
        if len(bucket["examples"]) < 3:
            bucket["examples"].append(payload["text"])

    # Resolve stale plan candidates: any plan-candidate that has at least one
    # later plan-candidate in the same session is considered stale.
    if len(plan_candidates) >= 2:
        # All but the LAST plan are stale.
        stale = plan_candidates[:-1]
        bucket = by_class["stale_assistant_plan"]
        for p in stale:
            n = len(p["text"])
            kept = min(n, stub_size)
            saved = n - kept
            # Adjust totals: we previously fully kept it, now we compact.
            kept_chars -= n
            kept_chars += kept
            items_compactable += 1
            bucket["chars_saved"] += saved
            bucket["count"] += 1
            if len(bucket["examples"]) < 3:
                bucket["examples"].append(p["text"])

    return {
        "items_seen": items_seen,
        "items_compactable": items_compactable,
        "raw_chars": raw_chars,
        "kept_chars": kept_chars,
        "by_class": dict(by_class),
    }


# ---------- Receipt assembly ----------

def build_receipt(transcript_path: str, analysis: Dict[str, Any]) -> Dict[str, Any]:
    model = os.environ.get("CONTEXTCLAW_MODEL", DEFAULT_MODEL)
    price = float(os.environ.get("CONTEXTCLAW_INPUT_PRICE_PER_M", DEFAULT_INPUT_PRICE_PER_M))

    raw_chars = analysis["raw_chars"]
    kept_chars = analysis["kept_chars"]
    chars_saved = max(raw_chars - kept_chars, 0)
    raw_tokens = estimate_tokens(raw_chars)
    kept_tokens = estimate_tokens(kept_chars)
    tokens_saved = max(raw_tokens - kept_tokens, 0)
    dollars_saved = round(tokens_saved / 1_000_000.0 * price, 6)

    # Top sources, ordered by chars_saved desc.
    items = []
    for cls, b in analysis["by_class"].items():
        examples_clean = []
        for ex in b["examples"]:
            scrubbed = scrub_snippet(ex)
            if scrubbed:
                examples_clean.append(scrubbed)
        example = examples_clean[0] if examples_clean else ""
        items.append({
            "class": cls,
            "count": b["count"],
            "chars_saved": b["chars_saved"],
            "example": example,
        })
    items.sort(key=lambda x: x["chars_saved"], reverse=True)

    receipt_id = short_hash(transcript_path, str(raw_chars), str(chars_saved))

    receipt = {
        "ts": utcnow_iso(),
        "source": "claude-code",
        "mode": "read_only_estimate",
        "session_path": transcript_path,
        "receipt_id": receipt_id,
        "items_seen": analysis["items_seen"],
        "items_compactable": analysis["items_compactable"],
        "raw_chars": raw_chars,
        "kept_chars": kept_chars,
        "chars_saved": chars_saved,
        "estimated_raw_tokens": raw_tokens,
        "estimated_kept_tokens": kept_tokens,
        "estimated_tokens_saved": tokens_saved,
        "model": model,
        "input_price_per_million": price,
        "estimated_dollars_saved": dollars_saved,
        "estimated_dollars_saved_label": "estimated",
        "top_savings_sources": items,
        "cold_storage_refs": [],
        "notes": (
            "Read-only estimate. Dollar/token figures are estimates under "
            f"chars/4 + ${price}/M model ({model}). No transcripts modified. "
            "Snippets scrubbed for known secret patterns and truncated to 200 chars."
        ),
    }
    return receipt


# ---------- Runner ----------

def append_receipt(ledger_path: str, receipt: Dict[str, Any]) -> None:
    Path(ledger_path).parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(receipt, ensure_ascii=False)
    with open(ledger_path, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def run(transcripts: List[str], ledger_path: str, max_sessions: int = 0,
        verbose: bool = True) -> List[Dict[str, Any]]:
    receipts = []
    for i, path in enumerate(transcripts):
        if max_sessions and i >= max_sessions:
            break
        if verbose:
            print(f"[contextclaw] analyzing {path}", file=sys.stderr)
        t0 = time.time()
        try:
            analysis = classify_session(path)
        except Exception as e:
            print(f"[contextclaw] ERROR analyzing {path}: {e}", file=sys.stderr)
            continue
        receipt = build_receipt(path, analysis)
        append_receipt(ledger_path, receipt)
        receipts.append(receipt)
        dt = time.time() - t0
        if verbose:
            print(
                f"[contextclaw]   items={receipt['items_seen']} "
                f"compactable={receipt['items_compactable']} "
                f"chars_saved={receipt['chars_saved']} "
                f"est_tokens_saved={receipt['estimated_tokens_saved']} "
                f"est_$_saved={receipt['estimated_dollars_saved']} "
                f"({dt:.2f}s)",
                file=sys.stderr,
            )
    return receipts


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(
        description="ContextClaw Claude Code sidecar watcher (Phase 1, read-only)."
    )
    ap.add_argument(
        "--glob",
        default=os.environ.get("CONTEXTCLAW_TRANSCRIPT_GLOB", DEFAULT_GLOB),
        help="Glob for Claude Code transcript JSONL files.",
    )
    ap.add_argument(
        "--ledger",
        default=os.environ.get("CONTEXTCLAW_LEDGER", DEFAULT_LEDGER),
        help="Output ledger JSONL path.",
    )
    ap.add_argument(
        "--max",
        type=int,
        default=int(os.environ.get("CONTEXTCLAW_MAX_SESSIONS", "0")),
        help="Max sessions to process (0 = all).",
    )
    ap.add_argument(
        "--paths",
        nargs="*",
        default=None,
        help="Explicit transcript paths (overrides --glob).",
    )
    ap.add_argument("--quiet", action="store_true", help="Suppress per-session stderr.")
    args = ap.parse_args(argv)

    if args.paths:
        transcripts = [expand(p) for p in args.paths]
    else:
        transcripts = sorted(glob.glob(expand(args.glob)))

    ledger_path = expand(args.ledger)
    if not transcripts:
        print(f"[contextclaw] no transcripts matched: {args.glob}", file=sys.stderr)
        return 2
    receipts = run(transcripts, ledger_path, max_sessions=args.max, verbose=not args.quiet)
    print(
        f"[contextclaw] wrote {len(receipts)} receipt(s) to {ledger_path}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
