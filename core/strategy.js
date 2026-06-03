// Shared strategy logic: canonical strategy JSON, blake2b-256 strategy_hash,
// and the natural-language intent parser. Pure + environment-agnostic
// (frontend, cloud Worker, local agent all import this). See docs §5.
import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import deployment from './deployment.js';

// ─── canonical JSON + hash ─────────────────────────────────────────────
export function canonicalize(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
export function blake2b256Hex(input) {
  const bytes = typeof input === 'string' ? utf8ToBytes(input) : input;
  return '0x' + bytesToHex(blake2b(bytes, { dkLen: 32 }));
}
export function strategyHash(strategy) {
  return blake2b256Hex(canonicalize(strategy));
}

// ─── constants (docs §1) ───────────────────────────────────────────────
const CHAIN = 'sui:testnet';
const DEFAULT_MAX_SLIPPAGE_BPS = 100;
const MAX_ALLOWED_SLIPPAGE_BPS = 500;
const MAX_POLICY_LIFETIME_SECONDS = 604800;
const AGENT_ADDRESS = deployment.agent.address;
const DB = deployment.deepbook;
const BUDGET_COIN_TYPE = DB.dbusdc_coin_type;
const BUDGET_COIN_DECIMALS = DB.pools[DB.default_pool].quote_decimals; // DBUSDC = 6
const POOL_BY_ASSET = {
  SUI: DB.pools.SUI_DBUSDC,
  DEEP: DB.pools.DEEP_DBUSDC,
  WAL: DB.pools.WAL_DBUSDC,
};

function pow10(n) {
  let r = 1n;
  for (let i = 0; i < n; i++) r *= 10n;
  return r;
}
export function toUnits(human, decimals) {
  const [intPart, fracPart = ''] = String(human).split('.');
  const frac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  return (BigInt(intPart) * pow10(decimals) + BigInt(frac || '0')).toString();
}

// ─── intent parser (NL -> risk_response strategy) ──────────────────────
export function parseIntent(text, owner, defaults = {}, nowMs = Date.now()) {
  const t = (text || '').trim();
  if (!t) return { status: 'error', code: 'INTENT_AMBIGUOUS', message: 'Empty intent.' };

  const asset = (t.match(/\b(SUI|DEEP|WAL)\b/i)?.[1] || 'SUI').toUpperCase();
  const poolCfg = POOL_BY_ASSET[asset];
  if (!poolCfg)
    return {
      status: 'error',
      code: 'UNSUPPORTED_ASSET',
      message: `Asset ${asset} has no supported Deepbook pool on testnet.`,
    };

  // Threshold: keep the canonical "8%" / "8 percent" form first (unchanged
  // result + hash), then fall back to colloquial / Chinese phrasings.
  const thMatch =
    t.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/i) ||
    t.match(/(\d+(?:\.\d+)?)\s*(?:pct|个点|点)/i) ||
    t.match(/百分之\s*(\d+(?:\.\d+)?)/);
  if (!thMatch)
    return {
      status: 'error',
      code: 'INTENT_AMBIGUOUS',
      message:
        'Trigger threshold is missing — say e.g. "drops more than 8%" (also accepts 8pct / 8个点 / 百分之8).',
    };
  const threshold_pct = thMatch[1];

  // Budget: canonical "500 USDC" / "$500" first (unchanged result + hash),
  // then colloquial / Chinese phrasings (500u / 500美金 / 预算500).
  const bm =
    t.match(/(\d[\d,]*(?:\.\d+)?)\s*USDC/i) ||
    t.match(/\$\s*(\d[\d,]*(?:\.\d+)?)/) ||
    t.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:美金|美元|刀|u\b)/i) ||
    t.match(/预算\s*[:：]?\s*(\d[\d,]*(?:\.\d+)?)/);
  const budgetNum = bm ? Number(bm[1].replace(/,/g, '')) : NaN;
  if (!Number.isFinite(budgetNum) || budgetNum <= 0) {
    return {
      status: 'error',
      code: 'INTENT_AMBIGUOUS',
      message:
        'Budget is missing — say e.g. "a 500 USDC rescue grid" (also accepts $500 / 500u / 500美金 / 预算500).',
    };
  }

  const budget_ceiling = toUnits(budgetNum, BUDGET_COIN_DECIMALS);
  const max_single_trade_amount = (BigInt(budget_ceiling) / 5n || 1n).toString();
  const max_slippage_bps = Math.min(
    defaults.max_slippage_bps ?? DEFAULT_MAX_SLIPPAGE_BPS,
    MAX_ALLOWED_SLIPPAGE_BPS
  );
  const lifetimeS = Math.min(defaults.expires_in_seconds ?? 86400, MAX_POLICY_LIFETIME_SECONDS);
  const expires_at_ms = nowMs + lifetimeS * 1000;

  const strategy = {
    version: '1',
    strategy_type: 'risk_response',
    owner,
    agent: AGENT_ADDRESS,
    chain: CHAIN,
    pool_id: defaults.pool_id ?? poolCfg.pool_id,
    budget_coin_type: BUDGET_COIN_TYPE,
    budget_ceiling,
    trigger: { metric: 'price_drop_pct', asset, threshold_pct },
    execution: { order_type: 'market_or_ioc', max_slippage_bps, max_single_trade_amount },
    expires_at_ms,
  };

  const guardian_warnings = [
    {
      code: 1,
      level: 'pass',
      label: 'Slippage bound',
      detail: `Capped at ${(max_slippage_bps / 100).toFixed(2)}% on-chain.`,
    },
    {
      code: 2,
      level: 'pass',
      label: 'Budget ceiling',
      detail: `Policy hard-caps spend at ${budgetNum} USDC on-chain.`,
    },
  ];
  if (budgetNum >= 1000)
    guardian_warnings.push({
      code: 6,
      level: 'warn',
      label: 'Capital concentration',
      detail: 'Large budget routes to a single pair — consider splitting scope.',
    });

  const ptb_preview = [
    `Create MoveGate Mandate and SentryPolicyWrapper for owner ${owner}`,
    `Allow agent ${AGENT_ADDRESS} to trade only pool ${strategy.pool_id}`,
    `Set budget ceiling to ${budgetNum} USDC`,
    `Set max slippage to ${(max_slippage_bps / 100).toFixed(2)}%`,
    `Trigger when ${asset} drops ≥ ${threshold_pct}% (Pyth)`,
    `Expire policy at ${new Date(expires_at_ms).toISOString()}`,
  ];

  return {
    status: 'ok',
    strategy,
    strategy_hash: strategyHash(strategy),
    agent_address: AGENT_ADDRESS,
    guardian_warnings,
    ptb_preview,
  };
}
