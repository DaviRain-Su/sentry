# Sui Data and Agent Stack Assessment

Date: 2026-06-02

Sources checked:

- Sui Data Stack: https://blog.sui.io/graphql-archival-store-sui-data-stack/?utm_source=twitter&utm_medium=organic&utm_campaign=build_beyond
- Seal: https://seal-docs.wal.app
- WaaP for Agents: https://docs.waap.xyz/for-agents
- Sui Stack CRM: https://github.com/abhinavg6/sui-stack-crm
- Sui Agent Skills: https://docs.sui.io/skills

## Short verdict

These links are useful, but they should not all enter the same product layer.

| Source | Sentry value | When to use |
| --- | --- | --- |
| Sui GraphQL / gRPC / Archival Store | Production data-read migration and better activity/history queries | Start soon. JSON-RPC is a dated dependency risk. |
| Seal + Walrus | Encrypted strategy snapshots, private agent notes, long-lived audit artifacts | Post-MVP privacy/audit layer. Do not store wallet keys. |
| WaaP for Agents | Production signer architecture reference; possible external signer / approval adapter | Post-MVP mainnet hardening, not current Testnet hot path. |
| Sui Stack CRM | Concrete Seal + Walrus + Sui shared-object ACL pattern | Reference implementation for encrypted records and version history. |
| Sui Agent Skills | Developer workflow accelerator for Move, PTB, dApp Kit, data access | Use in implementation sessions; not a runtime dependency. |

## 1. Sui Data Stack

Sui's 2026 data-stack direction is clear: production apps should move away from JSON-RPC toward the new stack of gRPC, GraphQL RPC, and Archival Store. The Sui Foundation blog says JSON-RPC will be deactivated on **July 31, 2026**.

Current Sentry impact:

- `src/chain-read.js` uses raw JSON-RPC from the browser.
- `worker/src/chain.js` reads via the Sui TypeScript SDK client, which still depends on RPC-style fullnode access.
- Activity reads page through recent events and object reads; this works today, but it is not the long-term data shape.

Recommended direction:

1. Keep the current Worker-first read path for MVP.
2. Add a `ChainDataProvider` boundary behind Worker reads.
3. Implement `JsonRpcChainDataProvider` as the current provider.
4. Add `GraphqlChainDataProvider` for policy list, object snapshots, event history, and owner portfolio reads.
5. Reserve gRPC for low-latency agent monitoring once live execution matters.
6. Use Archival Store-backed providers for historical activity, strategy performance, and judge/demo replay.

Do not wire the frontend directly to GraphQL as the main production path. The Worker should stay the read contract so frontend, local daemon, and future operator console see the same state semantics.

## 2. Seal + Walrus

Seal is a decentralized secrets management service. Its access control is defined and validated on Sui, while encrypted data can live on Walrus or other storage. It emphasizes client-side encryption and warns that it is not a KMS and should not be used for wallet keys or highly sensitive regulated secrets.

Current Sentry impact:

- We currently store strategy metadata on-chain via `strategy_hash`, and runtime status through events and Worker state.
- We do not have private strategy notes, private backtest metadata, or durable encrypted agent reasoning traces.
- We should not place `AGENT_KEY`, owner wallet keys, or production signing secrets into Seal.

Recommended direction:

- Post-MVP: store encrypted strategy snapshots and private agent reasoning logs on Walrus, gated by a Sui access object.
- Chain only stores `strategy_hash`, Walrus blob id, and access object id.
- Dashboard decrypts user-private records client-side when the owner is authorized.
- Worker can write public activity and non-sensitive runtime telemetry; private notes should be opt-in.

Useful Sentry artifacts for Seal/Walrus:

- original natural-language strategy text,
- full parsed Strategy JSON,
- backtest inputs and results,
- agent reasoning trace,
- human approval notes,
- incident reports after failed or blocked ticks.

## 3. Sui Stack CRM reference

The `sui-stack-crm` project is valuable because it demonstrates the exact Sui Stack pattern Sentry might need later:

