#!/usr/bin/env python3
"""ContextClaw Session Analyzer — shows where tokens go in OpenClaw sessions."""
import json, sys, os
from pathlib import Path
from datetime import datetime

SESSIONS_DIR = Path(os.path.expanduser('~/.openclaw/agents/main/sessions'))

def analyze_session(path: Path):
    messages = []
    with open(path) as f:
        for line in f:
            try:
                d = json.loads(line)
                if d.get('type') == 'message':
                    messages.append(d)
            except json.JSONDecodeError:
                continue

    total_in = 0
    total_out = 0
    total_cache_read = 0
    total_cache_write = 0
    total_cost = 0.0
    turns = 0
    roles = {'user': 0, 'assistant': 0, 'toolResult': 0, 'toolCall': 0}
    biggest_inputs = []
    models_used = {}

    for m in messages:
        msg = m.get('message', {})
        role = msg.get('role', 'unknown')
        roles[role] = roles.get(role, 0) + 1
        
        usage = msg.get('usage', {})
        if usage:
            turns += 1
            inp = usage.get('input', 0)
            out = usage.get('output', 0)
            cr = usage.get('cacheRead', 0)
            cw = usage.get('cacheWrite', 0)
            cost = usage.get('cost', {}).get('total', 0)
            
            total_in += inp
            total_out += out
            total_cache_read += cr
            total_cache_write += cw
            total_cost += cost
            
            model = msg.get('model', 'unknown')
            models_used[model] = models_used.get(model, 0) + 1
            
            # Track biggest input turns
            total_tokens = usage.get('totalTokens', inp + out)
            ts = m.get('timestamp', '')
            content_preview = ''
            content = msg.get('content', '')
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get('type') == 'text':
                        content_preview = c.get('text', '')[:80]
                        break
                    elif isinstance(c, dict) and c.get('type') == 'toolCall':
                        content_preview = f"[tool: {c.get('name', 'unknown')}]"
                        break
            elif isinstance(content, str):
                content_preview = content[:80]
            
            biggest_inputs.append((total_tokens, ts, role, content_preview, model))
    
    biggest_inputs.sort(reverse=True)
    
    return {
        'file': path.name,
        'messages': len(messages),
        'turns_with_usage': turns,
        'roles': roles,
        'total_input': total_in,
        'total_output': total_out,
        'cache_read': total_cache_read,
        'cache_write': total_cache_write,
        'total_cost': total_cost,
        'models': models_used,
        'biggest': biggest_inputs[:10],
        'redundancy': total_cache_read / max(total_in + total_cache_read, 1) * 100,
    }

def format_tokens(n):
    if n >= 1_000_000: return f"{n/1_000_000:.1f}M"
    if n >= 1_000: return f"{n/1_000:.1f}K"
    return str(n)

def main():
    target = sys.argv[1] if len(sys.argv) > 1 else 'current'
    
    if target == 'all':
        files = sorted(SESSIONS_DIR.glob('*.jsonl'), key=lambda p: p.stat().st_mtime, reverse=True)[:10]
    elif target == 'current':
        files = sorted(SESSIONS_DIR.glob('*.jsonl'), key=lambda p: p.stat().st_mtime, reverse=True)[:1]
    else:
        files = [SESSIONS_DIR / target]
    
    for f in files:
        if not f.exists():
            print(f"Not found: {f}")
            continue
        
        r = analyze_session(f)
        size_kb = f.stat().st_size / 1024
        
        print(f"\n{'='*60}")
        print(f"Session: {r['file']} ({size_kb:.0f}KB)")
        print(f"{'='*60}")
        print(f"Messages: {r['messages']} | Turns w/ usage: {r['turns_with_usage']}")
        print(f"Roles: {r['roles']}")
        print(f"")
        print(f"Token Usage:")
        print(f"  Input:       {format_tokens(r['total_input'])}")
        print(f"  Output:      {format_tokens(r['total_output'])}")
        print(f"  Cache Read:  {format_tokens(r['cache_read'])}")
        print(f"  Cache Write: {format_tokens(r['cache_write'])}")
        print(f"  Redundancy:  {r['redundancy']:.1f}% (tokens served from cache)")
        print(f"  Cost:        ${r['total_cost']:.4f}")
        print(f"")
        print(f"Models: {r['models']}")
        print(f"")
        print(f"Top 10 Heaviest Turns:")
        print(f"  {'Tokens':>8}  {'Role':>10}  {'Model':>20}  Preview")
        print(f"  {'-'*8}  {'-'*10}  {'-'*20}  {'-'*30}")
        for tokens, ts, role, preview, model in r['biggest']:
            short_model = model.split('/')[-1][:20] if '/' in model else model[:20]
            print(f"  {format_tokens(tokens):>8}  {role:>10}  {short_model:>20}  {preview[:40]}")

if __name__ == '__main__':
    main()
