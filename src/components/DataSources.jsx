import { RG } from '../data.js';
import { Icon } from './Primitives.jsx';
import { useFeedTestMutation } from '../queries/feeds.js';

const ACCESS_META = {
  live: {
    c: 'var(--safe)',
    label: 'Live · direct',
    note: 'Public, CORS-open — the browser fetches it directly.',
  },
  mixed: {
    c: 'var(--sui)',
    label: 'Live · per-venue',
    note: 'Most venues are public; a few need a light proxy.',
  },
  proxy: {
    c: 'var(--warn)',
    label: 'Backend proxy',
    note: 'Needs a server: API keys, signing or a non-CORS venue.',
  },
};
const GROUP_ICON = {
  'Market data': 'percent',
  'On-chain': 'layers',
  Derivatives: 'swap',
  Execution: 'bolt',
};

function FeedTestButton({ feed }) {
  const testFeedMutation = useFeedTestMutation();
  const state = testFeedMutation.isPending
    ? 'testing'
    : testFeedMutation.isSuccess
      ? 'ok'
      : testFeedMutation.isError
        ? 'err'
        : 'idle';
  const result = testFeedMutation.isSuccess
    ? `${testFeedMutation.data.summary} · ${testFeedMutation.data.ms}ms`
    : testFeedMutation.isError
      ? `${testFeedMutation.error?.message || testFeedMutation.error} — may be rate-limited; pipeline is unchanged`
      : '';

  const run = async () => {
    if (!feed.test) return;
    testFeedMutation.mutate(feed);
  };

  if (!feed.test) {
    return (
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--t3)' }}>
        —
      </span>
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
      }}
    >
      {state === 'ok' && (
        <span
          className="mono"
          style={{ fontSize: 10, color: 'var(--safe)', maxWidth: 230, textAlign: 'right' }}
        >
          {result}
        </span>
      )}
      {state === 'err' && (
        <span
          className="mono"
          style={{ fontSize: 10, color: 'var(--warn)', maxWidth: 230, textAlign: 'right' }}
        >
          {result}
        </span>
      )}
      <button
        onClick={run}
        disabled={state === 'testing'}
        className="btn btn-sm"
        style={{
          padding: '5px 11px',
          borderColor: state === 'ok' ? 'var(--safe)' : 'var(--border-hi)',
          color: state === 'ok' ? 'var(--safe)' : 'var(--t1)',
          whiteSpace: 'nowrap',
        }}
      >
        {state === 'testing' ? (
          <>
            <span className="dot pulse" style={{ background: 'var(--accent)' }}></span> pinging…
          </>
        ) : state === 'ok' ? (
          <>
            <Icon name="check" size={12} stroke={2.6} /> live
          </>
        ) : (
          <>
            <Icon name="globe" size={12} /> Test live
          </>
        )}
      </button>
    </div>
  );
}

