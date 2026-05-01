import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIONS,
  assembleWorkingSet,
  labelContextItem,
  planCompactionActions,
  reevaluateLabels,
  resolveCurrentTaskState,
} from '../autocompaction-policy.js';

function label(item, state) {
  return labelContextItem(item, state);
}

test('wrong-lane correction stales bounty context and keeps website context hot', () => {
  const items = [
    { id: 'bounty', role: 'assistant', content: 'Current bounty filing queue: K2, Continue, Cline security research submissions.', lane: 'security-research', project: 'bounty' },
    { id: 'web', role: 'tool', content: 'SPRINT_STATUS: Instant Cash Roxborough is open pawn shop. Next action build one-page mock inventory demo.', lane: 'websites', project: 'dsb' },
    { id: 'correction', role: 'user', content: 'no. we were actually doing websites' },
  ];
  const labels = items.map((item) => label(item));
  const state = resolveCurrentTaskState(items);
  const reevaluated = reevaluateLabels(labels, state);

  const bounty = reevaluated.find((l) => l.id === 'bounty');
  const web = reevaluated.find((l) => l.id === 'web');
  assert.equal(state.lane, 'websites');
  assert.equal(bounty.stale, true);
  assert.equal(web.stale, false);
  assert.ok(web.importance > labels.find((l) => l.id === 'web').importance);

  const actions = planCompactionActions(reevaluated, state);
  const workingSet = assembleWorkingSet(items.map((item, i) => ({ ...item, _label: reevaluated[i] })), actions, { state });
  assert.match(workingSet, /CURRENT TASK CORRECTION/);
  assert.match(workingSet, /Instant Cash Roxborough/);
  assert.match(workingSet, /stale pointer/);
});

test('bulky file lifecycle drops raw to summary plus cold pointer after useful turn', () => {
  const content = `# Huge file\n${'important line\n'.repeat(1000)}`;
  const item = { id: 'file', role: 'tool', content, source: 'big.md', turn: 0 };
  const l = { ...label(item, { lane: 'websites', project: 'dsb' }), turn: 0, coldPointer: 'cold://file' };
  const actions = planCompactionActions([l], { lane: 'websites', project: 'dsb', turn: 2 });
  assert.equal(actions.get('file'), ACTIONS.KEEP_SUMMARY);

  const workingSet = assembleWorkingSet([{ ...item, _label: l }], actions, { state: { lane: 'websites', project: 'dsb' } });
  assert.match(workingSet, /ContextClaw summary/);
  assert.match(workingSet, /cold:\/\/file/);
  assert.ok(!workingSet.includes('important line\nimportant line\nimportant line\nimportant line'));
});

test('unresolved current-task error stays hot as summarized error', () => {
  const item = {
    id: 'err',
    role: 'tool',
    content: 'npm run build\nTypeError: Cannot read properties of undefined\n    at src/app.ts:10:3',
    lane: 'contextclaw',
    project: 'contextclaw',
  };
  const l = label(item);
  assert.equal(l.contentType, 'error-trace');
  const actions = planCompactionActions([l], { lane: 'contextclaw', project: 'contextclaw' });
  assert.equal(actions.get('err'), ACTIONS.KEEP_SUMMARY);
  const workingSet = assembleWorkingSet([{ ...item, _label: l }], actions);
  assert.match(workingSet, /TypeError/);
});

test('secret-risk values never appear in assembled output', () => {
  const item = {
    id: 'secret',
    role: 'tool',
    content: 'RESEND_API_KEY = re_1234567890abcdefghijklmnopqrstuvwxyz\nnormal=true',
    source: '.env',
  };
  const l = label(item);
  assert.equal(l.privacy, 'secret-risk');
  const actions = planCompactionActions([l], {});
  const workingSet = assembleWorkingSet([{ ...item, _label: l }], actions);
  assert.match(workingSet, /secret-risk/);
  assert.doesNotMatch(workingSet, /re_1234567890abcdefghijklmnopqrstuvwxyz/);
});

test('topic switch keeps off-topic pointer for grace pass then compacts it out', () => {
  const bounty = label({
    id: 'bounty',
    role: 'assistant',
    content: 'Detailed bounty security research packet with Code4rena and Immunefi filing notes.',
    lane: 'security-research',
    project: 'bounty',
  });
  const websiteState = { lane: 'websites', project: 'dsb', turn: 10, offTopicGracePasses: 1 };

  const firstPass = reevaluateLabels([bounty], websiteState)[0];
  assert.equal(firstPass.stale, true);
  assert.equal(firstPass.offTopicPasses, 1);
  const firstActions = planCompactionActions([firstPass], websiteState);
  assert.equal(firstActions.get('bounty'), ACTIONS.REHYDRATE_IF_ASKED);
  assert.match(assembleWorkingSet([{ id: 'bounty', content: 'raw bounty details', _label: firstPass }], firstActions), /stale pointer/);

  const secondPass = reevaluateLabels([firstPass], websiteState)[0];
  assert.equal(secondPass.offTopicPasses, 2);
  const secondActions = planCompactionActions([secondPass], websiteState);
  assert.equal(secondActions.get('bounty'), ACTIONS.COLD_STORE);
  assert.equal(assembleWorkingSet([{ id: 'bounty', content: 'raw bounty details', _label: secondPass }], secondActions), '');
});
