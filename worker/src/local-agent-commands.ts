export const LOCAL_AGENT_ALLOWED_COMMAND_TYPES = [
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
] as const;

export const LOCAL_AGENT_REPLAYABLE_COMMAND_TYPES = [
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
] as const;

export function isAllowedLocalAgentCommand(type: string): boolean {
  return (LOCAL_AGENT_ALLOWED_COMMAND_TYPES as readonly string[]).includes(type);
}

export function isReplayableLocalAgentCommand(type: string): boolean {
  return (LOCAL_AGENT_REPLAYABLE_COMMAND_TYPES as readonly string[]).includes(type);
}
