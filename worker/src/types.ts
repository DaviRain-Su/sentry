// Shared API + strategy types (docs/03-technical-spec.md §5, §7).

export interface StrategyTrigger {
  metric: 'price_drop_pct';
  asset: string;
  threshold_pct: string;
}

export interface StrategyExecution {
  order_type: 'market_or_ioc';
  max_slippage_bps: number;
  max_single_trade_amount: string;
}

export interface Strategy {
  version: '1';
  strategy_type: 'risk_response';
  owner: string;
  agent: string;
  chain: 'sui:testnet';
  pool_id: string;
  budget_coin_type: string;
  budget_ceiling: string;
  trigger: StrategyTrigger;
  execution: StrategyExecution;
  expires_at_ms: number;
}

export interface ParseDefaults {
  chain?: string;
  pool_id?: string;
  max_slippage_bps?: number;
  expires_in_seconds?: number;
}

export interface GuardianWarning {
  code: number;
  level: 'pass' | 'warn' | 'fail';
  label: string;
  detail: string;
}

export type ParseResult =
  | {
      status: 'ok';
      strategy: Strategy;
      strategy_hash: string;
      agent_address: string;
      guardian_warnings: GuardianWarning[];
      ptb_preview: string[];
    }
  | { status: 'error'; code: string; message: string };
