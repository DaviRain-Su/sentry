/// Sentry — SentryPolicyWrapper
///
/// Wraps a MoveGate Mandate with the DeFi-specific constraints MoveGate does
/// not cover: a single allowed Deepbook `pool_id`, a *cumulative* (never-reset)
/// budget ceiling, a max-slippage bound and the bound `strategy_hash`.
///
/// MoveGate enforces agent identity, expiry, revocation and the hot-potato
/// AuthToken; RescueGrid enforces pool / budget / slippage. The execution PTB
/// binds `authorize_action -> deepbook -> record_agent_trade` into one intent,
/// and the AuthToken (zero-ability) is consumed exactly once via MoveGate's
/// `create_success_receipt`, which also freezes an immutable ActionReceipt.
module rescuegrid::policy;

use std::string::String;
use std::type_name;
use sui::clock::Clock;
use sui::coin::Coin;
use sui::sui::SUI;
use sui::event;

use movegate::mandate::{Self, Mandate, AuthToken, MandateRegistry};
use movegate::passport::{AgentPassport, AgentRegistry};
use movegate::treasury::{FeeConfig, ProtocolTreasury};
use movegate::receipt;

// ─── Constants (mirror docs/03-technical-spec.md §1) ───────────────────
/// MoveGate action type for RescueGrid rescue/response trades.
const ACTION_DEEPBOOK_RESCUE: u8 = 1;
/// Owner-requested revocation reason passed to MoveGate.
const REVOKE_REASON_OWNER: u8 = 1;
/// Chain-level creation cap on slippage: 5.00%.
const MAX_ALLOWED_SLIPPAGE_BPS: u16 = 500;

/// The protocol address authorized in the Mandate is this package itself.
/// MoveGate authorizes the RescueGrid wrapper protocol, not Deepbook directly.
const RESCUEGRID_PROTOCOL_ADDRESS: address = @rescuegrid;

// ─── Error codes ───────────────────────────────────────────────────────
const EZeroBudget: u64 = 1;
const ESlippageOverCap: u64 = 2;
const ENotOwner: u64 = 3;
const EProtocolNotAuthorized: u64 = 4;
const EPoolMismatch: u64 = 5;
const EBudgetExceeded: u64 = 6;
const ESlippageTooHigh: u64 = 7;
const EWrongAgent: u64 = 8;
const EMandateMismatch: u64 = 9;
const EZeroAmount: u64 = 10;
const EAuthTokenMandateMismatch: u64 = 11;
const EAuthTokenAgentMismatch: u64 = 12;
const EAuthTokenProtocolMismatch: u64 = 13;
const EAuthTokenAmountMismatch: u64 = 14;
const EMandateAlreadyRevoked: u64 = 15;

// ─── Object ────────────────────────────────────────────────────────────
public struct SentryPolicyWrapper has key, store {
    id: UID,
    owner: address,
    mandate_id: ID,          // reference to the MoveGate Mandate
    agent: address,          // cached from the mandate for fast access
    pool_id: ID,             // the only Deepbook pool this policy may target
    budget_coin_type: String,
    budget_ceiling: u64,     // smallest unit of budget_coin_type
    spent_amount: u64,       // cumulative, never resets
    max_slippage_bps: u16,
    strategy_hash: vector<u8>,
}

// ─── Events ────────────────────────────────────────────────────────────
public struct PolicyCreated has copy, drop {
    mandate_id: ID,
    wrapper_id: ID,
    owner: address,
    agent: address,
    pool_id: ID,
    budget_ceiling: u64,
    max_slippage_bps: u16,
    expires_at_ms: u64,
    strategy_hash: vector<u8>,
}

public struct PolicyRevoked has copy, drop {
    mandate_id: ID,
    wrapper_id: ID,
    owner: address,
    revoked_at_ms: u64,
}

public struct AgentTradeExecuted has copy, drop {
    mandate_id: ID,
    wrapper_id: ID,
    agent: address,
    pool_id: ID,
    quote_amount_spent: u64,
    base_amount_received: u64,
    spent_amount_after: u64,
    budget_ceiling: u64,
    slippage_bps: u16,
    client_order_id: vector<u8>,
    executed_at_ms: u64,
}

