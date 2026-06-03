/* ===========================================================
   Sentry — Profile / Wallet screen
   Identity, balances, holdings, session & gas.
   Demo mode shows the zkLogin persona; live mode (wallet connected)
   shows the real address, real balances and a wallet-session card.
   =========================================================== */
import { useState } from 'react';
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

function LocalAgentControl({ data, exchanges = [], onToast }) {
  if (!data) return null;
  const linkedExchanges = exchanges.filter((e) => e.status === 'connected').length;
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
            The local daemon signs through the OWS vault, keeps exchange credentials in the local
            secret store, connects to the Worker bridge, and builds one normalized inventory before
            Guardian allows execution.
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
        {metric('Exchange keys', data.secretStore.exchangeKeys, 'var(--warn)')}
        {metric('Linked venues', linkedExchanges, 'var(--sui)')}
      </div>

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
              OWS API tokens are for wallet signing. Exchange API keys stay separate, trade-only,
              and are never reused as wallet credentials.
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