export function DataSources({ onToast, live, setLive }) {
  const feeds = RG.dataFeeds;
  const groups = [...new Set(feeds.map((f) => f.group))];
  const liveCount = feeds.filter((f) => f.access !== 'proxy').length;
  const proxyCount = feeds.filter((f) => f.access === 'proxy').length;

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
      {/* mode banner */}
      <div
        className="card"
        style={{
          padding: '18px 22px',
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 11,
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon name="globe" size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="display" style={{ fontSize: 16, fontWeight: 600 }}>
            Feed mode
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: 'var(--t2)',
              marginTop: 3,
              maxWidth: 560,
              lineHeight: 1.5,
            }}
          >
            The app ships on a <strong style={{ color: 'var(--t0)' }}>structured demo feed</strong>{' '}
            shaped exactly like production. Flip to live and the same components read real public
            APIs — keyed/signing feeds still route through a backend.
          </div>
        </div>
        {/* toggle */}
        <div
          onClick={() => {
            const n = !live;
            setLive(n);
            onToast &&
              onToast(
                n
                  ? 'Live feed armed — public sources fetch directly; keyed feeds need the backend'
                  : 'Back to demo feed — deterministic data for the prototype',
                n ? 'var(--accent)' : 'var(--sui)'
              );
          }}
          style={{
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: '10px 14px',
            borderRadius: 'var(--r-md)',
            border: `1.5px solid ${live ? 'var(--accent)' : 'var(--border)'}`,
            background: live ? 'var(--accent-dim)' : 'var(--glass)',
          }}
        >
          <span
            style={{ fontSize: 12, fontWeight: 600, color: live ? 'var(--accent)' : 'var(--t2)' }}
          >
            {live ? 'Live feed' : 'Demo feed'}
          </span>
          <div
            style={{
              width: 40,
              height: 24,
              borderRadius: 100,
              padding: 3,
              background: live ? 'var(--accent)' : 'var(--bg-0)',
              transition: 'background .15s',
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: live ? '#06231f' : 'var(--t2)',
                transform: live ? 'translateX(16px)' : 'none',
                transition: 'transform .15s',
              }}
            />
          </div>
        </div>
      </div>

      {/* counts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {[
          ['Feeds wired', feeds.length, 'var(--t0)'],
          ['Browser-direct', liveCount, 'var(--safe)'],
          ['Need backend', proxyCount, 'var(--warn)'],
        ].map(([k, v, c]) => (
          <div key={k} className="card" style={{ padding: '14px 16px' }}>
            <div className="eyebrow">{k}</div>
            <div
              className="mono display"
              style={{ fontSize: 22, fontWeight: 600, marginTop: 6, color: c }}
            >
              {v}
            </div>
          </div>
        ))}
      </div>

      {/* feed groups */}
      {groups.map((g) => (
        <div key={g}>
          <div
            className="eyebrow"
            style={{
              marginBottom: 10,
              marginLeft: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
            }}
          >
            <Icon name={GROUP_ICON[g] || 'layers'} size={12} /> {g}
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            {feeds
              .filter((f) => f.group === g)
              .map((f, i) => {
                const am = ACCESS_META[f.access];
                return (
                  <div
                    key={f.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.6fr 1.3fr 2fr',
                      gap: 14,
                      alignItems: 'center',
                      padding: '15px 18px',
                      borderTop: i ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    {/* name + provider */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: am.c,
                            flexShrink: 0,
                            boxShadow: f.access !== 'proxy' ? `0 0 6px ${am.c}` : 'none',
                          }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{f.name}</span>
                      </div>
                      <div
                        style={{ fontSize: 11, color: 'var(--t2)', marginTop: 3, marginLeft: 15 }}
                      >
                        {f.provider}
                      </div>
                    </div>
                    {/* endpoint + meta */}
                    <div style={{ minWidth: 0 }}>
                      <div
                        className="mono"
                        style={{
                          fontSize: 10.5,
                          color: 'var(--sui)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {f.endpoint}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <span className="mono" style={{ fontSize: 9.5, color: 'var(--t3)' }}>
                          {f.type}
                        </span>
                        <span className="mono" style={{ fontSize: 9.5, color: 'var(--t3)' }}>
                          · {f.cadence}
                        </span>
                      </div>
                    </div>
                    {/* access + test */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: 12,
                      }}
                    >
                      <span
                        className="badge"
                        style={{
                          fontSize: 9,
                          background: `color-mix(in srgb, ${am.c} 14%, transparent)`,
                          color: am.c,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {am.label}
                      </span>
                      {live ? (
                        <FeedTestButton feed={f} />
                      ) : (
                        <span className="mono" style={{ fontSize: 10, color: 'var(--t3)' }}>
                          {f.test ? 'testable' : 'demo'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}

      {/* architecture note */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ color: 'var(--accent)' }}>
            <Icon name="layers" size={16} />
          </span>
          <div className="card-title">How live data flows in</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div
            style={{
              padding: '13px 15px',
              borderRadius: 'var(--r-md)',
              background: 'var(--glass)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <span style={{ color: 'var(--safe)' }}>
                <Icon name="check" size={14} stroke={2.4} />
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--safe)' }}>
                Browser-direct
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--t1)', lineHeight: 1.5 }}>
              Public, CORS-open read APIs (DefiLlama, Pyth, CoinGecko, Sui RPC) are fetched straight
              from the client and mapped into the same data shapes — no server. The{' '}
              <strong style={{ color: 'var(--t0)' }}>Test live</strong> button proves it end-to-end.
            </div>
          </div>
          <div
            style={{
              padding: '13px 15px',
              borderRadius: 'var(--r-md)',
              background: 'var(--glass)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <span style={{ color: 'var(--warn)' }}>
                <Icon name="shield" size={14} />
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--warn)' }}>
                Via backend
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--t1)', lineHeight: 1.5 }}>
              CEX accounts, order placement, bridging and signing run through a Cloudflare Worker +
              signer. API keys and the zkLogin executor{' '}
              <strong style={{ color: 'var(--t0)' }}>never touch the browser</strong> — and trading
              keys are read+trade, never withdraw.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
