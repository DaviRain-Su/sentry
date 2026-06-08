/* ===========================================================
   Sentry — Profile / Wallet screen
   Identity, balances, holdings, session & gas.
   Demo mode shows the zkLogin persona; live mode (wallet connected)
   shows the real address, real balances and a wallet-session card.
   =========================================================== */
import { useEffect, useState } from 'react';
import {
  WORKER_BASE_URL,
  WORKER_CONFIGURED,
  createLocalAgentPairing,
  getLocalAgentCommand,
  getLocalAgentStatus,
  listLocalAgentSessions,
  listLocalAgentCommands,
  revokeLocalAgent,
  submitLocalAgentCommand,
  tailLocalAgentActivity,
} from '../api.js';
import { RG } from '../data.js';
import { Icon, Token, useAnimatedNumber, fmtUsd } from './Primitives.jsx';
import { Button } from '@heroui/react';

function CopyChip({ text, label, full }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const v = full || text;
    try {
      navigator.clipboard && navigator.clipboard.writeText(v);
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <Button
      onPress={copy}
      size="sm"
      className="mono rg-btn-2 text-xs font-semibold"
      style={copied ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
      endContent={<Icon name={copied ? 'check' : 'copy'} size={13} stroke={copied ? 2.6 : 1.8} />}
    >
      {copied ? 'copied' : label || text}
    </Button>
  );
}

function MetaRow({ icon, iconColor, label, children, last }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '13px 0',
        borderTop: last ? 'none' : '1px solid var(--border)',
      }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--glass-hi)',
          color: iconColor || 'var(--t1)',
        }}
      >
        <Icon name={icon} size={15} />
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--t1)' }}>{label}</span>
      <div style={{ flex: 1 }} />
      <div style={{ textAlign: 'right' }}>{children}</div>
    </div>
  );
}

function shortId(id) {
  return id && id.length > 16 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function FundingReadiness({ funding, live }) {
  if (!live || !funding) return null;
  const rows = funding.criteria || [];
  const blocked = funding.readiness_state === 'blocked';
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div>
          <div className="card-title">Execution funding readiness</div>
          <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 3 }}>
            Chain-authoritative precondition only — execution is not claimed until a real Testnet tx
            succeeds.
          </div>
        </div>
        <span
          className={`badge ${blocked ? 'badge-warn' : 'badge-safe'}`}
          style={{ fontSize: 9.5 }}
        >
          <span className="dot"></span>
          {funding.readiness_state}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--t2)' }}>
            {['Holder', 'Asset', 'Threshold', 'Observed', 'Usable'].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: h === 'Holder' ? 'left' : 'right',
                  padding: '7px 8px',
                  fontSize: 9.5,
                  fontFamily: 'var(--f-mono)',
                  fontWeight: 500,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.asset} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 8px' }}>
                <div className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>
                  {r.holder_label}
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--t2)' }}>
                  {shortId(r.holder)}
                </div>
              </td>
              <td
                className="mono"
                style={{ padding: '10px 8px', textAlign: 'right', fontSize: 11.5 }}
              >
                {r.asset}
              </td>
              <td
                className="mono"
                style={{ padding: '10px 8px', textAlign: 'right', fontSize: 11.5 }}
              >
                {r.threshold}
              </td>
              <td
                className="mono"
                style={{ padding: '10px 8px', textAlign: 'right', fontSize: 11.5 }}
              >
                {r.observed_balance}
              </td>
              <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                <span
                  className={`badge ${r.usable ? 'badge-safe' : 'badge-warn'}`}
                  style={{ fontSize: 9 }}
                >
                  {r.usable ? 'usable' : r.blocker_code}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {funding.blockers?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {funding.blockers.map((b) => (
            <span key={b.code} className="badge badge-warn" style={{ fontSize: 9 }}>
              {b.code}
            </span>
          ))}
        </div>
      )}
      {funding.execution_blockers?.some((b) => b.code === 'EXECUTION_DISABLED') && (
        <div style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 8 }}>
          Funding is usable, but live execution remains separately gated by{' '}
          <span className="mono">EXECUTION_ENABLED</span>.
        </div>
      )}
    </div>
  );
}

function statusClass(status) {
  if (['ready', 'safe', 'live', 'linked', 'scoped'].includes(status)) return 'badge-safe';
  if (['syncing', 'planned', 'mixed'].includes(status)) return 'badge-warn';
  if (['blocked', 'locked'].includes(status)) return 'badge-danger';
  return 'badge-neutral';
}

function TargetIntegrationMatrix({ catalog }) {
  if (!catalog) return null;
  const rows = catalog.target_venues || [
    ...(catalog.target_chains || []),
    ...(catalog.target_perps || []),
    ...(catalog.target_exchanges || []),
  ];
  return (
    <div
      style={{
        background: 'var(--glass)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        padding: 15,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="card-title">Target integrations</div>
          <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 3 }}>
            Production target: Solana, Ethereum, Hyperliquid and OKX. Sui remains a demo runtime
            until the new adapters ship.
          </div>
        </div>
        <span className="badge badge-accent" style={{ fontSize: 9 }}>
          local agent default
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
          <thead>
            <tr style={{ color: 'var(--t2)' }}>
              {['Target', 'Role', 'Authorization', 'Budget guard', 'Next adapter step'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: h === 'Target' ? 'left' : 'right',
                    padding: '7px 8px',
                    fontSize: 9.5,
                    fontFamily: 'var(--f-mono)',
                    fontWeight: 500,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 999,
                        background: v.color,
                        boxShadow: `0 0 8px ${v.color}66`,
                      }}
                    />
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 650 }}>{v.name}</div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--t2)' }}>
                        {v.chain_id || 'cex'} · {v.status}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right', fontSize: 11.5 }}>
                  {v.role}
                </td>
                <td
                  className="mono"
                  style={{ padding: '10px 8px', textAlign: 'right', fontSize: 10.5 }}
                >
                  {v.authorization_model}
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                  <span
                    className={`badge ${v.funds_custodied ? 'badge-safe' : v.budget_enforcement === 'venue_limit' ? 'badge-warn' : 'badge-neutral'}`}
                    style={{ fontSize: 8.5 }}
                  >
                    {v.budget_enforcement}
                  </span>
                </td>
                <td
                  style={{
                    padding: '10px 8px',
                    textAlign: 'right',
                    fontSize: 10.5,
                    color: 'var(--t2)',
                    maxWidth: 240,
                  }}
                >
                  {v.required_next?.[0] || v.adapter_status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const BRIDGE_AGENT_ID_KEY = 'sentry.localAgent.agentId';
const BRIDGE_OWNER_TOKEN_KEY = 'sentry.localAgent.ownerControlToken';
const BRIDGE_REQUIRE_SIGNER_PROBE_KEY = 'sentry.localAgent.requireSignerProbe';
const BRIDGE_SIGNER_TIMEOUT_KEY = 'sentry.localAgent.signerTimeoutMs';

function readStored(key, fallback = '') {
  if (typeof window === 'undefined') return fallback;
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* ignore storage failures */
  }
}

function readStoredBoolean(key, fallback = false) {
  const value = readStored(key, fallback ? 'true' : 'false');
  return value === 'true';
}

function csvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function authorizationRevokeOptionsFromSnapshot(snapshot) {
  const states = Array.isArray(snapshot?.states) ? snapshot.states : [];
  const seen = new Set();
  const options = [];
  for (const state of states) {
    if (!state || state.venue_id === 'sui-testnet-demo') continue;
    const model = state.authorization_ref?.authorization_model;
    const ref = state.authorization_ref?.ref || state.authorization_ref?.id || '';
    if (model === 'venue_api_key' && typeof ref === 'string') {
      const [venueId, ...rest] = ref.split(':');
      const keyHandle = rest.join(':');
      if (venueId && keyHandle && keyHandle !== 'key-handle') {
        const value = `key|${venueId}|${keyHandle}`;
        if (!seen.has(value)) {
          seen.add(value);
          options.push({
            value,
            label: `${venueId} · ${state.key_handle || keyHandle}`,
            status: state.status,
          });
        }
      }
    }
    if (state.wallet_ref?.wallet_id) {
      const value = `wallet|${state.wallet_ref.wallet_id}`;
      if (!seen.has(value)) {
        seen.add(value);
        options.push({
          value,
          label: `${state.wallet_ref.wallet_id} · OWS`,
          status: state.status,
        });
      }
    }
  }
  return options;
}

function authorizationRotateOptionsFromSnapshot(snapshot) {
  const states = Array.isArray(snapshot?.states) ? snapshot.states : [];
  const seen = new Set();
  const options = [];
  for (const state of states) {
    const model = state?.authorization_ref?.authorization_model;
    const ref = state?.authorization_ref?.ref || state?.authorization_ref?.id || '';
    if (model !== 'venue_api_key' || typeof ref !== 'string') continue;
    const [venueId, ...rest] = ref.split(':');
    const keyHandle = rest.join(':');
    if (!venueId || !keyHandle || keyHandle === 'key-handle') continue;
    const value = `key|${venueId}|${keyHandle}`;
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({
      value,
      label: `${venueId} · ${state.key_handle || keyHandle}`,
      status: state.rotation_state?.status || 'unknown',
      disabled: state.grant_state?.status === 'revoked',
    });
  }
  return options;
}

function rotationBadgeClass(status) {
  if (status === 'fresh') return 'badge-safe';
  if (status === 'due_soon' || status === 'unknown') return 'badge-warn';
  if (status === 'expired') return 'badge-danger';
  return 'badge-neutral';
}

const AUTH_READINESS_META = {
  blocked: {
    label: 'Blocked',
    badge: 'badge-danger',
    icon: 'alert',
  },
  planned: {
    label: 'Planned',
    badge: 'badge-warn',
    icon: 'clock',
  },
  metadata_ready: {
    label: 'Metadata ready',
    badge: 'badge-accent',
    icon: 'shield',
  },
  metadata_ready_with_warnings: {
    label: 'Metadata + warnings',
    badge: 'badge-warn',
    icon: 'alert',
  },
  dispatch_ready: {
    label: 'Dispatch ready',
    badge: 'badge-safe',
    icon: 'check',
  },
};

function authReadinessMeta(category) {
  return (
    AUTH_READINESS_META[category] || {
      label: category || 'Unknown',
      badge: 'badge-neutral',
      icon: 'shield',
    }
  );
}

function authReadinessCount(summary, category, idsKey) {
  if (Array.isArray(summary?.[idsKey])) return summary[idsKey].length;
  return summary?.by_category?.[category] ?? 0;
}

function authReadinessIssueCodes(row) {
  return [
    ...(Array.isArray(row?.blocking_issue_codes) ? row.blocking_issue_codes : []),
    ...(Array.isArray(row?.planned_issue_codes) ? row.planned_issue_codes : []),
    ...(Array.isArray(row?.warning_issue_codes) ? row.warning_issue_codes : []),
  ].slice(0, 3);
}

