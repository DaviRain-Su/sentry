import assert from 'node:assert/strict';
import {
  LOCAL_AGENT_ALLOWED_COMMAND_TYPES,
  isAllowedLocalAgentCommand,
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
  'authorization.validate',
  'secret.store',
  'inventory.adapters',
  'inventory.sync',
  'signer.probe',
  'activity.tail',
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

console.log('ALL LOCAL AGENT COMMAND TESTS PASS');
