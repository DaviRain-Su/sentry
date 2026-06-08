export const LOCAL_AGENT_DIRECTORY_NAME = 'directory:local-agents';
export const LOCAL_AGENT_DIRECTORY_LIMIT = 64;

export type LocalAgentDirectoryEntry = {
  agent_id: string;
  owner: string | null;
  device_name: string | null;
  paired_at: string | null;
  updated_at: string;
  revoked_at: string | null;
  agent_public_key_id: string | null;
};

function safeString(value: unknown, fallback: string | null = null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function sanitizeDirectoryEntry(input: Record<string, unknown>): LocalAgentDirectoryEntry {
  const agentId = safeString(input.agent_id, '');
  if (!agentId) throw new Error('agent_id required');
  const now = new Date().toISOString();
  return {
    agent_id: agentId,
    owner: safeString(input.owner),
    device_name: safeString(input.device_name),
    paired_at: safeString(input.paired_at),
    updated_at: safeString(input.updated_at, now) || now,
    revoked_at: safeString(input.revoked_at),
    agent_public_key_id: safeString(input.agent_public_key_id),
  };
}

export function upsertDirectoryEntry(
  entries: LocalAgentDirectoryEntry[],
  input: Record<string, unknown>,
  limit = LOCAL_AGENT_DIRECTORY_LIMIT
): LocalAgentDirectoryEntry[] {
  const nextEntry = sanitizeDirectoryEntry(input);
  return [nextEntry, ...entries.filter((entry) => entry.agent_id !== nextEntry.agent_id)].slice(
    0,
    limit
  );
}

export function markDirectoryEntryRevoked(
  entries: LocalAgentDirectoryEntry[],
  agentId: string,
  revokedAt: string
): LocalAgentDirectoryEntry[] {
  return entries.map((entry) =>
    entry.agent_id === agentId
      ? {
          ...entry,
          revoked_at: revokedAt,
          updated_at: revokedAt,
        }
      : entry
  );
}