- browser encrypts payload with Seal,
- stores ciphertext as Walrus content-addressed blobs,
- writes blob id and version to a Sui shared object,
- uses Sui ACL logic to decide who can decrypt,
- renders history from Sui events instead of a centralized app database.

Sentry translation:

- `PolicyPrivateRecord` can mirror the CRM's table/payload pattern.
- Each policy can point to encrypted Walrus blobs for strategy notes and private execution context.
- Versioned updates can become on-chain events, giving "what changed, when" provenance.
- Optimistic concurrency from the CRM save flow maps well to strategy-edit UX: if the policy version changed, refresh and ask the user to re-apply edits.

This is not needed for the current hackathon-critical path. It becomes useful when Sentry needs private strategy history, team/shared policies, or persistent research notes.

## 4. WaaP for Agents

WaaP for Agents is relevant because it addresses a weakness in our current cloud mode: the MVP Worker can hold an agent private key in `.dev.vars` / Worker secrets.

WaaP's agent model:

- the agent proposes transactions,
- a policy engine checks spend/risk limits,
- routine operations can be auto-signed within configured privileges,
- high-risk operations can trigger user approval,
- two-party signing avoids a single full private key held by the agent process.

Sentry position:

- WaaP can complement MoveGate + SentryPolicyWrapper, not replace them.
- MoveGate + Wrapper remain the Sui on-chain enforcement layer.
- WaaP-like signing can become an `ExternalSignerAdapter` for production mainnet mode.
- It is especially interesting for multivenue expansion, where EVM and Sui need a common signer/approval abstraction.

Do not put WaaP into the MVP hot path now. The current Testnet Worker is deterministic and small; introducing external signer orchestration would add moving parts before live DeepBook funding is solved.

Recommended adapter shape:

```ts
interface SignerAdapter {
  kind: 'worker-secret' | 'local-daemon' | 'waap' | 'hardware' | 'remote-signer'
  address(): Promise<string>
  signAndSubmit(plan: ApprovedExecutionPlan): Promise<ExecutionReceipt>
}
```

Mainnet hardening path:

1. Keep `worker-secret` for Testnet.
2. Implement `local-daemon` for user-controlled keys.
3. Explore `waap` as an external signer with policy checks and approval notifications.
4. Require a security review before any signer adapter can submit production trades.

## 5. Sui Agent Skills

Sui Agent Skills are not a product dependency. They are a development workflow upgrade.

Relevant skills for Sentry work:

- `accessing-data`: chain reads, subscriptions, indexing, Walrus blobs.
- `ptbs`: Programmable Transaction Block composition.
- `object-model`: Sui object ownership and shared object design.
- `frontend-apps`: dApp Kit wallet connection and transaction execution.
- `sui-build-test` and `move-unit-testing`: Move build/test workflows.
- `sui-publish`: publish and upgrade checklist.
- `walrus-sites` / `walrus-sites-publishing`: future decentralized frontend hosting.

Recommended use:

- Add these skills to future agent/coding setup instructions.
- Use them when implementing GraphQL/gRPC migration, PTB changes, Move upgrades, Walrus/Seal storage, or Walrus Sites deployment.

## Product implications

Near-term implementation:

1. Keep current Worker-first API.
2. Add `ChainDataProvider` abstraction.
3. Plan GraphQL migration before **July 31, 2026**.
4. Keep direct frontend chain reads as dev fallback only.

Post-MVP architecture:

1. Use Seal + Walrus for encrypted private policy records.
2. Use the Sui Stack CRM pattern for versioned encrypted blobs and Sui ACL.
3. Add `SignerAdapter` with WaaP/local/hardware signer options.
4. Keep MoveGate + SentryPolicyWrapper as the on-chain policy boundary.
5. Add Sui Agent Skills to the engineering setup for faster, more consistent Sui work.

What not to do:

- Do not use Seal to store wallet or agent private keys.
- Do not treat WaaP as a replacement for MoveGate/Wrapper chain enforcement.
- Do not let frontend data reads drift away from Worker semantics.
- Do not migrate to GraphQL in the browser first; do it behind Worker/provider boundaries.