// ─── Read accessors ────────────────────────────────────────────────────
public fun owner(w: &SentryPolicyWrapper): address { w.owner }
public fun mandate_id(w: &SentryPolicyWrapper): ID { w.mandate_id }
public fun agent(w: &SentryPolicyWrapper): address { w.agent }
public fun pool_id(w: &SentryPolicyWrapper): ID { w.pool_id }
public fun budget_ceiling(w: &SentryPolicyWrapper): u64 { w.budget_ceiling }
public fun spent_amount(w: &SentryPolicyWrapper): u64 { w.spent_amount }
public fun remaining_budget(w: &SentryPolicyWrapper): u64 { w.budget_ceiling - w.spent_amount }
public fun max_slippage_bps(w: &SentryPolicyWrapper): u16 { w.max_slippage_bps }
public fun strategy_hash(w: &SentryPolicyWrapper): vector<u8> { w.strategy_hash }

// ─── C2/C3: wrapper construction ───────────────────────────────────────
/// Pure wrapper constructor. Used by the direct-PTB route and unit tests.
/// The owner-creation flow must share the returned wrapper before activation.
public fun create_policy_wrapper(
    mandate: &Mandate,
    pool_id: ID,
    budget_coin_type: String,
    budget_ceiling: u64,
    max_slippage_bps: u16,
    strategy_hash: vector<u8>,
    ctx: &mut TxContext,
): SentryPolicyWrapper {
    let sender = ctx.sender();
    assert!(budget_ceiling > 0, EZeroBudget);
    assert!(max_slippage_bps <= MAX_ALLOWED_SLIPPAGE_BPS, ESlippageOverCap);
    assert!(mandate::mandate_owner(mandate) == sender, ENotOwner);
    let protocol = RESCUEGRID_PROTOCOL_ADDRESS;
    assert!(
        mandate::mandate_allowed_protocols(mandate).contains(&protocol),
        EProtocolNotAuthorized,
    );

    let agent = mandate::mandate_agent(mandate);
    let wrapper = SentryPolicyWrapper {
        id: object::new(ctx),
        owner: sender,
        mandate_id: object::id(mandate),
        agent,
        pool_id,
        budget_coin_type,
        budget_ceiling,
        spent_amount: 0,
        max_slippage_bps,
        strategy_hash,
    };

    event::emit(PolicyCreated {
        mandate_id: object::id(mandate),
        wrapper_id: object::id(&wrapper),
        owner: sender,
        agent,
        pool_id,
        budget_ceiling,
        max_slippage_bps,
        expires_at_ms: mandate::mandate_expires_at_ms(mandate),
        strategy_hash,
    });

    wrapper
}

/// Thin Move helper (B0-chosen route): builds the `allowed_coin_types`
/// `vector<TypeName>` inside Move, mints the MoveGate Mandate, wraps it and
/// shares both objects in one PTB so the agent can access them later without
/// owner co-signing. `BudgetCoin` is the budget coin type (e.g. DBUSDC).
/// Mandate and wrapper are freshly created in this same PTB, so sharing them
/// here cannot abort — silence the share_owned lint.
#[allow(lint(share_owned))]
public fun create_policy<BudgetCoin>(
    registry: &mut MandateRegistry,
    agent_registry: &mut AgentRegistry,
    passport: &mut AgentPassport,
    treasury: &mut ProtocolTreasury,
    fee_config: &FeeConfig,
    agent: address,
    max_single_trade_amount: u64,   // MoveGate spend_cap (per-action)
    budget_ceiling: u64,            // MoveGate daily_limit + wrapper ceiling
    expires_at_ms: u64,
    pool_id: ID,
    budget_coin_type: String,
    max_slippage_bps: u16,
    strategy_hash: vector<u8>,
    payment: &mut Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let allowed_protocols = vector[RESCUEGRID_PROTOCOL_ADDRESS];
    let allowed_coin_types = vector[type_name::with_original_ids<BudgetCoin>()];
    let allowed_actions = vector[ACTION_DEEPBOOK_RESCUE];

    let mandate = mandate::create_mandate(
        registry,
        agent_registry,
        passport,
        treasury,
        fee_config,
        agent,
        max_single_trade_amount,
        budget_ceiling,
        allowed_protocols,
        allowed_coin_types,
        allowed_actions,
        expires_at_ms,
        option::none(),
        payment,
        clock,
        ctx,
    );

    let wrapper = create_policy_wrapper(
        &mandate,
        pool_id,
        budget_coin_type,
        budget_ceiling,
        max_slippage_bps,
        strategy_hash,
        ctx,
    );

    // Share both so future agent-signed PTBs can use them without owner co-sign.
    transfer::public_share_object(mandate);
    transfer::public_share_object(wrapper);
}

