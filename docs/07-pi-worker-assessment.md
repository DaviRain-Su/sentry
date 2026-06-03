# pi-worker Assessment

Date: 2026-06-02

Source checked:
- https://github.com/qaml-ai/pi-worker
- https://github.com/qaml-ai/pi-worker/tree/main/examples/terminal-agent

## Verdict

`pi-worker` is useful for Sentry, but it should not replace the current MVP cloud-agent hot path yet.

The right integration shape is:

1. Keep the current Sentry Cloudflare Worker + Durable Object as the deterministic policy runtime.
2. Use `pi-worker` as an optional agent session layer for operator/copilot workflows, diagnostics, strategy drafting, local/remote terminal UX, and future local-agent parity.
3. Only move autonomous trade execution onto `pi-worker` primitives after a separate security and determinism spike.

## What pi-worker gives us

`pi-worker` is a Cloudflare Worker-oriented pi agent stack. Its terminal-agent example combines:

- browser terminal UI,
- SQLite-backed Durable Object session persistence,
- persistent files,
- Dynamic Worker Loader sandboxes for code execution,
- published session-scoped Workers,
- Durable Object alarm-powered cron jobs.

Its package layer exposes Worker-native primitives:

- R2, memory, and SQLite file tools,
- execute tool support through Dynamic Worker Loader,
- signed download helpers,
- worker-friendly pi agent/core re-exports.

These are strong matches for a future Sentry operator console and local/cloud agent parity.

## Why not replace the MVP Worker now

Sentry's hot path is narrower and more safety-critical:

- read chain state,
- evaluate trigger,
- run Guardian,
- build one known PTB,
- sign with the dedicated agent key,
- submit,
- record activity.

That path should stay deterministic and small. `pi-worker` adds a general coding-agent runtime, editable files, dynamic code execution, package imports, terminal state, and session-published Workers. Those are valuable capabilities, but they increase the trust boundary around the same Worker that may hold `AGENT_KEY`.

For MVP and testnet demo, the current Worker has the better security shape: fixed endpoints, fixed Guardian, fixed PTB builders, and chain state as source of truth.

## Proposed adapter

Add a future `PiWorkerAgentRuntime` adapter behind the same runtime boundary:

```ts
interface AgentRuntimeAdapter {
  activate(policyId: string): Promise<void>
  state(policyId: string): Promise<RuntimeState>
  tick(policyId: string, input?: TickInput): Promise<TickResult>
}
```

Initial usage should be non-custodial:

- no `AGENT_KEY` inside pi-worker session code,
- no direct execution PTB submission from user-editable tools,
- pi-worker can propose `ExecutionPlan`s and call existing Worker APIs,
- current Worker remains the only component allowed to sign/submit autonomous rescue PTBs.

## Follow-up spike

Run a small spike before adopting it:

1. Deploy `examples/terminal-agent` locally with Wrangler.
2. Create a minimal Sentry session that can read policy state through our Worker API.
3. Add a read-only command: "summarize this policy's risk".
4. Add a proposal-only command: "draft a rescue strategy", returning a Strategy JSON and hash.
5. Confirm no dynamic execution path can access signing secrets.
6. Decide whether `pi-worker` becomes:
   - an operator console,
   - a local/cloud agent session layer,
   - or a full runtime replacement.

Default decision today: operator console first, runtime replacement later.
