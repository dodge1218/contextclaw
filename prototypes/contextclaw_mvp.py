#!/usr/bin/env python3
"""ContextClaw MVP: mission ledger, artifact store, pass budget governor, CLI."""
from __future__ import annotations
import argparse, datetime as dt, hashlib, json, os, sqlite3, sys, uuid
from pathlib import Path

DB = Path(os.environ.get('CONTEXTCLAW_DB', '.contextclaw/contextclaw.db'))
STORE = Path(os.environ.get('CONTEXTCLAW_STORE', '.contextclaw/artifacts'))
DEFAULT_RATE_PER_1K = float(os.environ.get('CONTEXTCLAW_RATE_PER_1K', '0.002'))


def now(): return dt.datetime.now(dt.timezone.utc).isoformat()
def uid(prefix): return f"{prefix}_{uuid.uuid4().hex[:12]}"
def sha(s: bytes) -> str: return hashlib.sha256(s).hexdigest()
def estimate_tokens(text: str) -> int: return max(1, (len(text) + 3) // 4)
def cost(tokens_in: int, tokens_out: int, rate: float = DEFAULT_RATE_PER_1K) -> float: return (tokens_in + tokens_out) / 1000 * rate

def con():
    DB.parent.mkdir(parents=True, exist_ok=True); STORE.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row; init(c); return c

def has_col(c, table, col):
    return any(r['name'] == col for r in c.execute(f'pragma table_info({table})'))

def add_col(c, table, col, ddl):
    if not has_col(c, table, col): c.execute(f'alter table {table} add column {ddl}')

def init(c):
    c.executescript('''
    create table if not exists missions(
      id text primary key, objective text not null, owner text default 'local',
      budget_total real not null, budget_remaining real not null,
      state text not null, acceptance_criteria text, created_at text not null, updated_at text not null);
    create table if not exists artifacts(
      id text primary key, mission_id text, type text not null, content_hash text not null,
      source text, sensitivity text default 'normal', summary text, path text not null, tokens integer not null, created_at text not null,
      unique(mission_id, content_hash));
    create table if not exists passes(
      id text primary key, mission_id text not null, role text not null, model text not null,
      input_artifact_ids text not null, prompt_template_hash text not null, assembled_context_hash text not null,
      estimated_tokens_in integer not null, estimated_tokens_out integer not null, estimated_cost real not null,
      observed_tokens_in integer, observed_tokens_out integer, observed_cost real,
      max_spend real not null, decision text not null, reason text, output_artifact_id text,
      manifest text not null, created_at text not null);
    create table if not exists approvals(id text primary key, mission_id text not null, pass_id text, scope text not null, amount real, created_at text not null, used_at text);
    ''')
    add_col(c, 'missions', 'sticker', "sticker text default ''")
    add_col(c, 'artifacts', 'sticker', "sticker text default ''")
    add_col(c, 'passes', 'sticker', "sticker text default ''")
    c.commit()

def must_mission(c, mid):
    r = c.execute('select * from missions where id=?', (mid,)).fetchone()
    if not r: raise SystemExit(f'No mission: {mid}')
    return r

def rowdict(r): return {k:r[k] for k in r.keys()}

def latest_pass(c, mission, pass_id='last', decision=None):
    if pass_id != 'last':
        q='select * from passes where id=?'; params=[pass_id]
        if mission: q+=' and mission_id=?'; params.append(mission)
        return c.execute(q, params).fetchone()
    q='select * from passes where mission_id=?'; params=[mission]
    if decision: q+=' and decision=?'; params.append(decision)
    q+=' order by created_at desc limit 1'
    return c.execute(q, params).fetchone()

def cmd_mission(args):
    c=con(); mid=args.id or uid('mis'); t=now()
    c.execute('insert into missions(id,objective,owner,budget_total,budget_remaining,state,acceptance_criteria,created_at,updated_at,sticker) values(?,?,?,?,?,?,?,?,?,?)',(mid,args.objective,args.owner,args.budget,args.budget,'planned',args.acceptance,t,t,args.sticker)); c.commit()
    print(mid)

def cmd_artifact(args):
    c=con(); must_mission(c,args.mission)
    data = Path(args.file).read_bytes() if args.file else sys.stdin.buffer.read()
    h=sha(data)
    existing=c.execute('select id from artifacts where mission_id=? and content_hash=?',(args.mission,h)).fetchone()
    if existing:
        print(f"deduped {existing['id']}"); return
    aid=args.id or 'art_'+h[:12]
    if c.execute('select id from artifacts where id=?',(aid,)).fetchone():
        aid=f'art_{args.mission[:8]}_{h[:12]}'
    path=STORE/f'{aid}.txt'
    path.write_bytes(data); text=data.decode('utf-8','ignore'); toks=estimate_tokens(text)
    summary=args.summary or text[:240].replace('\n',' ')
    c.execute('insert into artifacts(id,mission_id,type,content_hash,source,sensitivity,summary,path,tokens,created_at,sticker) values(?,?,?,?,?,?,?,?,?,?,?)',(aid,args.mission,args.type,h,args.source,args.sensitivity,summary,str(path),toks,now(),args.sticker)); c.commit(); print(aid)

def selected_artifacts(c, mission, ids):
    if ids == ['all']:
        return c.execute('select * from artifacts where mission_id=? order by created_at',(mission,)).fetchall()
    qs=','.join('?'*len(ids)); return c.execute(f'select * from artifacts where mission_id=? and id in ({qs})',[mission,*ids]).fetchall()

def cmd_plan_pass(args):
    c=con(); m=must_mission(c,args.mission); arts=selected_artifacts(c,args.mission,args.artifacts)
    if not arts: raise SystemExit('No artifacts selected')
    seen=set(); chunks=[]; manifest=[]
    for a in arts:
        if a['content_hash'] in seen: continue
        seen.add(a['content_hash']); txt=Path(a['path']).read_text(errors='ignore')
        chunks.append(f"# Artifact {a['id']} ({a['type']}, sticker={a['sticker'] or 'none'})\nSummary: {a['summary']}\n\n{txt}")
        manifest.append({'id':a['id'],'sticker':a['sticker'],'hash':a['content_hash'],'tokens':a['tokens'],'summary':a['summary']})
    assembled='\n\n'.join(chunks); tin=estimate_tokens(assembled)+estimate_tokens(args.prompt); tout=args.output_tokens; est=cost(tin,tout)
    reason=None; decision='allowed'
    if est > args.max_spend: decision,reason='blocked','pass budget exceeded'
    if est > m['budget_remaining']: decision,reason='blocked','mission budget exceeded'
    pid=uid('pass')
    man={'prompt':args.prompt,'mission_sticker':m['sticker'],'pass_sticker':args.sticker,'artifacts':manifest,'estimated_context_tokens':tin,'estimated_output_tokens':tout,'estimated_cost':est,'max_spend':args.max_spend,'budget_remaining_before':m['budget_remaining']}
    c.execute('insert into passes(id,mission_id,role,model,input_artifact_ids,prompt_template_hash,assembled_context_hash,estimated_tokens_in,estimated_tokens_out,estimated_cost,observed_tokens_in,observed_tokens_out,observed_cost,max_spend,decision,reason,output_artifact_id,manifest,created_at,sticker) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(pid,args.mission,args.role,args.model,json.dumps([x['id'] for x in arts]),sha(args.prompt.encode()),sha(assembled.encode()),tin,tout,est,None,None,None,args.max_spend,decision,reason,None,json.dumps(man,indent=2),now(),args.sticker))
    if decision=='allowed':
        c.execute('update missions set budget_remaining=?, state=?, updated_at=? where id=?',(m['budget_remaining']-est,'running',now(),args.mission))
    else:
        c.execute('update missions set state=?, updated_at=? where id=?',('waiting_approval',now(),args.mission))
    c.commit(); print(json.dumps({'pass_id':pid,'decision':decision,'reason':reason,'estimated_cost':round(est,6),'tokens_in':tin,'sticker':args.sticker},indent=2))

def cmd_status(args):
    c=con(); m=must_mission(c,args.mission); pc=c.execute('select count(*) n from passes where mission_id=?',(args.mission,)).fetchone()['n']; ac=c.execute('select count(*) n from artifacts where mission_id=?',(args.mission,)).fetchone()['n']
    print(json.dumps(rowdict(m) | {'artifacts':ac,'passes':pc},indent=2))

def cmd_inspect(args):
    c=con(); p=latest_pass(c,args.mission,args.pass_id)
    if not p: raise SystemExit('No pass found')
    d=rowdict(p); d['manifest']=json.loads(d['manifest']); print(json.dumps(d,indent=2))

def why_text(m, p):
    man=json.loads(p['manifest'])
    lines=[f"Pass {p['id']} is {p['decision']} for mission {m['id']} ({m['sticker'] or 'no-sticker'})."]
    if p['decision']=='blocked':
        lines.append(f"Reason: {p['reason']}.")
        lines.append(f"Estimated spend ${p['estimated_cost']:.6f}; pass max ${p['max_spend']:.6f}; mission remaining before pass ${man.get('budget_remaining_before', m['budget_remaining']):.6f}.")
        lines.append(f"Estimated tokens: {p['estimated_tokens_in']} in, {p['estimated_tokens_out']} out.")
        lines.append('Next action: approve once with budget increase, reduce artifacts/output tokens, or keep mission waiting.')
    else:
        lines.append(f"Estimated spend ${p['estimated_cost']:.6f} was allowed under pass and mission budgets.")
        lines.append('Next action: run/record the model output, or plan the next bounded pass.')
    arts=man.get('artifacts',[])
    if arts:
        lines.append('Included artifacts:')
        for a in arts: lines.append(f"- {a['id']} [{a.get('sticker') or 'no-sticker'}], ~{a['tokens']} tokens, {a['summary'][:100]}")
    return '\n'.join(lines)

def cmd_why(args):
    c=con(); m=must_mission(c,args.mission); p=latest_pass(c,args.mission,args.pass_id,decision='blocked' if args.blocked else None)
    if not p: raise SystemExit('No matching pass found')
    print(why_text(m,p))

def review_card(m, p):
    man=json.loads(p['manifest']); arts=man.get('artifacts',[])
    next_action = 'Approve once, reduce scope, or keep waiting' if p['decision']=='blocked' else 'Ready for model/tool execution or next pass'
    return '\n'.join([
        f"## {m['objective']}",
        f"Mission: `{m['id']}` | Sticker: `{m['sticker'] or 'none'}` | State: **{m['state']}**",
        f"Pass: `{p['id']}` | Role: `{p['role']}` | Model: `{p['model']}` | Decision: **{p['decision']}**",
        f"Spend: estimated `${p['estimated_cost']:.6f}` | pass max `${p['max_spend']:.6f}` | mission remaining `${m['budget_remaining']:.6f}`",
        f"Tokens: {p['estimated_tokens_in']} in / {p['estimated_tokens_out']} out",
        f"Reason: {p['reason'] or 'within budget'}",
        '',
        'Artifacts:',
        *(f"- `{a['id']}` [{a.get('sticker') or 'no-sticker'}], ~{a['tokens']} tokens: {a['summary'][:120]}" for a in arts),
        '',
        f"Next action: **{next_action}**",
    ])

def cmd_review_feed(args):
    c=con(); m=must_mission(c,args.mission)
    passes=c.execute('select * from passes where mission_id=? order by created_at desc limit ?',(args.mission,args.limit)).fetchall()
    if args.format=='json':
        out=[]
        for p in passes:
            out.append({'mission':rowdict(m),'pass':rowdict(p),'manifest':json.loads(p['manifest']),'next_action':'Approve/reduce scope' if p['decision']=='blocked' else 'Ready/continue'})
        print(json.dumps(out,indent=2)); return
    print('\n\n---\n\n'.join(review_card(m,p) for p in passes))

def cmd_approve(args):
    c=con(); m=must_mission(c,args.mission); p=c.execute('select * from passes where id=? and mission_id=?',(args.pass_id,args.mission)).fetchone()
    if not p: raise SystemExit('No pass found')
    if p['decision']!='blocked': raise SystemExit('Pass is not blocked')
    if p['estimated_cost'] > m['budget_remaining'] and not args.increase_budget: raise SystemExit('Approval needs --increase-budget for mission budget overrun')
    remaining=m['budget_remaining'] + args.increase_budget - p['estimated_cost']
    c.execute('update passes set decision=?, reason=? where id=?',('approved','manual approve once',args.pass_id))
    c.execute('update missions set budget_remaining=?, budget_total=?, state=?, updated_at=? where id=?',(remaining,m['budget_total']+args.increase_budget,'running',now(),args.mission)); c.commit(); print('approved')

def cmd_state(args):
    c=con(); must_mission(c,args.mission); c.execute('update missions set state=?, updated_at=? where id=?',(args.state,now(),args.mission)); c.commit(); print(args.state)

def cmd_dogfood(args):
    c=con(); mid=args.mission or 'mis_contextclaw_mvp'
    existing=c.execute('select id from missions where id=?',(mid,)).fetchone()
    if not existing:
        t=now(); c.execute('insert into missions(id,objective,owner,budget_total,budget_remaining,state,acceptance_criteria,created_at,updated_at,sticker) values(?,?,?,?,?,?,?,?,?,?)',(mid,'ContextClaw MVP before security research','local',args.budget,args.budget,'planned','Dogfood ledger/governor/review-feed loop before returning to security research',t,t,'CC-MVP'))
        c.commit()
    files=[
        ('WHERE_WE_ARE_NOW.md','transition-note'),
        ('CONTEXTCLAW_PRODUCT_PLAN.md','product-plan'),
        ('contextclaw.py','mvp-source'),
        ('memory/2026-04-29.md','daily-memory'),
    ]
    added=[]
    for rel, typ in files:
        pth=Path(rel)
        if not pth.exists(): continue
        ns=argparse.Namespace(mission=mid,file=str(pth),id=None,type=typ,source='dogfood',sensitivity='normal',summary=None,sticker='CC-MVP')
        before=c.execute('select count(*) n from artifacts where mission_id=?',(mid,)).fetchone()['n']
        cmd_artifact(ns)
        after=con().execute('select count(*) n from artifacts where mission_id=?',(mid,)).fetchone()['n']
        if after>before: added.append(rel)
    print(json.dumps({'mission':mid,'added':added,'status':'dogfood ledger ready'},indent=2))

p=argparse.ArgumentParser(); sub=p.add_subparsers(required=True)
s=sub.add_parser('mission'); s.add_argument('objective'); s.add_argument('--id'); s.add_argument('--owner',default='local'); s.add_argument('--budget',type=float,default=1.0); s.add_argument('--acceptance',default=''); s.add_argument('--sticker',default=''); s.set_defaults(func=cmd_mission)
s=sub.add_parser('artifact'); s.add_argument('mission'); s.add_argument('--file'); s.add_argument('--id'); s.add_argument('--type',default='note'); s.add_argument('--source',default='cli'); s.add_argument('--sensitivity',default='normal'); s.add_argument('--summary'); s.add_argument('--sticker',default=''); s.set_defaults(func=cmd_artifact)
s=sub.add_parser('pass'); s.add_argument('mission'); s.add_argument('--role',default='planner'); s.add_argument('--model',default='local/free'); s.add_argument('--artifacts',nargs='+',required=True); s.add_argument('--prompt',required=True); s.add_argument('--output-tokens',type=int,default=1000); s.add_argument('--max-spend',type=float,default=0.05); s.add_argument('--sticker',default=''); s.set_defaults(func=cmd_plan_pass)
s=sub.add_parser('status'); s.add_argument('mission'); s.set_defaults(func=cmd_status)
s=sub.add_parser('inspect'); s.add_argument('mission'); s.add_argument('pass_id',nargs='?',default='last'); s.set_defaults(func=cmd_inspect)
s=sub.add_parser('why'); s.add_argument('mission'); s.add_argument('pass_id',nargs='?',default='last'); s.add_argument('--blocked',action='store_true',help='explain latest blocked pass'); s.set_defaults(func=cmd_why)
s=sub.add_parser('why-blocked'); s.add_argument('mission'); s.set_defaults(func=lambda args: cmd_why(argparse.Namespace(mission=args.mission,pass_id='last',blocked=True)))
s=sub.add_parser('review-feed'); s.add_argument('mission'); s.add_argument('--limit',type=int,default=5); s.add_argument('--format',choices=['markdown','json'],default='markdown'); s.set_defaults(func=cmd_review_feed)
s=sub.add_parser('dogfood'); s.add_argument('--mission'); s.add_argument('--budget',type=float,default=0.25); s.set_defaults(func=cmd_dogfood)
s=sub.add_parser('approve'); s.add_argument('mission'); s.add_argument('pass_id'); s.add_argument('--increase-budget',type=float,default=0.0); s.set_defaults(func=cmd_approve)
for name,state in [('pause','paused'),('continue','running'),('kill','killed')]:
    s=sub.add_parser(name); s.add_argument('mission'); s.set_defaults(func=cmd_state,state=state)
if __name__=='__main__':
    args=p.parse_args(); args.func(args)
