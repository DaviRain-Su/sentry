import assert from 'node:assert/strict';
import {
  LOCAL_AGENT_ALLOWED_COMMAND_TYPES,
  LOCAL_AGENT_REPLAYABLE_COMMAND_TYPES,
  isAllowedLocalAgentCommand,
  isReplayableLocalAgentCommand,
} from '../src/local-agent-commands.ts';

for (const type of [
  'agent.status',
  'agent.start',
  'agent.stop',
  'agent.dispatch',
  'agent.registry',
  'agent.probe',
  'venue.catalog',
  'authorization.registry',
  'authorization.revoke',
  'authorization.rotate',
  'authorization.state',
  'authorization.validate',
  'secret.store',
  'wallet.refs',
  'inventory.adapters',
  'inventory.sync',
  'signer.probe',
  'activity.tail',
  'policy.local.add',
  'policy.local.list',
  'policy.local.tick',
  'policy.local.plan',
  'policy.local.run_once',
  'policy.local.loop.status',
  'policy.local.loop.start',
  'policy.local.loop.stop',
  'policy.local.loop.run_now',
  'policy.pause',
  'policy.resume',
  'policy.revoke',
]) {
  assert.equal(isAllowedLocalAgentCommand(type), true, `${type} should be allowed`);
  assert.equal(LOCAL_AGENT_ALLOWED_COMMAND_TYPES.includes(type), true);
}

assert.equal(isAllowedLocalAgentCommand('wallet.export'), false);
assert.equal(isAllowedLocalAgentCommand('venue.credentials.store'), false);
assert.equal(isAllowedLocalAgentCommand('orders.withdraw'), false);

for (const type of [
  'agent.status',
  'agent.registry',
  'agent.probe',
  'venue.catalog',
  'authorization.registry',
  'authorization.state',
  'authorization.validate',
  'secret.store',
  'wallet.refs',
  'inventory.adapters',
  'inventory.sync',
  'signer.probe',
  'activity.tail',
  'policy.local.list',
  'policy.local.tick',
  'policy.local.plan',
  'policy.local.loop.status',
]) {
  assert.equal(isReplayableLocalAgentCommand(type), true, `${type} should be replayable`);
  assert.equal(LOCAL_AGENT_REPLAYABLE_COMMAND_TYPES.includes(type), true);
}

for (const type of [
  'agent.start',
  'agent.stop',
  'agent.dispatch',
  'authorization.revoke',
  'authorization.rotate',
  'policy.local.add',
  'policy.local.run_once',
  'policy.local.loop.start',
  'policy.local.loop.stop',
  'policy.local.loop.run_now',
  'policy.pause',
  'policy.resume',
  'policy.revoke',
]) {
  assert.equal(isReplayableLocalAgentCommand(type), false, `${type} should not be replayable`);
}

console.log('ALL LOCAL AGENT COMMAND TESTS PASS');
