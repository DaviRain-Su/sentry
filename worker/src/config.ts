// Deployment constants. See deployment.js (mirrors repo-root deployment.testnet.json).
import deployment from './deployment.js';

export const CONFIG = deployment;
export const CHAIN = 'sui:testnet' as const;

// Spec §1 constants
export const DEFAULT_MAX_SLIPPAGE_BPS = 100;
export const MAX_ALLOWED_SLIPPAGE_BPS = 500;
export const MAX_POLICY_LIFETIME_SECONDS = 604800; // 7 days
export const DEFAULT_TICK_INTERVAL_SECONDS = 60;
export const ACTION_DEEPBOOK_RESCUE = 1;

// The single MVP agent address (deployment-controlled).
export const AGENT_ADDRESS = CONFIG.agent.address;

// Default Deepbook venue + budget coin (testnet USDC = DBUSDC).
export const DEFAULT_POOL = CONFIG.deepbook.pools[CONFIG.deepbook.default_pool as 'SUI_DBUSDC'];
export const DEFAULT_POOL_ID = DEFAULT_POOL.pool_id;
export const BUDGET_COIN_TYPE = CONFIG.deepbook.dbusdc_coin_type;
export const BUDGET_COIN_DECIMALS = DEFAULT_POOL.quote_decimals; // DBUSDC = 6