// ─── C3: revocation ────────────────────────────────────────────────────
/// Owner revokes the policy. Delegates the authority deletion to MoveGate's
/// `revoke_mandate`; the wrapper stays but its mandate is dead, so no further
/// `authorize_action` can succeed.
public fun revoke_policy(
    wrapper: &mut SentryPolicyWrapper,
    mandate: &mut Mandate,
    mandate_registry: &mut MandateRegistry,
    passport: &mut AgentPassport,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == wrapper.owner, ENotOwner);
    assert!(wrapper.owner == mandate::mandate_owner(mandate), ENotOwner);
    assert!(object::id(mandate) == wrapper.mandate_id, EMandateMismatch);
    assert!(!mandate::mandate_revoked(mandate), EMandateAlreadyRevoked);

    mandate::revoke_mandate(mandate, mandate_registry, passport, REVOKE_REASON_OWNER, clock, ctx);

    event::emit(PolicyRevoked {
        mandate_id: object::id(mandate),
        wrapper_id: object::id(wrapper),
        owner: wrapper.owner,
        revoked_at_ms: clock.timestamp_ms(),
    });
}

// ─── C4: validity check ────────────────────────────────────────────────
/// RescueGrid-specific checks (pool / budget / slippage / agent). MoveGate's
/// `authorize_action` enforces revoked/expired earlier in the PTB. No mutation.
public fun assert_policy_valid(
    wrapper: &SentryPolicyWrapper,
    agent: address,
    pool_id: ID,
    amount: u64,
    slippage_bps: u16,
) {
    assert!(pool_id == wrapper.pool_id, EPoolMismatch);
    assert!(agent == wrapper.agent, EWrongAgent);
    assert!(slippage_bps <= wrapper.max_slippage_bps, ESlippageTooHigh);
    assert!(wrapper.spent_amount + amount <= wrapper.budget_ceiling, EBudgetExceeded);
}

// ─── C5: record an executed trade (consumes the AuthToken) ─────────────
/// Runs all wrapper checks, then hands the AuthToken to MoveGate's
/// `create_success_receipt` which consumes it once and freezes an
/// ActionReceipt, then increments the cumulative spend.
public fun record_agent_trade(
    wrapper: &mut SentryPolicyWrapper,
    mandate: &mut Mandate,
    passport: &mut AgentPassport,
    agent_registry: &mut AgentRegistry,
    pool_id: ID,
    quote_amount_spent: u64,
    base_amount_received: u64,
    slippage_bps: u16,
    client_order_id: vector<u8>,
    auth_token: AuthToken,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let sender = ctx.sender();
    assert!(quote_amount_spent > 0, EZeroAmount);
    assert!(object::id(mandate) == wrapper.mandate_id, EMandateMismatch);
    // pool / budget / slippage / (agent == sender == wrapper.agent)
    assert_policy_valid(wrapper, sender, pool_id, quote_amount_spent, slippage_bps);

    // AuthToken must match this exact wrapper/agent/protocol/amount.
    assert!(mandate::auth_token_mandate_id(&auth_token) == wrapper.mandate_id, EAuthTokenMandateMismatch);
    assert!(mandate::auth_token_agent(&auth_token) == wrapper.agent, EAuthTokenAgentMismatch);
    assert!(mandate::auth_token_protocol(&auth_token) == RESCUEGRID_PROTOCOL_ADDRESS, EAuthTokenProtocolMismatch);
    assert!(mandate::auth_token_amount(&auth_token) == quote_amount_spent, EAuthTokenAmountMismatch);

    // Consume the AuthToken exactly once via MoveGate; freezes an ActionReceipt.
    receipt::create_success_receipt(
        auth_token,
        mandate,
        passport,
        agent_registry,
        wrapper.owner,
        RESCUEGRID_PROTOCOL_ADDRESS,
        quote_amount_spent,
        0,
        option::none(),
        clock,
        ctx,
    );

    wrapper.spent_amount = wrapper.spent_amount + quote_amount_spent;

    event::emit(AgentTradeExecuted {
        mandate_id: wrapper.mandate_id,
        wrapper_id: object::id(wrapper),
        agent: wrapper.agent,
        pool_id,
        quote_amount_spent,
        base_amount_received,
        spent_amount_after: wrapper.spent_amount,
        budget_ceiling: wrapper.budget_ceiling,
        slippage_bps,
        client_order_id,
        executed_at_ms: clock.timestamp_ms(),
    });
}