function AuthorizationReadinessPanel({ snapshot }) {
  const summary = snapshot?.readiness_summary;
  const rows = Array.isArray(summary?.states) ? summary.states : [];
  const productionReady = Boolean(summary?.production_ready);
  const metrics = [
    {
      label: 'Targets',
      value: summary?.target_count ?? rows.length,
      badge: productionReady ? 'badge-safe' : 'badge-neutral',
    },
    {
      label: 'Dispatch',
      value: authReadinessCount(summary, 'dispatch_ready', 'dispatch_ready_venue_ids'),
      badge: 'badge-safe',
    },
    {
      label: 'Blocked',
      value: authReadinessCount(summary, 'blocked', 'blocked_venue_ids'),
      badge: 'badge-danger',
    },
    {
      label: 'Planned',
      value: authReadinessCount(summary, 'planned', 'planned_venue_ids'),
      badge: 'badge-warn',
    },
    {
      label: 'Metadata',
      value: authReadinessCount(summary, 'metadata_ready', 'metadata_ready_venue_ids'),
      badge: 'badge-accent',
    },
  ];

  return (
    <div
      style={{
        marginTop: 10,
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--bg-0)',
        padding: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <div>
          <div className="card-title" style={{ fontSize: 12 }}>
            Authorization readiness
          </div>
          <div style={{ color: 'var(--t2)', fontSize: 10.5, marginTop: 3 }}>
            Target venue readiness from the local daemon, separated from raw metadata state.
          </div>
        </div>
        <span
          className={`badge ${productionReady ? 'badge-safe' : 'badge-warn'}`}
          style={{ fontSize: 8.5 }}
        >
          <span className={productionReady ? 'dot pulse' : 'dot'}></span>
          {productionReady ? 'production ready' : 'not production ready'}
        </span>
      </div>

      {rows.length === 0 ? (
        <div
          className="mono"
          style={{
            borderRadius: 8,
            border: '1px dashed var(--border)',
            color: 'var(--t2)',
            fontSize: 10.5,
            lineHeight: 1.5,
            padding: '10px 11px',
          }}
        >
          Run Auth state after pairing a daemon to load OKX, Hyperliquid, Solana and Ethereum
          readiness.
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))',
              gap: 7,
            }}
          >
            {metrics.map((metric) => (
              <div
                key={metric.label}
                style={{
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--glass)',
                  padding: '8px 9px',
                }}
              >
                <div className="eyebrow" style={{ fontSize: 8 }}>
                  {metric.label}
                </div>
                <span className={`badge ${metric.badge}`} style={{ marginTop: 6, fontSize: 8 }}>
                  {metric.value}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
            {rows.map((row) => {
              const meta = authReadinessMeta(row.category);
              const issueCodes = authReadinessIssueCodes(row);
              const nextStep = Array.isArray(row.next_steps) ? row.next_steps[0] : null;
              return (
                <div
                  key={row.venue_id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    flexWrap: 'wrap',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--glass)',
                    padding: '8px 9px',
                  }}
                >
                  <div style={{ minWidth: 130, flex: '1 1 145px' }}>
                    <div className="mono" style={{ fontSize: 10.5, color: 'var(--t1)' }}>
                      {row.venue_name || row.venue_id}
                    </div>
                    <div
                      className="mono"
                      style={{ marginTop: 2, fontSize: 9.5, color: 'var(--t2)' }}
                    >
                      {row.authorization_ref ? shortId(row.authorization_ref) : row.venue_id}
                    </div>
                  </div>
                  <span className={`badge ${meta.badge}`} style={{ fontSize: 8 }}>
                    <Icon name={meta.icon} size={10} />
                    {meta.label}
                  </span>
                  <div
                    className="mono"
                    style={{
                      minWidth: 180,
                      flex: '2 1 220px',
                      color: 'var(--t2)',
                      fontSize: 9.8,
                      lineHeight: 1.45,
                    }}
                  >
                    <div>
                      {issueCodes.length > 0
                        ? issueCodes.join(' · ')
                        : row.dispatch_ready
                          ? row.dispatch_ready_source || 'dispatch_ready'
                          : row.state_status || 'metadata'}
                    </div>
                    {nextStep && (
                      <div
                        style={{
                          marginTop: 3,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {nextStep}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function LocalAgentBridgeCard({ onToast }) {
  const [agentId, setAgentId] = useState(() => readStored(BRIDGE_AGENT_ID_KEY, 'default'));
  const [ownerToken, setOwnerToken] = useState(() => readStored(BRIDGE_OWNER_TOKEN_KEY, ''));
  const [probeAgent, setProbeAgent] = useState('codex');
  const [useLiveMarket, setUseLiveMarket] = useState(true);
  const [useLiveInventory, setUseLiveInventory] = useState(false);
  const [marketVenues, setMarketVenues] = useState('okx,hyperliquid');
  const [marketSymbols, setMarketSymbols] = useState('BTC,ETH,SOL');
  const [loopIntervalSec, setLoopIntervalSec] = useState('60');
  const [dispatchArmed, setDispatchArmed] = useState(false);
  const [requireSignerProbe, setRequireSignerProbe] = useState(() =>
    readStoredBoolean(BRIDGE_REQUIRE_SIGNER_PROBE_KEY, true)
  );
  const [signerTimeoutMs, setSignerTimeoutMs] = useState(() =>
    readStored(BRIDGE_SIGNER_TIMEOUT_KEY, '30000')
  );
  const [loopState, setLoopState] = useState(null);
  const [pairing, setPairing] = useState(null);
  const [status, setStatus] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [commands, setCommands] = useState([]);
  const [lastCommand, setLastCommand] = useState(null);
  const [authorizationSnapshot, setAuthorizationSnapshot] = useState(null);
  const [authRevokeTarget, setAuthRevokeTarget] = useState('');
  const [authRevokeConfirm, setAuthRevokeConfirm] = useState(false);
  const [authRotateTarget, setAuthRotateTarget] = useState('');
  const [authRotateConfirm, setAuthRotateConfirm] = useState(false);
  const [localPolicies, setLocalPolicies] = useState([]);
  const [policyStoreSummary, setPolicyStoreSummary] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const bridgeStatus = status?.session_status || (WORKER_CONFIGURED ? 'not checked' : 'worker off');
  const bridgeBadge =
    bridgeStatus === 'online'
      ? 'badge-safe'
      : bridgeStatus === 'stale' || bridgeStatus === 'offline'
        ? 'badge-warn'
        : bridgeStatus === 'worker off' || bridgeStatus === 'revoked'
          ? 'badge-danger'
          : 'badge-neutral';

  async function refreshBridge({ withCommands = true } = {}) {
    setError(null);
    const nextStatus = await getLocalAgentStatus(agentId);
    setStatus(nextStatus);
    if (nextStatus.status === 'error') setError(nextStatus.message || nextStatus.code);
    const listedSessions = await listLocalAgentSessions();
    if (listedSessions.status === 'ok') setSessions(listedSessions.agents || []);
    if (withCommands && ownerToken) {
      const listed = await listLocalAgentCommands(agentId, ownerToken);
      if (listed.status === 'ok') setCommands(listed.commands || []);
    }
    return nextStatus;
  }

  useEffect(() => {
    if (WORKER_CONFIGURED) refreshBridge({ withCommands: Boolean(ownerToken) });
  }, []);

  function updateAgentId(value) {
    setAgentId(value);
    writeStored(BRIDGE_AGENT_ID_KEY, value);
  }

  function updateOwnerToken(value) {
    setOwnerToken(value);
    writeStored(BRIDGE_OWNER_TOKEN_KEY, value);
  }

  function updateRequireSignerProbe(value) {
    setRequireSignerProbe(value);
    writeStored(BRIDGE_REQUIRE_SIGNER_PROBE_KEY, value ? 'true' : 'false');
  }

  function updateSignerTimeoutMs(value) {
    setSignerTimeoutMs(value);
    writeStored(BRIDGE_SIGNER_TIMEOUT_KEY, value);
  }

  function updateLocalPolicyStore(store) {
    if (!store || typeof store !== 'object') return;
    if (Array.isArray(store.policies)) setLocalPolicies(store.policies);
    setPolicyStoreSummary({
      status: store.status || 'unknown',
      policy_count: store.policy_count ?? store.policies?.length ?? 0,
      active_count: store.active_count ?? 0,
      paused_count: store.paused_count ?? 0,
      revoked_count: store.revoked_count ?? 0,
    });
  }

  function mergeLocalPolicy(policy) {
    if (!policy?.policy_id) return;
    setLocalPolicies((current) => [
      policy,
      ...current.filter((item) => item.policy_id !== policy.policy_id),
    ]);
    setPolicyStoreSummary((current) => {
      const existing = current || {
        status: 'ok',
        policy_count: 0,
        active_count: 0,
        paused_count: 0,
        revoked_count: 0,
      };
      const alreadyKnown = localPolicies.some((item) => item.policy_id === policy.policy_id);
      return {
        ...existing,
        status: 'ok',
        policy_count: existing.policy_count + (alreadyKnown ? 0 : 1),
        active_count: existing.active_count + (!alreadyKnown && policy.status === 'active' ? 1 : 0),
      };
    });
  }

  function marketCommandOptions() {
    return {
      live_market: useLiveMarket,
      market_venues: csvList(marketVenues),
      market_symbols: csvList(marketSymbols),
    };
  }

  function policyRunPayload({ checkReadiness = false, dispatch = false, mark = false } = {}) {
    const signerTimeout = Math.max(1000, Number(signerTimeoutMs) || 30000);
    const signerScope = checkReadiness || dispatch;
    return {
      limit: 10,
      check_readiness: checkReadiness || dispatch,
      check_inventory: checkReadiness || dispatch || useLiveInventory,
      live_inventory: Boolean(useLiveInventory && (checkReadiness || dispatch)),
      dispatch,
      mark,
      simulated: true,
      verify_receipt: true,
      verify_live_grant: Boolean(dispatch),
      verify_okx_live_read: Boolean(dispatch),
      require_signer_probe: Boolean(signerScope && requireSignerProbe),
      signer_probe_timeout_ms: 3000,
      signer_timeout_ms: signerTimeout,
      ...marketCommandOptions(),
    };
  }

  function policyLoopPayload() {
    const intervalSec = Math.max(5, Number(loopIntervalSec) || 60);
    return {
      ...policyRunPayload({
        checkReadiness: true,
        dispatch: dispatchArmed,
        mark: dispatchArmed,
      }),
      interval_ms: intervalSec * 1000,
      run_immediately: true,
    };
  }

  function seedPolicyPayload() {
    const intervalSec = Math.max(60, Number(loopIntervalSec) || 60);
    return {
      policy: {
        policy_id: 'ui-hyperliquid-okx-funding-guard',
        display_name: 'UI Hyperliquid OKX funding guard',
        target_agent: probeAgent || 'codex',
        target_venue_ids: ['hyperliquid', 'okx'],
        tick_interval_ms: intervalSec * 1000,
        next_tick_after: new Date().toISOString(),
        trigger: {
          type: 'funding_rate_above',
          venue_id: 'hyperliquid',
          symbol: 'BTC',
          funding_rate_above: 0.0001,
        },
        constraints: {
          max_notional_usd: '100',
          max_slippage_bps: 50,
          venue_caps: {
            hyperliquid: '50',
            okx: '50',
          },
        },
        task_templates: [
          {
            venue_id: 'hyperliquid',
            action_type: 'place_order',
            coin: 'BTC',
            side: 'sell',
            orderType: 'limit',
            size: '0.001',
            price: '90000',
            tif: 'Gtc',
            cloid: '0x22222222222222222222222222222222',
          },
          {
            venue_id: 'okx',
            action_type: 'place_order',
            instrument: 'BTC-USDT',
            side: 'buy',
            orderType: 'limit',
            size: '0.001',
            price: '88000',
            clientOrderId: 'sentry-ui-seed-1',
          },
        ],
      },
    };
  }

  function updateLoopStateFromRecord(record) {
    const nextLoop = record?.result?.policy_loop || record?.policy_loop || null;
    if (nextLoop) setLoopState(nextLoop);
  }

  async function createPairing() {
    setBusy('pairing');
    setError(null);
    const result = await createLocalAgentPairing({
      owner: 'dashboard',
      device_label: `dashboard-${Date.now()}`,
    });
    setBusy(null);
    if (result.status !== 'ok') {
      setError(result.message || result.code);
      onToast && onToast(result.message || result.code || 'Pairing failed', 'var(--danger)');
      return;
    }
    setPairing(result);
    updateOwnerToken(result.owner_control_token || '');
    updateAgentId(agentId || 'default');
    onToast && onToast('Pairing code created for the local daemon', 'var(--accent)');
  }

  function requireOwnerToken(action) {
    if (ownerToken) return true;
    setError('Owner control token required.');
    onToast && onToast(`${action} requires an owner control token`, 'var(--warn)');
    return false;
  }

  async function pollCommand(commandId) {
    if (!commandId || !ownerToken) return null;
    let latest = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 650));
      const result = await getLocalAgentCommand(agentId, ownerToken, commandId);
      if (result.status !== 'ok') {
        latest = result;
        break;
      }
      latest = result.command;
      setLastCommand(result.command);
      if (result.command?.command_status === 'result') break;
    }
    await refreshBridge({ withCommands: true });
    return latest;
  }

  async function runProbe() {
    if (!requireOwnerToken('Agent probe')) return;
    setBusy('probe');
    setError(null);
    const result = await submitLocalAgentCommand(agentId, ownerToken, 'agent.probe', {
      agent_id: probeAgent,
      timeout_ms: 3000,
    });
    if (result.status !== 'ok') {
      setBusy(null);
      setError(result.message || result.code);
      onToast && onToast(result.message || result.code || 'Agent probe failed', 'var(--danger)');
      return;
    }
    setLastCommand(result.command_record || null);
    const commandId = result.command?.message_id || result.command_record?.command_id;
    const finalRecord = await pollCommand(commandId);
    setBusy(null);
    const finalStatus = finalRecord?.result_status || finalRecord?.status;
    onToast &&
      onToast(
        finalStatus ? `Agent probe ${finalStatus}` : 'Agent probe queued',
        finalStatus === 'ok' ? 'var(--safe)' : 'var(--warn)'
      );
  }

  async function tailActivity() {
    if (!requireOwnerToken('Activity tail')) return;
    setBusy('activity');
    setError(null);
    const result = await tailLocalAgentActivity(agentId, ownerToken, { limit: 25 });
    if (result.status !== 'ok') {
      setBusy(null);
      setError(result.message || result.code);
      onToast && onToast(result.message || result.code || 'Activity tail failed', 'var(--danger)');
      return;
    }
    setLastCommand(result.command_record || null);
    const commandId = result.command?.message_id || result.command_record?.command_id;
    const finalRecord = await pollCommand(commandId);
    setBusy(null);
    const count = finalRecord?.result?.event_count;
    onToast &&
      onToast(
        count === undefined ? 'Activity tail queued' : `Activity tail returned ${count} events`,
        'var(--accent)'
      );
  }

  async function runPolicyOnce({ checkReadiness = false, dispatch = false, mark = false } = {}) {
    if (!requireOwnerToken('Policy run')) return;
    setBusy(dispatch ? 'policy-dispatch' : checkReadiness ? 'policy-preflight' : 'policy-plan');
    setError(null);
    const result = await submitLocalAgentCommand(agentId, ownerToken, 'policy.local.run_once', {
      ...policyRunPayload({ checkReadiness, dispatch, mark }),
    });
    if (result.status !== 'ok') {
      setBusy(null);
      setError(result.message || result.code);
      onToast && onToast(result.message || result.code || 'Policy run failed', 'var(--danger)');
      return;
    }
    setLastCommand(result.command_record || null);
    const commandId = result.command?.message_id || result.command_record?.command_id;
    const finalRecord = await pollCommand(commandId);
    setBusy(null);
    const run = finalRecord?.result;
    onToast &&
      onToast(
        run?.mode
          ? `Policy ${run.mode}: ${run.planned_task_count ?? 0} planned, ${
              run.blocked_task_count ?? 0
            } blocked`
          : 'Policy run queued',
        run?.status === 'blocked' || run?.status === 'error' ? 'var(--warn)' : 'var(--accent)'
      );
  }

  async function seedLocalPolicy() {
    if (!requireOwnerToken('Seed policy')) return;
    setBusy('policy-seed');
    setError(null);
    const result = await submitLocalAgentCommand(
      agentId,
      ownerToken,
      'policy.local.add',
      seedPolicyPayload()
    );
    if (result.status !== 'ok') {
      setBusy(null);
      setError(result.message || result.code);
      onToast && onToast(result.message || result.code || 'Policy add failed', 'var(--danger)');
      return;
    }
    setLastCommand(result.command_record || null);
    const commandId = result.command?.message_id || result.command_record?.command_id;
    const finalRecord = await pollCommand(commandId);
    setBusy(null);
    const added = finalRecord?.result;
    if (added?.policy) mergeLocalPolicy(added.policy);
    onToast &&
      onToast(
        added?.policy?.policy_id
          ? `Local policy registered: ${added.policy.policy_id}`
          : 'Policy add queued',
        added?.status === 'ok' ? 'var(--safe)' : 'var(--warn)'
      );
  }

  async function listLocalPolicies() {
    if (!requireOwnerToken('Policy list')) return;
    setBusy('policy-list');
    setError(null);
    const result = await submitLocalAgentCommand(agentId, ownerToken, 'policy.local.list', {});
    if (result.status !== 'ok') {
      setBusy(null);
      setError(result.message || result.code);
      onToast && onToast(result.message || result.code || 'Policy list failed', 'var(--danger)');
      return;
    }
    setLastCommand(result.command_record || null);
    const commandId = result.command?.message_id || result.command_record?.command_id;
    const finalRecord = await pollCommand(commandId);
    setBusy(null);
    const store = finalRecord?.result;
    updateLocalPolicyStore(store);
    onToast &&
      onToast(
        store?.policy_count === undefined
          ? 'Policy list queued'
          : `Local policies: ${store.policy_count} total, ${store.active_count ?? 0} active`,
        store?.status === 'ok' || store?.status === 'partial' ? 'var(--accent)' : 'var(--warn)'
      );
  }

  async function runPolicyLoop(action) {
    if (!requireOwnerToken('Policy loop')) return;
    const commandType =
      action === 'start'
        ? 'policy.local.loop.start'
        : action === 'stop'
          ? 'policy.local.loop.stop'
          : action === 'run-now'
            ? 'policy.local.loop.run_now'
            : 'policy.local.loop.status';
    const payload =
      action === 'start'
        ? policyLoopPayload()
        : action === 'run-now'
          ? policyRunPayload({
              checkReadiness: true,
              dispatch: dispatchArmed,
              mark: dispatchArmed,
            })
          : action === 'stop'
            ? { reason: 'dashboard' }
            : {};
    setBusy(`policy-loop-${action}`);
    setError(null);
    const result = await submitLocalAgentCommand(agentId, ownerToken, commandType, payload);
    if (result.status !== 'ok') {
      setBusy(null);
      setError(result.message || result.code);
      onToast &&
        onToast(result.message || result.code || 'Policy loop command failed', 'var(--danger)');
      return;
    }
    setLastCommand(result.command_record || null);
    const commandId = result.command?.message_id || result.command_record?.command_id;
    const finalRecord = await pollCommand(commandId);
    updateLoopStateFromRecord(finalRecord);
    setBusy(null);
    const loop = finalRecord?.result?.policy_loop;
    onToast &&
      onToast(
        loop?.status
          ? `Policy loop ${loop.status} · ${loop.run_count ?? 0} runs`
          : 'Policy loop command queued',
        loop?.status === 'running' ? 'var(--safe)' : 'var(--accent)'
      );
  }

  async function loadWalletRefs() {
    if (!requireOwnerToken('Wallet refs')) return;
    setBusy('wallet-refs');
    setError(null);
    const result = await submitLocalAgentCommand(agentId, ownerToken, 'wallet.refs', {});
    if (result.status !== 'ok') {
      setBusy(null);
      setError(result.message || result.code);
      onToast && onToast(result.message || result.code || 'Wallet refs failed', 'var(--danger)');
      return;
    }
    setLastCommand(result.command_record || null);
    const commandId = result.command?.message_id || result.command_record?.command_id;
    const finalRecord = await pollCommand(commandId);
    setBusy(null);
    const refs = finalRecord?.result;
    onToast &&
      onToast(
        refs?.wallet_count === undefined
          ? 'Wallet refs queued'
          : `Wallet refs: ${refs.wallet_count} wallets, ${refs.account_count ?? 0} accounts`,
        refs?.status === 'ok' ? 'var(--safe)' : 'var(--accent)'
      );
  }

  async function loadAuthorizationState() {
    if (!requireOwnerToken('Authorization state')) return;
    setBusy('authorization-state');
    setError(null);
    const result = await submitLocalAgentCommand(agentId, ownerToken, 'authorization.state', {});
    if (result.status !== 'ok') {
      setBusy(null);
      setError(result.message || result.code);
      onToast &&
        onToast(result.message || result.code || 'Authorization state failed', 'var(--danger)');
      return;
    }
    setLastCommand(result.command_record || null);
    const commandId = result.command?.message_id || result.command_record?.command_id;
    const finalRecord = await pollCommand(commandId);
    setBusy(null);
    const snapshot = finalRecord?.result;
    if (snapshot?.states) {
      setAuthorizationSnapshot(snapshot);
      const options = authorizationRevokeOptionsFromSnapshot(snapshot);
      if (!authRevokeTarget && options[0]) setAuthRevokeTarget(options[0].value);
      const rotateOptions = authorizationRotateOptionsFromSnapshot(snapshot);
      if (!authRotateTarget && rotateOptions[0]) setAuthRotateTarget(rotateOptions[0].value);
    }
    const blockedCount = Array.isArray(snapshot?.states)
      ? snapshot.states.filter((state) => state.status === 'blocked' || state.status === 'missing')
          .length
      : 0;
    onToast &&
      onToast(
        snapshot?.state_count === undefined
          ? 'Authorization state queued'
          : `Authorization state: ${snapshot.state_count} venues · ${blockedCount} blocked`,
        blockedCount ? 'var(--warn)' : 'var(--accent)'
      );
  }

  async function revokeLocalAuthorization() {
    if (!requireOwnerToken('Authorization revoke')) return;
    if (!authRevokeTarget) {
      setError('Select a local authorization target first.');
      onToast && onToast('Select a local authorization target first', 'var(--warn)');
      return;
    }
    if (!authRevokeConfirm) {
      setError('Confirm local authorization revoke first.');
      onToast && onToast('Confirm local authorization revoke first', 'var(--warn)');
      return;
    }
    const [kind, first, second] = authRevokeTarget.split('|');
    const payload =
      kind === 'key'
        ? {
            venue_id: first,
            key_handle: second,
            reason: 'dashboard_local_authorization_revoke',
            confirm: true,
          }
        : {
            wallet_id: first,
            reason: 'dashboard_local_authorization_revoke',
            confirm: true,
          };
    setBusy('authorization-revoke');
    setError(null);
    const result = await submitLocalAgentCommand(
      agentId,
      ownerToken,
      'authorization.revoke',
      payload
    );
    if (result.status !== 'ok') {
      setBusy(null);
      setError(result.message || result.code);
      onToast &&
        onToast(result.message || result.code || 'Authorization revoke failed', 'var(--danger)');
      return;
    }
    setLastCommand(result.command_record || null);
    const commandId = result.command?.message_id || result.command_record?.command_id;
    const finalRecord = await pollCommand(commandId);
    if (finalRecord?.result_status !== 'ok') {
      setBusy(null);
      setError(finalRecord?.result?.message || finalRecord?.result?.code || 'Revoke failed');
      onToast &&
        onToast(
          finalRecord?.result?.message || finalRecord?.result?.code || 'Revoke failed',
          'var(--danger)'
        );
      return;
    }
    const stateResult = await submitLocalAgentCommand(
      agentId,
      ownerToken,
      'authorization.state',
      {}
    );
    if (stateResult.status === 'ok') {
      const stateCommandId =
        stateResult.command?.message_id || stateResult.command_record?.command_id;
      const stateRecord = await pollCommand(stateCommandId);
      if (stateRecord?.result?.states) setAuthorizationSnapshot(stateRecord.result);
    }
    setAuthRevokeConfirm(false);
    setBusy(null);
    onToast &&
      onToast(
        `Local authorization revoked: ${finalRecord?.result?.authorization_ref || first}`,
        'var(--warn)'
      );
  }

  async function rotateLocalAuthorization() {
    if (!requireOwnerToken('Authorization rotate')) return;
    if (!authRotateTarget) {
      setError('Select a local venue key first.');
      onToast && onToast('Select a local venue key first', 'var(--warn)');
      return;
    }
    if (!authRotateConfirm) {
      setError('Confirm venue key rotation first.');
      onToast && onToast('Confirm venue key rotation first', 'var(--warn)');
      return;
    }
    const [kind, venueId, keyHandle] = authRotateTarget.split('|');
    if (kind !== 'key' || !venueId || !keyHandle) {
      setError('Select a venue key authorization target.');
      onToast && onToast('Select a venue key authorization target', 'var(--warn)');
      return;
    }
    setBusy('authorization-rotate');
    setError(null);
    const result = await submitLocalAgentCommand(agentId, ownerToken, 'authorization.rotate', {
      venue_id: venueId,
      key_handle: keyHandle,
      rotated_at: new Date().toISOString(),
      reason: 'dashboard_local_key_rotation',
      confirm: true,
    });
    if (result.status !== 'ok') {
      setBusy(null);
      setError(result.message || result.code);
      onToast &&
        onToast(result.message || result.code || 'Authorization rotate failed', 'var(--danger)');
      return;
    }
    setLastCommand(result.command_record || null);
    const commandId = result.command?.message_id || result.command_record?.command_id;
    const finalRecord = await pollCommand(commandId);
    if (finalRecord?.result_status !== 'ok') {
      setBusy(null);
      setError(finalRecord?.result?.message || finalRecord?.result?.code || 'Rotate failed');
      onToast &&
        onToast(
          finalRecord?.result?.message || finalRecord?.result?.code || 'Rotate failed',
          'var(--danger)'
        );
      return;
    }
    const stateResult = await submitLocalAgentCommand(
      agentId,
      ownerToken,
      'authorization.state',
      {}
    );
    if (stateResult.status === 'ok') {
      const stateCommandId =
        stateResult.command?.message_id || stateResult.command_record?.command_id;
      const stateRecord = await pollCommand(stateCommandId);
      if (stateRecord?.result?.states) setAuthorizationSnapshot(stateRecord.result);
    }
    setAuthRotateConfirm(false);
    setBusy(null);
    onToast &&
      onToast(
        `Local rotation metadata updated: ${finalRecord?.result?.authorization_ref || keyHandle}`,
        'var(--accent)'
      );
  }

  async function revokeBridge() {
    if (!requireOwnerToken('Bridge revoke')) return;
    setBusy('revoke');
    setError(null);
    const result = await revokeLocalAgent(agentId, ownerToken);
    setBusy(null);
    if (result.status !== 'ok') {
      setError(result.message || result.code);
      onToast && onToast(result.message || result.code || 'Bridge revoke failed', 'var(--danger)');
      return;
    }
    setLastCommand(null);
    setCommands([]);
    updateOwnerToken('');
    await refreshBridge({ withCommands: false });
    onToast && onToast('Local daemon bridge revoked', 'var(--danger)');
  }

  const setupCommand = pairing
    ? `cd agent && node src/index.mjs --pairing-code ${pairing.pairing_code} --worker-url ${WORKER_BASE_URL || 'http://localhost:8787'} --agent-id ${agentId || 'default'} --agent-cmd "codex"`
    : null;
  const commandRows = commands.slice(0, 4);
  const sessionRows = sessions.slice(0, 4);
  const activityEvents = Array.isArray(lastCommand?.result?.events)
    ? lastCommand.result.events.slice(0, 3)
    : [];
  const policyResultSource = lastCommand?.type?.startsWith('policy.local.loop.')
    ? lastCommand?.result?.result
    : lastCommand?.type === 'policy.local.run_once'
      ? lastCommand?.result
      : null;
  const policyRunResults = Array.isArray(policyResultSource?.results)
    ? policyResultSource.results.slice(0, 3)
    : [];
  const walletRefRows =
    lastCommand?.type === 'wallet.refs' && Array.isArray(lastCommand?.result?.wallets)
      ? lastCommand.result.wallets.slice(0, 3)
      : [];
  const authorizationStateRows = Array.isArray(authorizationSnapshot?.states)
    ? authorizationSnapshot.states.slice(0, 4)
    : [];
  const authorizationRevokeOptions = authorizationRevokeOptionsFromSnapshot(authorizationSnapshot);
  const authorizationRotateOptions = authorizationRotateOptionsFromSnapshot(authorizationSnapshot);
  const localPolicyRows = localPolicies.slice(0, 4);
  const visibleLoop = loopState || lastCommand?.result?.policy_loop || null;
  const visibleLoopSummary = visibleLoop?.last_run?.summary;
  const lastLoopPlannedCount =
    lastCommand?.result?.result?.planned_task_count ??
    lastCommand?.result?.policy_loop?.last_run?.summary?.planned_task_count ??
    0;

  return (
    <div
      style={{
        background: 'var(--glass)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        padding: 15,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="card-title">Worker bridge</div>
          <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 3 }}>
            Pairing, status and command-result polling for the local daemon.
          </div>
        </div>
        <span className={`badge ${bridgeBadge}`} style={{ fontSize: 9 }}>
          <span className={bridgeStatus === 'online' ? 'dot pulse' : 'dot'}></span>
          {bridgeStatus}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span className="eyebrow" style={{ fontSize: 9 }}>
            Agent id
          </span>
          <input
            value={agentId}
            onChange={(e) => updateAgentId(e.target.value)}
            className="mono"
            style={{
              height: 34,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-1)',
              color: 'var(--t0)',
              padding: '0 10px',
              fontSize: 12,
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span className="eyebrow" style={{ fontSize: 9 }}>
            Owner control token
          </span>
          <input
            value={ownerToken}
            type="password"
            onChange={(e) => updateOwnerToken(e.target.value)}
            className="mono"
            style={{
              height: 34,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-1)',
              color: 'var(--t0)',
              padding: '0 10px',
              fontSize: 12,
            }}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <Button
          size="sm"
          className="rg-btn-2"
          isDisabled={!WORKER_CONFIGURED || busy}
          onPress={createPairing}
        >
          <Icon name="link" size={13} /> Pair daemon
        </Button>
        <Button
          size="sm"
          className="rg-btn-2"
          isDisabled={!WORKER_CONFIGURED || busy}
          onPress={() => refreshBridge({ withCommands: Boolean(ownerToken) })}
        >
          <Icon name="activity" size={13} /> Refresh
        </Button>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={probeAgent}
            onChange={(e) => setProbeAgent(e.target.value)}
            className="mono"
            style={{
              width: 88,
              height: 32,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-1)',
              color: 'var(--t0)',
              padding: '0 9px',
              fontSize: 11,
            }}
          />
          <Button
            size="sm"
            className="bg-accent text-accent-foreground font-semibold"
            isDisabled={!WORKER_CONFIGURED || busy || !ownerToken}
            onPress={runProbe}
          >
            <Icon name="radar" size={13} /> Probe
          </Button>
        </div>
        <Button
          size="sm"
          className="rg-btn-2"
          isDisabled={!WORKER_CONFIGURED || busy || !ownerToken}
          onPress={tailActivity}
        >
          <Icon name="activity" size={13} /> Activity
        </Button>
        <Button
          size="sm"
          className="rg-btn-2"
          isDisabled={!WORKER_CONFIGURED || busy || !ownerToken}
          onPress={loadWalletRefs}
        >
          <Icon name="wallet" size={13} /> Wallets
        </Button>
        <Button
          size="sm"
          className="rg-btn-2"
          isDisabled={!WORKER_CONFIGURED || busy || !ownerToken}
          onPress={loadAuthorizationState}
        >
          <Icon name="shield" size={13} /> Auth state
        </Button>
        <Button
          size="sm"
          className="rg-btn-2"
          isDisabled={!WORKER_CONFIGURED || busy || !ownerToken}
          onPress={seedLocalPolicy}
        >
          <Icon name="plus" size={13} /> Seed policy
        </Button>
        <Button
          size="sm"
          className="rg-btn-2"
          isDisabled={!WORKER_CONFIGURED || busy || !ownerToken}
          onPress={listLocalPolicies}
        >
          <Icon name="grid" size={13} /> Policies
        </Button>
        <Button
          size="sm"
          className="rg-btn-2"
          isDisabled={!WORKER_CONFIGURED || busy || !ownerToken}
          onPress={() => runPolicyOnce({ checkReadiness: false })}
        >
          <Icon name="grid" size={13} /> Plan
        </Button>
        <Button
          size="sm"
          className="rg-btn-2"
          isDisabled={!WORKER_CONFIGURED || busy || !ownerToken}
          onPress={() => runPolicyOnce({ checkReadiness: true })}
        >
          <Icon name="shield" size={13} /> Preflight
        </Button>
        <Button
          size="sm"
          className="rg-btn-danger-2"
          isDisabled={!WORKER_CONFIGURED || busy || !ownerToken || !dispatchArmed}
          onPress={() => runPolicyOnce({ checkReadiness: true, dispatch: true, mark: true })}
        >
          <Icon name="bolt" size={13} /> Dispatch
        </Button>
        <Button
          size="sm"
          className="rg-btn-danger-2"
          isDisabled={!WORKER_CONFIGURED || busy || !ownerToken}
          onPress={revokeBridge}
        >
          <Icon name="x" size={13} /> Revoke
        </Button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 8,
          marginTop: 12,
          padding: 10,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-0)',
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <input
            type="checkbox"
            checked={useLiveMarket}
            onChange={(e) => setUseLiveMarket(e.target.checked)}
          />
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--t1)' }}>
            live market
          </span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <input
            type="checkbox"
            checked={useLiveInventory}
            onChange={(e) => setUseLiveInventory(e.target.checked)}
          />
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--t1)' }}>
            live inventory
          </span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <input
            type="checkbox"
            checked={requireSignerProbe}
            onChange={(e) => updateRequireSignerProbe(e.target.checked)}
          />
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--t1)' }}>
            signer probe
          </span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <input
            type="checkbox"
            checked={dispatchArmed}
            onChange={(e) => setDispatchArmed(e.target.checked)}
          />
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--t1)' }}>
            dispatch armed
          </span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="eyebrow" style={{ fontSize: 8.5 }}>
            Market venues
          </span>
          <input
            value={marketVenues}
            onChange={(e) => setMarketVenues(e.target.value)}
            className="mono"
            style={{
              height: 30,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-1)',
              color: 'var(--t0)',
              padding: '0 8px',
              fontSize: 10.5,
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="eyebrow" style={{ fontSize: 8.5 }}>
            Symbols
          </span>
          <input
            value={marketSymbols}
            onChange={(e) => setMarketSymbols(e.target.value)}
            className="mono"
            style={{
              height: 30,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-1)',
              color: 'var(--t0)',
              padding: '0 8px',
              fontSize: 10.5,
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="eyebrow" style={{ fontSize: 8.5 }}>
            Signer timeout
          </span>
          <input
            value={signerTimeoutMs}
            type="number"
            min="1000"
            step="1000"
            onChange={(e) => updateSignerTimeoutMs(e.target.value)}
            className="mono"
            style={{
              height: 30,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-1)',
              color: 'var(--t0)',
              padding: '0 8px',
              fontSize: 10.5,
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="eyebrow" style={{ fontSize: 8.5 }}>
            Loop seconds
          </span>
          <input
            value={loopIntervalSec}
            type="number"
            min="5"
            step="5"
            onChange={(e) => setLoopIntervalSec(e.target.value)}
            className="mono"
            style={{
              height: 30,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-1)',
              color: 'var(--t0)',
              padding: '0 8px',
              fontSize: 10.5,
            }}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <Button
          size="sm"
          className="rg-btn-2"
          isDisabled={!WORKER_CONFIGURED || busy || !ownerToken}
          onPress={() => runPolicyLoop('status')}
        >
          <Icon name="activity" size={13} /> Loop status
        </Button>
        <Button
          size="sm"
          className="rg-btn-2"
          isDisabled={!WORKER_CONFIGURED || busy || !ownerToken}
          onPress={() => runPolicyLoop('start')}
        >
          <Icon name="refresh" size={13} /> Start loop
        </Button>
        <Button
          size="sm"
          className="rg-btn-2"
          isDisabled={!WORKER_CONFIGURED || busy || !ownerToken}
          onPress={() => runPolicyLoop('run-now')}
        >
          <Icon name="bolt" size={13} /> Run now
        </Button>
        <Button
          size="sm"
          className="rg-btn-danger-2"
          isDisabled={!WORKER_CONFIGURED || busy || !ownerToken}
          onPress={() => runPolicyLoop('stop')}
        >
          <Icon name="pause" size={13} /> Stop loop
        </Button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
          marginTop: 10,
          padding: 10,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-0)',
          alignItems: 'end',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="eyebrow" style={{ fontSize: 8.5 }}>
            Local auth
          </span>
          <select
            value={authRevokeTarget}
            onChange={(e) => {
              setAuthRevokeTarget(e.target.value);
              setAuthRevokeConfirm(false);
            }}
            className="mono"
            style={{
              height: 30,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-1)',
              color: 'var(--t0)',
              padding: '0 8px',
              fontSize: 10.5,
            }}
          >
            <option value="">Load auth state</option>
            {authorizationRevokeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} · {option.status}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 30 }}>
          <input
            type="checkbox"
            checked={authRevokeConfirm}
            onChange={(e) => setAuthRevokeConfirm(e.target.checked)}
          />
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--t1)' }}>
            confirm revoke
          </span>
        </label>
        <Button
          size="sm"
          className="rg-btn-danger-2"
          isDisabled={
            !WORKER_CONFIGURED || busy || !ownerToken || !authRevokeTarget || !authRevokeConfirm
          }
          onPress={revokeLocalAuthorization}
        >
          <Icon name="x" size={13} /> Revoke auth
        </Button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
          marginTop: 8,
          padding: 10,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-0)',
          alignItems: 'end',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="eyebrow" style={{ fontSize: 8.5 }}>
            Key rotation
          </span>
          <select
            value={authRotateTarget}
            onChange={(e) => {
              setAuthRotateTarget(e.target.value);
              setAuthRotateConfirm(false);
            }}
            className="mono"
            style={{
              height: 30,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-1)',
              color: 'var(--t0)',
              padding: '0 8px',
              fontSize: 10.5,
            }}
          >
            <option value="">Load auth state</option>
            {authorizationRotateOptions.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label} · {option.status}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 30 }}>
          <input
            type="checkbox"
            checked={authRotateConfirm}
            onChange={(e) => setAuthRotateConfirm(e.target.checked)}
          />
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--t1)' }}>
            confirm rotated
          </span>
        </label>
        <Button
          size="sm"
          className="rg-btn-2"
          isDisabled={
            !WORKER_CONFIGURED || busy || !ownerToken || !authRotateTarget || !authRotateConfirm
          }
          onPress={rotateLocalAuthorization}
        >
          <Icon name="refresh" size={13} /> Mark rotated
        </Button>
      </div>

      <AuthorizationReadinessPanel snapshot={authorizationSnapshot} />

      {visibleLoop && (
        <div
          style={{
            marginTop: 10,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 7,
          }}
        >
          {[
            ['Loop', visibleLoop.status],
            ['Runs', visibleLoop.run_count ?? 0],
            ['Interval', `${Math.round((visibleLoop.options?.interval_ms || 0) / 1000)}s`],
            ['Dispatch', visibleLoop.options?.dispatch ? 'armed' : 'preflight'],
            ['Market', visibleLoop.options?.live_market ? 'public' : 'snapshot'],
            [
              'Last',
              visibleLoopSummary
                ? `${visibleLoopSummary.status || 'run'} · ${visibleLoopSummary.planned_task_count ?? 0}/${visibleLoopSummary.blocked_task_count ?? 0}`
                : 'none',
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--glass)',
                padding: '8px 9px',
              }}
            >
              <div className="eyebrow" style={{ fontSize: 8 }}>
                {label}
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: 'var(--t1)', marginTop: 3 }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      {sessionRows.length > 0 && (
        <div style={{ marginTop: 12, display: 'grid', gap: 7 }}>
          {sessionRows.map((session) => (
            <button
              type="button"
              key={session.agent_id}
              onClick={() => updateAgentId(session.agent_id)}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(110px, 1fr) auto auto',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                minHeight: 34,
                borderRadius: 8,
                border: `1px solid ${session.agent_id === agentId ? 'var(--accent)' : 'var(--border)'}`,
                background: 'var(--glass)',
                color: 'var(--t0)',
                padding: '7px 9px',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span className="mono" style={{ fontSize: 10.5 }}>
                {session.agent_id}
              </span>
              <span className="mono" style={{ color: 'var(--t2)', fontSize: 10 }}>
                {session.device_name || 'local-daemon'}
              </span>
              <span
                className={`badge ${session.session_status === 'online' ? 'badge-safe' : session.session_status === 'revoked' ? 'badge-danger' : 'badge-neutral'}`}
                style={{ fontSize: 8.5 }}
              >
                {session.session_status || 'unknown'}
              </span>
            </button>
          ))}
        </div>
      )}

      {pairing && (
        <div
          style={{
            marginTop: 12,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-0)',
            padding: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span className="badge badge-accent" style={{ fontSize: 9 }}>
              {pairing.pairing_code}
            </span>
            <span className="mono" style={{ color: 'var(--t2)', fontSize: 10 }}>
              expires {pairing.expires_at}
            </span>
            <div style={{ flex: 1 }} />
            <CopyChip label="copy command" text="copy" full={setupCommand} />
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--t1)', lineHeight: 1.5 }}>
            {setupCommand}
          </div>
        </div>
      )}

      {(lastCommand || commandRows.length > 0 || error) && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {error && (
            <div className="badge badge-warn" style={{ justifyContent: 'flex-start' }}>
              {error}
            </div>
          )}
          {lastCommand && (
            <div
              style={{
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--glass)',
                padding: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className={`badge ${lastCommand.command_status === 'result' ? 'badge-safe' : 'badge-warn'}`}
                >
                  {lastCommand.command_status}
                </span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--t2)' }}>
                  {shortId(lastCommand.command_id || lastCommand.idempotency_key)}
                </span>
                <div style={{ flex: 1 }} />
                <span className="mono" style={{ fontSize: 10.5 }}>
                  {lastCommand.result_status || lastCommand.type}
                </span>
              </div>
              {lastCommand.result && (
                <div className="mono" style={{ marginTop: 8, fontSize: 10, color: 'var(--t2)' }}>
                  {lastCommand.type === 'activity.tail'
                    ? `${lastCommand.result.event_count ?? 0} local activity events`
                    : lastCommand.type === 'wallet.refs'
                      ? `${lastCommand.result.wallet_count ?? 0} OWS wallets · ${
                          lastCommand.result.account_count ?? 0
                        } CAIP accounts`
                      : lastCommand.type === 'authorization.state'
                        ? `${lastCommand.result.state_count ?? 0} authorization states · ${
                            lastCommand.result.access_issues?.length ?? 0
                          } access issues`
                        : lastCommand.type === 'authorization.revoke'
                          ? `${lastCommand.result.revoke_target || 'authorization'} · ${
                              lastCommand.result.authorization_ref ||
                              lastCommand.result.wallet_id ||
                              lastCommand.result.key_handle ||
                              'local'
                            } · ${lastCommand.result.live_authority_revoked ? 'live revoked' : 'local only'}`
                          : lastCommand.type === 'authorization.rotate'
                            ? `${lastCommand.result.rotate_target || 'venue_key'} · ${
                                lastCommand.result.authorization_ref ||
                                lastCommand.result.key_handle ||
                                'local'
                              } · ${
                                lastCommand.result.live_authority_rotated
                                  ? 'live rotated'
                                  : 'local proof'
                              }`
                            : lastCommand.type === 'policy.local.add'
                              ? `${lastCommand.result.policy?.policy_id || 'policy'} · ${
                                  lastCommand.result.status
                                } · ${lastCommand.result.policy?.target_venue_ids?.join(',') || 'local'}`
                              : lastCommand.type === 'policy.local.list'
                                ? `${lastCommand.result.policy_count ?? 0} local policies · ${
                                    lastCommand.result.active_count ?? 0
                                  } active · ${lastCommand.result.paused_count ?? 0} paused`
                                : lastCommand.type === 'policy.local.run_once'
                                  ? `${lastCommand.result.mode || 'run'} · planned ${
                                      lastCommand.result.planned_task_count ?? 0
                                    } · ready ${lastCommand.result.ready_task_count ?? 0} · blocked ${
                                      lastCommand.result.blocked_task_count ?? 0
                                    }`
                                  : lastCommand.type?.startsWith('policy.local.loop.')
                                    ? `loop ${
                                        lastCommand.result.policy_loop?.status ||
                                        lastCommand.result.status
                                      } · runs ${lastCommand.result.policy_loop?.run_count ?? 0} · planned ${lastLoopPlannedCount}`
                                    : `probes ${lastCommand.result.probe_count ?? '—'} · blocked ${
                                        lastCommand.result.blocked_count ?? '—'
                                      }`}
                </div>
              )}
              {policyRunResults.length > 0 && (
                <div style={{ marginTop: 8, display: 'grid', gap: 5 }}>
                  {policyRunResults.map((result) => (
                    <div
                      key={
                        result.task_id || `${result.policy_id}-${result.venue_id}-${result.status}`
                      }
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: 'var(--t2)',
                        display: 'grid',
                        gridTemplateColumns: 'auto minmax(72px, 1fr) minmax(70px, 1fr)',
                        gap: 7,
                        alignItems: 'center',
                      }}
                    >
                      <span
                        className={`badge ${
                          result.status === 'ready' || result.status === 'planned'
                            ? 'badge-safe'
                            : 'badge-warn'
                        }`}
                        style={{ fontSize: 8 }}
                      >
                        {result.status || 'result'}
                      </span>
                      <span>{result.venue_id || result.task?.venue_id || 'policy'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {result.local_decision || result.code || result.task_id}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {walletRefRows.length > 0 && (
                <div style={{ marginTop: 8, display: 'grid', gap: 5 }}>
                  {walletRefRows.map((wallet) => (
                    <div
                      key={wallet.wallet_id}
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: 'var(--t2)',
                        display: 'grid',
                        gridTemplateColumns: 'auto minmax(80px, 1fr) minmax(88px, 1fr)',
                        gap: 7,
                        alignItems: 'center',
                      }}
                    >
                      <span className="badge badge-safe" style={{ fontSize: 8 }}>
                        {wallet.status || 'linked'}
                      </span>
                      <span>{wallet.wallet_id}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {wallet.accounts?.length ?? 0} accounts · {wallet.provider || 'ows'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {authorizationStateRows.length > 0 && (
                <div style={{ marginTop: 8, display: 'grid', gap: 5 }}>
                  {authorizationStateRows.map((state) => (
                    <div
                      key={state.venue_id}
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: 'var(--t2)',
                        display: 'grid',
                        gridTemplateColumns:
                          'auto minmax(72px, 1fr) minmax(82px, 1fr) minmax(70px, 1fr)',
                        gap: 7,
                        alignItems: 'center',
                      }}
                    >
                      <span
                        className={`badge ${
                          state.status === 'metadata_ready' || state.status === 'demo_ready'
                            ? 'badge-safe'
                            : state.status === 'blocked' || state.status === 'missing'
                              ? 'badge-warn'
                              : 'badge-neutral'
                        }`}
                        style={{ fontSize: 8 }}
                      >
                        {state.status || 'state'}
                      </span>
                      <span>{state.venue_id}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {state.grant_state?.status || 'grant'} ·{' '}
                        {state.read_state?.status || 'read'}
                      </span>
                      <span
                        className={`badge ${rotationBadgeClass(state.rotation_state?.status)}`}
                        style={{ fontSize: 8, justifySelf: 'end' }}
                      >
                        {state.rotation_state?.status || 'rotation'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {activityEvents.length > 0 && (
                <div style={{ marginTop: 8, display: 'grid', gap: 5 }}>
                  {activityEvents.map((event) => (
                    <div
                      key={event.id || `${event.observed_at}-${event.type}`}
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: 'var(--t2)',
                        display: 'flex',
                        gap: 7,
                        alignItems: 'center',
                      }}
                    >
                      <span className="badge badge-neutral" style={{ fontSize: 8 }}>
                        {event.status || 'event'}
                      </span>
                      <span>{event.venue_id || event.type || 'local_daemon'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {event.summary || event.code || event.task_id || event.observed_at}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {commandRows.length > 0 && (
            <div style={{ display: 'grid', gap: 6 }}>
              {commandRows.map((cmd) => (
                <div
                  key={cmd.command_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 9px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--glass)',
                  }}
                >
                  <span
                    className={`badge ${cmd.command_status === 'result' ? 'badge-safe' : 'badge-neutral'}`}
                  >
                    {cmd.command_status}
                  </span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--t1)' }}>
                    {cmd.type}
                  </span>
                  <div style={{ flex: 1 }} />
                  <span className="mono" style={{ fontSize: 10, color: 'var(--t2)' }}>
                    {cmd.result_status || cmd.payload_summary?.agent_id || shortId(cmd.command_id)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(localPolicyRows.length > 0 || policyStoreSummary) && (
        <div
          style={{
            marginTop: 12,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-0)',
            padding: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span className="card-title" style={{ fontSize: 12 }}>
              Local policy store
            </span>
            <span
              className={`badge ${
                policyStoreSummary?.status === 'ok'
                  ? 'badge-safe'
                  : policyStoreSummary?.status === 'partial'
                    ? 'badge-warn'
                    : 'badge-neutral'
              }`}
              style={{ fontSize: 8.5 }}
            >
              {policyStoreSummary?.status || 'local'}
            </span>
            <div style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 10, color: 'var(--t2)' }}>
              {policyStoreSummary?.policy_count ?? localPolicies.length} total ·{' '}
              {policyStoreSummary?.active_count ??
                localPolicies.filter((p) => p.status === 'active').length}{' '}
              active
            </span>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {localPolicyRows.length > 0 ? (
              localPolicyRows.map((policy) => (
                <div
                  key={policy.policy_id}
                  className="mono"
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'auto minmax(90px, 1fr) minmax(100px, 1.2fr) minmax(58px, auto)',
                    gap: 8,
                    alignItems: 'center',
                    padding: '7px 8px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--glass)',
                    fontSize: 10,
                    color: 'var(--t2)',
                  }}
                >
                  <span
                    className={`badge ${
                      policy.status === 'active'
                        ? 'badge-safe'
                        : policy.status === 'paused'
                          ? 'badge-warn'
                          : 'badge-danger'
                    }`}
                    style={{ fontSize: 8 }}
                  >
                    {policy.status || 'policy'}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {policy.policy_id}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {(policy.target_venue_ids || []).join(',') || 'local'} ·{' '}
                    {policy.target_agent || 'agent'}
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    {Math.round((policy.tick_interval_ms || 0) / 1000) || 0}s
                  </span>
                </div>
              ))
            ) : (
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--t2)' }}>
                No local policies returned by the daemon.
              </div>
            )}
          </div>
        </div>
      )}

      {!WORKER_CONFIGURED && (
        <div style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 10 }}>
          Set <span className="mono">VITE_WORKER_URL</span> to use bridge controls.
        </div>
      )}
    </div>
  );
}

function LocalAgentControl({ data, exchanges = [], onToast }) {
  if (!data) return null;
  const linkedVenues = data.venues.filter((v) => ['live', 'linked'].includes(v.status)).length;
  const targetCount = data.targetCatalog?.readiness?.target_count ?? data.venues.length;
  const metric = (label, value, tone = 'var(--t0)') => (
    <div
      style={{
        background: 'var(--glass)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-sm)',
        padding: '11px 13px',
      }}
    >
      <div className="eyebrow" style={{ fontSize: 9 }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 4, color: tone }}>
        {value}
      </div>
    </div>
  );

  return (
    <div className="card" style={{ padding: 20 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="eyebrow">Local Agent control plane</div>
          <h3 className="display" style={{ fontSize: 18, fontWeight: 600, marginTop: 5 }}>
            Wallet vault, exchange keys and asset inventory
          </h3>
          <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 5, maxWidth: 690 }}>
            The local daemon signs through the OWS vault, keeps the OKX API key in the local secret
            store, connects to the Worker bridge, and normalizes Solana, Ethereum, Hyperliquid and
            OKX inventory before Guardian allows execution.
          </div>
        </div>
        <Button
          size="sm"
          className="rg-btn-2"
          onPress={() =>
            onToast &&
            onToast(
              'Local setup planned: sentry agent init && sentry agent pair <code>',
              'var(--accent)'
            )
          }
        >
          <Icon name="cpu" size={14} /> Setup local
        </Button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 10,
          marginBottom: 16,
        }}
      >
        {metric('OWS wallets', data.vault.wallets, 'var(--accent)')}
        {metric('Policy tokens', data.vault.apiTokens, 'var(--safe)')}
        {metric('OKX keys', data.secretStore.exchangeKeys, 'var(--warn)')}
        {metric('Target venues', targetCount, 'var(--sui)')}
        {metric('Linked/demo', linkedVenues, 'var(--safe)')}
      </div>

      <LocalAgentBridgeCard onToast={onToast} />

      <TargetIntegrationMatrix catalog={data.targetCatalog} />

      <div className="rg-2col" style={{ alignItems: 'stretch', marginBottom: 16 }}>
        <div
          style={{
            background: 'var(--glass)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: 15,
          }}
        >
          <div className="card-title" style={{ marginBottom: 12 }}>
            Open Wallet vault
          </div>
          {[
            ['Standard', data.vault.standard],
            ['Vault path', data.vault.path],
            ['Policies', `${data.vault.policies} local policy files`],
            ['Audit log', data.vault.audit],
          ].map(([k, v]) => (
            <MetaRow key={k} icon="key" label={k}>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--t1)' }}>
                {v}
              </span>
            </MetaRow>
          ))}
        </div>

        <div
          style={{
            background: 'var(--glass)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: 15,
          }}
        >
          <div className="card-title" style={{ marginBottom: 12 }}>
            Local secret store
          </div>
          {[
            ['Storage', data.secretStore.path],
            ['Rotation', data.secretStore.rotation],
            ['Withdrawal keys', 'not accepted'],
            ['Owner unlock', 'interactive or OS keychain'],
          ].map(([k, v]) => (
            <MetaRow key={k} icon="shield" label={k}>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--t1)' }}>
                {v}
              </span>
            </MetaRow>
          ))}
        </div>

        <div
          style={{
            background: 'var(--glass)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: 15,
          }}
        >
          <div className="card-title" style={{ marginBottom: 12 }}>
            Worker bridge
          </div>
          {[
            ['Relay', data.bridge.relay],
            ['Session', data.bridge.session],
            ['Transport', data.bridge.transport],
            ['Heartbeat', `${data.bridge.heartbeat} · stale ${data.bridge.staleAfter}`],
            ['Commands', data.bridge.commandScope],
          ].map(([k, v]) => (
            <MetaRow key={k} icon="activity" label={k}>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--t1)' }}>
                {v}
              </span>
            </MetaRow>
          ))}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 14,
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <div className="card-title" style={{ marginBottom: 10 }}>
            Venue accounts
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr style={{ color: 'var(--t2)' }}>
                {['Venue', 'Authority', 'Custody', 'Assets', 'Status'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: h === 'Venue' ? 'left' : 'right',
                      padding: '8px 10px',
                      fontSize: 9.5,
                      fontFamily: 'var(--f-mono)',
                      fontWeight: 500,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.venues.map((v) => (
                <tr key={v.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '11px 10px' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{v.name}</div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--t2)' }}>
                      {v.kind} · {v.permissions}
                    </div>
                  </td>
                  <td
                    className="mono"
                    style={{ padding: '11px 10px', textAlign: 'right', fontSize: 10.5 }}
                  >
                    {v.authority}
                  </td>
                  <td style={{ padding: '11px 10px', textAlign: 'right', fontSize: 11.5 }}>
                    {v.custody}
                  </td>
                  <td
                    className="mono"
                    style={{ padding: '11px 10px', textAlign: 'right', fontSize: 10.5 }}
                  >
                    {v.assets}
                  </td>
                  <td style={{ padding: '11px 10px', textAlign: 'right' }}>
                    <span className={`badge ${statusClass(v.status)}`} style={{ fontSize: 9 }}>
                      <span className={v.status === 'live' ? 'dot pulse' : 'dot'}></span>
                      {v.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="card-title" style={{ marginBottom: 10 }}>
            Asset sources
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.assetSources.map((s) => (
              <div
                key={s.source}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--glass)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--accent)' }}>
                    <Icon name="radar" size={13} />
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{s.source}</span>
                  <span className={`badge ${statusClass(s.status)}`} style={{ fontSize: 8.5 }}>
                    {s.status}
                  </span>
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--t2)', marginTop: 5 }}>
                  {s.detail} · {s.cadence}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              gap: 9,
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 'var(--r-sm)',
              background: 'var(--safe-dim)',
            }}
          >
            <span style={{ color: 'var(--safe)', flexShrink: 0, marginTop: 1 }}>
              <Icon name="shield" size={14} />
            </span>
            <div style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--t1)' }}>
              OWS API tokens are for Solana/Ethereum wallet signing. OKX API keys stay separate,
              trade-only, and are never reused as wallet credentials.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Profile({
  account,
  holdings,
  policies,
  funding = null,
  live = false,
  readOnly = false,
  loading = false,
  onNav,
  onToast,
  onLogout,
}) {
  const a = account;
  const total = holdings.reduce((s, h) => s + h.value, 0);
  const free = holdings.filter((h) => h.state === 'free').reduce((s, h) => s + h.value, 0);
  const deployed = total - free;
  const freePct = total > 0 ? (free / total) * 100 : 0;
  const animTotal = useAnimatedNumber(total, 700);
  const suiBal = holdings.find((h) => h.sym === 'SUI')?.amount;
  const agentSuiMist = funding?.balances?.SUI_MIST;
  const agentSui = agentSuiMist != null ? Number(agentSuiMist) / 1e9 : null;

  const activePol = policies.filter((p) => p.status === 'active').length;
  const totalCap = policies.reduce((s, p) => s + p.budgetCap, 0);
  const usedCap = policies.reduce((s, p) => s + p.budgetUsed, 0);

  const tokenColor = { SUI: 'var(--sui)', USDC: '#3fa0ff', DEEP: 'var(--safe)', WAL: '#7d8bff' };
  const advisory = (
    <span className="badge badge-neutral" style={{ fontSize: 9, marginLeft: 6 }}>
      advisory
    </span>
  );

  return (
    <div
      style={{
        maxWidth: 1000,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      {/* ---------- identity header ---------- */}
      <div className="card" style={{ padding: 24, overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(420px 200px at 88% -40%, var(--accent-dim), transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 18,
                background: 'linear-gradient(135deg,#2EE6CE,#5AA6FF)',
                color: '#06231f',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 22,
                fontFamily: 'var(--f-mono)',
                boxShadow: '0 8px 28px -8px var(--accent-glow)',
              }}
            >
              {a.avatar}
            </div>
            <div
              style={{
                position: 'absolute',
                bottom: -4,
                right: -4,
                width: 24,
                height: 24,
                borderRadius: 8,
                background: 'var(--bg-2)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--sui)',
              }}
            >
              <Icon name={live ? 'wallet' : 'mail'} size={13} />
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2
                className="display mono"
                style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}
              >
                {a.handle}
              </h2>
              <span className="badge badge-sui" style={{ fontSize: 10 }}>
                <Icon name="shield" size={11} />{' '}
                {readOnly ? 'read-only Worker' : live ? 'wallet connected' : 'zkLogin verified'}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                marginTop: 7,
                color: 'var(--t2)',
                fontSize: 12.5,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name={live ? 'wallet' : 'mail'} size={13} />{' '}
                {readOnly
                  ? `${a.provider} · Testnet read surfaces`
                  : live
                    ? `${a.provider} · testnet`
                    : `${a.provider} · ${a.email}`}
              </span>
              {a.memberSince && (
                <>
                  <span style={{ color: 'var(--t3)' }}>•</span>
                  <span>Member since {a.memberSince}</span>
                </>
              )}
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <div
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}
          >
            <div className="badge badge-safe">
              <span className="dot pulse"></span>
              {a.network}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CopyChip text={a.addr} full={a.fullAddr} />
              <Button
                size="sm"
                variant="light"
                className="text-[color:var(--sui)]"
                onPress={() => {
                  if (live && a.fullAddr)
                    window.open(
                      'https://suiscan.xyz/testnet/account/' + a.fullAddr,
                      '_blank',
                      'noopener,noreferrer'
                    );
                  else onToast && onToast('Connect a wallet to view it on SuiScan', 'var(--sui)');
                }}
              >
                <Icon name="link" size={13} /> SuiScan
              </Button>
              {onLogout && (
                <Button
                  size="sm"
                  variant="light"
                  className="text-[color:var(--danger)]"
                  title="Log out"
                  onPress={onLogout}
                >
                  <Icon name="logout" size={13} /> Sign out
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- balance hero ---------- */}
      <div className="card" style={{ padding: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 20,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="eyebrow">Total balance{live && advisory}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 8 }}>
              <span
                className="mono display"
                style={{ fontSize: 42, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1 }}
              >
                ${fmtUsd(animTotal)}
              </span>
              {!live && (
                <span
                  className="mono"
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: RG.portfolio.chg24h < 0 ? 'var(--danger)' : 'var(--safe)',
                  }}
                >
                  <Icon
                    name={RG.portfolio.chg24h < 0 ? 'arrowDown' : 'arrowUp'}
                    size={14}
                    style={{ verticalAlign: -2 }}
                  />
                  {RG.portfolio.chg24h}% · 24h
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button
              size="sm"
              className="bg-accent text-accent-foreground font-semibold"
              onPress={() =>
                onToast &&
                onToast('Deposit address copied — send USDC or SUI on Sui', 'var(--accent)')
              }
            >
              <Icon name="arrowDown" size={14} stroke={2.2} /> Deposit
            </Button>
            <Button
              size="sm"
              className="rg-btn-2"
              onPress={() =>
                onToast &&
                onToast(
                  live
                    ? 'Withdrawals are signed in your wallet'
                    : 'Withdrawals require your zkLogin signature',
                  'var(--sui)'
                )
              }
            >
              <Icon name="arrowUp" size={14} stroke={2.2} /> Withdraw
            </Button>
          </div>
        </div>

        {/* free vs deployed split */}
        <div style={{ marginTop: 22 }}>
          <div
            style={{
              height: 10,
              borderRadius: 100,
              overflow: 'hidden',
              display: 'flex',
              background: 'var(--bg-0)',
            }}
          >
            <div
              style={{
                width: `${freePct}%`,
                background: 'linear-gradient(90deg,var(--accent),#1fc7b1)',
                boxShadow: '0 0 12px var(--accent-glow)',
              }}
            />
            <div style={{ width: `${100 - freePct}%`, background: 'var(--sui)', opacity: 0.85 }} />
          </div>
          <div style={{ display: 'flex', gap: 28, marginTop: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 3,
                  background: 'var(--accent)',
                  flexShrink: 0,
                }}
              />
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--t2)' }}>Free budget</div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>
                  ${fmtUsd(free, 0)}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 3,
                  background: 'var(--sui)',
                  flexShrink: 0,
                }}
              />
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--t2)' }}>Deployed by agent</div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>
                  ${fmtUsd(deployed, 0)}
                </div>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div
              style={{
                maxWidth: 280,
                fontSize: 11.5,
                color: 'var(--t2)',
                lineHeight: 1.5,
                alignSelf: 'center',
              }}
            >
              Funds stay in your wallet. The agent can only trade what your policies authorize —
              never withdraw.
            </div>
          </div>
        </div>
      </div>

      {/* ---------- holdings + side ---------- */}
      <div className="rg-dashgrid">
        {/* holdings table */}
        <div className="card">
          <div className="card-hd" style={{ paddingBottom: 12 }}>
            <div className="card-title">Assets{live && advisory}</div>
            <div className="badge badge-neutral">{holdings.length} tokens</div>
          </div>
          <div style={{ padding: '0 6px 10px' }}>
            {loading && (
              <div style={{ padding: '14px 12px', fontSize: 12.5, color: 'var(--t2)' }}>
                Loading balances…
              </div>
            )}
            {!loading && holdings.length === 0 && (
              <div style={{ padding: '14px 12px', fontSize: 12.5, color: 'var(--t2)' }}>
                No token balances in this wallet.
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--t2)' }}>
                  {['Asset', 'Balance', 'Price', 'Value', 'Allocation'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: h === 'Asset' ? 'left' : 'right',
                        padding: '8px 12px',
                        fontSize: 10.5,
                        fontFamily: 'var(--f-mono)',
                        fontWeight: 500,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const pr = RG.prices[h.sym] || { usd: h.price ?? 0, chg: 0 };
                  const price = h.price != null ? h.price : pr.usd;
                  const alloc = total > 0 ? (h.value / total) * 100 : 0;
                  return (
                    <tr key={h.sym} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '13px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                          <Token sym={h.sym} size={30} />
                          <div>
                            <div className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
                              {h.sym}
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--t2)' }}>{h.role}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '13px 12px', textAlign: 'right' }} className="mono">
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                          {fmtUsd(h.amount, h.sym === 'DEEP' || h.sym === 'WAL' ? 0 : 2)}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--t2)' }}>{h.sym}</div>
                      </td>
                      <td style={{ padding: '13px 12px', textAlign: 'right' }} className="mono">
                        <div style={{ fontSize: 12.5 }}>
                          ${price < 1 ? price.toFixed(4) : price.toFixed(3)}
                        </div>
                        {!live && (
                          <div
                            style={{
                              fontSize: 10.5,
                              fontWeight: 600,
                              color:
                                pr.chg < 0
                                  ? 'var(--danger)'
                                  : pr.chg > 0
                                    ? 'var(--safe)'
                                    : 'var(--t2)',
                            }}
                          >
                            {pr.chg > 0 ? '+' : ''}
                            {pr.chg}%
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '13px 12px', textAlign: 'right' }} className="mono">
                        <div style={{ fontSize: 13, fontWeight: 600 }}>${fmtUsd(h.value)}</div>
                      </td>
                      <td style={{ padding: '13px 12px', textAlign: 'right', minWidth: 110 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            justifyContent: 'flex-end',
                          }}
                        >
                          <div
                            style={{
                              width: 56,
                              height: 6,
                              background: 'var(--bg-0)',
                              borderRadius: 100,
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${alloc}%`,
                                height: '100%',
                                borderRadius: 100,
                                background: tokenColor[h.sym] || 'var(--accent)',
                              }}
                            />
                          </div>
                          <span
                            className="mono"
                            style={{
                              fontSize: 11,
                              color: 'var(--t1)',
                              width: 30,
                              textAlign: 'right',
                            }}
                          >
                            {alloc.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <FundingReadiness funding={funding} live={live} />
          </div>
        </div>

        {/* side column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* session card — wallet (live) or zkLogin (demo) */}
          <div className="card" style={{ padding: '16px 18px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--sui)' }}>
                  <Icon name={live ? 'wallet' : 'fingerprint'} size={16} />
                </span>
                <div className="card-title">
                  {readOnly
                    ? 'Worker read-only session'
                    : live
                      ? 'Wallet session'
                      : 'zkLogin session'}
                </div>
              </div>
              <span className="badge badge-safe" style={{ fontSize: 9.5 }}>
                <span className="dot pulse"></span>active
              </span>
            </div>
            {live ? (
              <>
                <MetaRow icon="wallet" iconColor="var(--sui)" label="Wallet">
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.provider}</span>
                </MetaRow>
                <MetaRow
                  icon="key"
                  iconColor="var(--accent)"
                  label={readOnly ? 'Read owner' : 'Sui address'}
                >
                  <span
                    className="mono"
                    style={{ fontSize: 12, color: 'var(--sui)', fontWeight: 600 }}
                  >
                    {a.addr}
                  </span>
                </MetaRow>
                <MetaRow icon="shield" label="Network" last>
                  <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
                    Sui Testnet
                  </span>
                </MetaRow>
                <div
                  style={{
                    display: 'flex',
                    gap: 9,
                    marginTop: 12,
                    padding: '10px 12px',
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--glass)',
                  }}
                >
                  <span style={{ color: 'var(--sui)', flexShrink: 0, marginTop: 1 }}>
                    <Icon name="eye" size={14} />
                  </span>
                  <div style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--t1)' }}>
                    {readOnly ? (
                      <>
                        Loaded through the{' '}
                        <strong style={{ color: 'var(--t0)' }}>live local Worker</strong> without
                        wallet signing. Any direct-chain fallback is read-only and explicitly
                        labeled in the app shell.
                      </>
                    ) : (
                      <>
                        Connected via the{' '}
                        <strong style={{ color: 'var(--t0)' }}>Sui wallet standard</strong>. Your
                        keys never leave the wallet; the agent only gets a scoped Policy Object.
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <MetaRow icon="mail" iconColor="var(--sui)" label="Provider">
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.provider}</span>
                </MetaRow>
                <MetaRow icon="wallet" label="Sui address">
                  <span
                    className="mono"
                    style={{ fontSize: 12, color: 'var(--sui)', fontWeight: 600 }}
                  >
                    {a.addr}
                  </span>
                </MetaRow>
                <MetaRow icon="key" iconColor="var(--accent)" label="Ephemeral key">
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--t1)' }}>
                    {a.ephemeralKey}
                  </span>
                </MetaRow>
                <MetaRow icon="clock" iconColor="var(--warn)" label="Session expires">
                  <div>
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {a.sessionExpires}
                    </span>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--t2)' }}>
                      epoch {a.currentEpoch} / {a.maxEpoch}
                    </div>
                  </div>
                </MetaRow>
                <MetaRow icon="shield" label="Address salt" last>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--t1)' }}>
                    {a.salt}
                  </span>
                </MetaRow>
                <div
                  style={{
                    display: 'flex',
                    gap: 9,
                    marginTop: 12,
                    padding: '10px 12px',
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--glass)',
                  }}
                >
                  <span style={{ color: 'var(--sui)', flexShrink: 0, marginTop: 1 }}>
                    <Icon name="eye" size={14} />
                  </span>
                  <div style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--t1)' }}>
                    Your key is derived from your{' '}
                    <strong style={{ color: 'var(--t0)' }}>Google</strong> login + salt via a
                    zero-knowledge proof. No seed phrase, nothing custodial.
                  </div>
                </div>
              </>
            )}
          </div>

          {/* agent authority */}
          <div className="card" style={{ padding: '16px 18px' }}>
            <div className="card-hd" style={{ padding: 0, marginBottom: 14 }}>
              <div className="card-title">Agent authority</div>
              <span style={{ color: 'var(--accent)' }}>
                <Icon name="shield" size={16} />
              </span>
            </div>
            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}
            >
              {[
                { k: 'Active policies', v: activePol, c: 'var(--t0)' },
                { k: 'Authorized', v: '$' + fmtUsd(totalCap, 0), c: 'var(--t0)' },
                { k: 'Deployed', v: '$' + fmtUsd(usedCap, 0), c: 'var(--accent)' },
                { k: 'Free budget', v: '$' + fmtUsd(free, 0), c: 'var(--t0)' },
              ].map((x) => (
                <div
                  key={x.k}
                  style={{
                    background: 'var(--glass)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)',
                    padding: '10px 12px',
                  }}
                >
                  <div className="eyebrow" style={{ fontSize: 9 }}>
                    {x.k}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 16, fontWeight: 600, marginTop: 4, color: x.c }}
                  >
                    {x.v}
                  </div>
                </div>
              ))}
            </div>
            <Button
              size="sm"
              className="rg-btn-2 justify-center"
              fullWidth
              onPress={() => onNav && onNav('policies')}
            >
              <Icon name="settings" size={14} /> Manage policies
            </Button>
          </div>

          {/* gas: live = real self-paid posture; demo = sponsored persona */}
          <div className="card" style={{ padding: '16px 18px' }}>
            <div className="card-hd" style={{ padding: 0, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--warn)' }}>
                  <Icon name="bolt" size={16} />
                </span>
                <div className="card-title">
                  {live ? 'Gas & fees' : 'Gas station'}
                  {live && advisory}
                </div>
              </div>
              <span className="badge badge-warn" style={{ fontSize: 9.5 }}>
                {readOnly ? 'read-only' : live ? 'self-paid' : 'sponsored'}
              </span>
            </div>
            {live ? (
              <>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div className="mono display" style={{ fontSize: 22, fontWeight: 600 }}>
                      {agentSui != null
                        ? agentSui.toFixed(3)
                        : suiBal != null
                          ? suiBal.toFixed(3)
                          : '—'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>
                      {agentSui != null
                        ? 'Agent SUI gas · chain read'
                        : readOnly
                          ? 'SUI at read owner · gas evidence'
                          : 'SUI in wallet · your gas'}
                    </div>
                  </div>
                  <div style={{ width: 1, background: 'var(--border)' }} />
                  <div style={{ flex: 1 }}>
                    <div className="mono display" style={{ fontSize: 22, fontWeight: 600 }}>
                      {activePol}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>
                      agent-run policies
                    </div>
                  </div>
                </div>
                <div
                  style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 12, lineHeight: 1.45 }}
                >
                  {readOnly
                    ? 'No wallet is connected in this validation mode. Gas and balance panels are Worker-backed Testnet reads only; signing or deployment stays unavailable until a wallet connects.'
                    : 'You sign and pay gas from your own wallet. The autonomous agent pays its execution gas from a dedicated key, only within what your policies authorize — no custodial gas station.'}
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div className="mono display" style={{ fontSize: 22, fontWeight: 600 }}>
                      {a.gas?.sponsored ?? '—'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>
                      txns sponsored
                    </div>
                  </div>
                  <div style={{ width: 1, background: 'var(--border)' }} />
                  <div style={{ flex: 1 }}>
                    <div className="mono display" style={{ fontSize: 22, fontWeight: 600 }}>
                      {a.gas?.saved ?? '—'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>
                      SUI gas saved
                    </div>
                  </div>
                </div>
                <div
                  style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 12, lineHeight: 1.45 }}
                >
                  The agent pays fees from the {a.gas?.station || 'Sentry Gas Station'} — you hold
                  no SUI for gas and never sign a fee.
                </div>
              </>
            )}
          </div>
        </div>

        {/* ---------- connected exchanges (demo persona) ---------- */}
        {a.exchanges && a.exchanges.length > 0 && (
          <div className="card" style={{ padding: '16px 18px' }}>
            <div className="card-hd" style={{ padding: 0, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--warn)' }}>
                  <Icon name="swap" size={16} />
                </span>
                <div className="card-title">Connected exchanges</div>
                <span className="badge badge-neutral" style={{ fontSize: 9.5 }}>
                  {a.exchanges.filter((e) => e.status === 'connected').length} linked
                </span>
              </div>
              <Button
                size="sm"
                variant="light"
                className="rg-btn-ghost"
                onPress={() =>
                  onToast &&
                  onToast(
                    'Connect an exchange with a read + trade API key (no withdraw)',
                    'var(--sui)'
                  )
                }
              >
                <Icon name="plus" size={13} /> Connect
              </Button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {a.exchanges.map((ex) => {
                const on = ex.status === 'connected';
                return (
                  <div
                    key={ex.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 'var(--r-md)',
                      background: 'var(--glass)',
                      border: '1px solid var(--border)',
                      opacity: on ? 1 : 0.62,
                    }}
                  >
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 9,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: `linear-gradient(135deg, ${ex.c}, ${ex.c}99)`,
                        color: '#06140f',
                        fontWeight: 700,
                        fontFamily: 'var(--f-display)',
                        fontSize: 15,
                      }}
                    >
                      {ex.name[0]}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{ex.name}</span>
                        <span
                          className={`badge ${on ? 'badge-safe' : 'badge-neutral'}`}
                          style={{ fontSize: 9 }}
                        >
                          <span className={`dot ${on ? 'pulse' : ''}`}></span>
                          {on ? 'live' : 'off'}
                        </span>
                      </div>
                      {on ? (
                        <div
                          className="mono"
                          style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3 }}
                        >
                          ${fmtUsd(ex.balance, 0)}
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          className="rg-btn-2"
                          style={{ marginTop: 5 }}
                          onPress={() =>
                            onToast &&
                            onToast(
                              'Linking ' + ex.name + ' — paste a read + trade API key',
                              'var(--accent)'
                            )
                          }
                        >
                          Link account
                        </Button>
                      )}
                      <div
                        className="mono"
                        style={{ fontSize: 10, color: 'var(--t2)', marginTop: 4 }}
                      >
                        {on ? ex.perms + ' · no withdraw' : 'link to enable CEX arb'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 9,
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 'var(--r-sm)',
                background: 'var(--glass)',
              }}
            >
              <span style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 1 }}>
                <Icon name="shield" size={14} />
              </span>
              <div style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--t1)' }}>
                Exchange keys are <strong style={{ color: 'var(--t0)' }}>read + trade only</strong>{' '}
                — withdrawal is never enabled, so the agent can arbitrage across CEX and on-chain
                venues but can't move funds off an exchange.
              </div>
            </div>
          </div>
        )}
      </div>

      <LocalAgentControl data={a.localAgent} exchanges={a.exchanges || []} onToast={onToast} />
    </div>
  );
}
