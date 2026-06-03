#[test_only]
module rescuegrid::policy_tests;

use sui::test_scenario::{Self as ts};
use sui::coin;
use sui::sui::SUI;
use sui::clock::{Self, Clock};
use std::string;
use std::type_name;

use movegate::mandate::{Self, Mandate, MandateRegistry};
use movegate::passport::{Self, AgentRegistry, AgentPassport};
use movegate::treasury::{Self, FeeConfig, ProtocolTreasury};
use movegate::receipt::{Self, ActionReceipt};

use rescuegrid::policy::{Self, SentryPolicyWrapper};

const OWNER: address = @0xA1;
const AGENT: address = @0xB2;
const POOL_ADDR: address = @0xD00B;
const OTHER_POOL_ADDR: address = @0xBEEF;

const ACTION_RESCUE: u8 = 1;
const BUDGET: u64 = 1_000_000;        // wrapper ceiling + mandate daily_limit
const SPEND_CAP: u64 = 100_000;       // mandate per-action cap
const SLIP_BPS: u16 = 100;            // 1.00%

// ─── helpers ───────────────────────────────────────────────────────────
fun coin_type(): string::String { string::utf8(b"0x2::sui::SUI") }
fun hash(): vector<u8> { b"strategy-hash-blake2b" }
fun pool(): ID { object::id_from_address(POOL_ADDR) }

/// init MoveGate registries/treasury/feeconfig, then register the agent's
/// passport (must be sent by AGENT). Leaves all of them shared.
fun init_world(scenario: &mut ts::Scenario, clock: &Clock) {
    ts::next_tx(scenario, OWNER);
    {
        treasury::init_for_testing(ts::ctx(scenario));
        passport::init_for_testing(ts::ctx(scenario));
        mandate::init_for_testing(ts::ctx(scenario));
    };
    ts::next_tx(scenario, AGENT);
    {
        let mut ar = ts::take_shared<AgentRegistry>(scenario);
        passport::register_agent(&mut ar, clock, ts::ctx(scenario));
        ts::return_shared(ar);
    };
}

/// Mint a Mandate (sent by OWNER) authorizing AGENT on the rescuegrid protocol
/// for SUI. Returned by value for wrapper-construction tests.
fun mk_mandate(scenario: &mut ts::Scenario, clock: &Clock): Mandate {
    ts::next_tx(scenario, OWNER);
    let mut mr = ts::take_shared<MandateRegistry>(scenario);
    let mut ar = ts::take_shared<AgentRegistry>(scenario);
    let mut pp = ts::take_shared<AgentPassport>(scenario);
    let mut tr = ts::take_shared<ProtocolTreasury>(scenario);
    let fc = ts::take_shared<FeeConfig>(scenario);
    let mut payment = coin::mint_for_testing<SUI>(100_000_000, ts::ctx(scenario));
    let m = mandate::create_mandate(
        &mut mr, &mut ar, &mut pp, &mut tr, &fc,
        AGENT, SPEND_CAP, BUDGET,
        vector[@rescuegrid],
        vector[type_name::with_original_ids<SUI>()],
        vector[ACTION_RESCUE],
        clock.timestamp_ms() + 86_400_000,
        option::none(),
        &mut payment, clock, ts::ctx(scenario),
    );
    coin::burn_for_testing(payment);
    ts::return_shared(mr); ts::return_shared(ar); ts::return_shared(pp);
    ts::return_shared(tr); ts::return_shared(fc);
    m
}

// ═══════════════════════════════════════════════════════════════════════
// Happy path: full lifecycle — create_policy -> authorize -> record
// ═══════════════════════════════════════════════════════════════════════
#[test]
fun test_create_then_record_happy() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    init_world(&mut scenario, &clock);

    // OWNER creates the policy (mandate + wrapper shared) via the thin helper.
    ts::next_tx(&mut scenario, OWNER);
    {
        let mut mr = ts::take_shared<MandateRegistry>(&scenario);
        let mut ar = ts::take_shared<AgentRegistry>(&scenario);
        let mut pp = ts::take_shared<AgentPassport>(&scenario);
        let mut tr = ts::take_shared<ProtocolTreasury>(&scenario);
        let fc = ts::take_shared<FeeConfig>(&scenario);
        let mut payment = coin::mint_for_testing<SUI>(100_000_000, ts::ctx(&mut scenario));
        policy::create_policy<SUI>(
            &mut mr, &mut ar, &mut pp, &mut tr, &fc,
            AGENT, SPEND_CAP, BUDGET, clock.timestamp_ms() + 86_400_000,
            pool(), coin_type(), SLIP_BPS, hash(),
            &mut payment, &clock, ts::ctx(&mut scenario),
        );
        coin::burn_for_testing(payment);
        ts::return_shared(mr); ts::return_shared(ar); ts::return_shared(pp);
        ts::return_shared(tr); ts::return_shared(fc);
    };

    // AGENT executes: authorize_action -> record_agent_trade (consumes token).
    ts::next_tx(&mut scenario, AGENT);
    {
        let mut mandate = ts::take_shared<Mandate>(&scenario);
        let mut wrapper = ts::take_shared<SentryPolicyWrapper>(&scenario);
        let mut pp = ts::take_shared<AgentPassport>(&scenario);
        let mut ar = ts::take_shared<AgentRegistry>(&scenario);

        let token = mandate::authorize_action<SUI>(
            &mut mandate, &mut pp, @rescuegrid, 50_000, ACTION_RESCUE, &clock, ts::ctx(&mut scenario),
        );
        policy::record_agent_trade(
            &mut wrapper, &mut mandate, &mut pp, &mut ar,
            pool(), 50_000, 12_300, 80, b"order-1", token, &clock, ts::ctx(&mut scenario),
        );

        assert!(policy::spent_amount(&wrapper) == 50_000, 0);
        assert!(policy::remaining_budget(&wrapper) == BUDGET - 50_000, 1);

        ts::return_shared(mandate); ts::return_shared(wrapper);
        ts::return_shared(pp); ts::return_shared(ar);
    };

    // The success ActionReceipt was frozen — assert it exists with the right amount.
    ts::next_tx(&mut scenario, AGENT);
    {
        let r = ts::take_immutable<ActionReceipt>(&scenario);
        assert!(receipt::receipt_amount(&r) == 50_000, 2);
        assert!(receipt::receipt_success(&r), 3);
        ts::return_immutable(r);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

// ═══════════════════════════════════════════════════════════════════════
// Happy path: revoke
// ═══════════════════════════════════════════════════════════════════════
#[test]
fun test_revoke_happy() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    init_world(&mut scenario, &clock);

    ts::next_tx(&mut scenario, OWNER);
    {
        let mut mr = ts::take_shared<MandateRegistry>(&scenario);
        let mut ar = ts::take_shared<AgentRegistry>(&scenario);
        let mut pp = ts::take_shared<AgentPassport>(&scenario);
        let mut tr = ts::take_shared<ProtocolTreasury>(&scenario);
        let fc = ts::take_shared<FeeConfig>(&scenario);
        let mut payment = coin::mint_for_testing<SUI>(100_000_000, ts::ctx(&mut scenario));
        policy::create_policy<SUI>(
            &mut mr, &mut ar, &mut pp, &mut tr, &fc,
            AGENT, SPEND_CAP, BUDGET, clock.timestamp_ms() + 86_400_000,
            pool(), coin_type(), SLIP_BPS, hash(),
            &mut payment, &clock, ts::ctx(&mut scenario),
        );
        coin::burn_for_testing(payment);
        ts::return_shared(mr); ts::return_shared(ar); ts::return_shared(pp);
        ts::return_shared(tr); ts::return_shared(fc);
    };

    ts::next_tx(&mut scenario, OWNER);
    {
        let mut wrapper = ts::take_shared<SentryPolicyWrapper>(&scenario);
        let mut mandate = ts::take_shared<Mandate>(&scenario);
        let mut mr = ts::take_shared<MandateRegistry>(&scenario);
        let mut pp = ts::take_shared<AgentPassport>(&scenario);

        policy::revoke_policy(&mut wrapper, &mut mandate, &mut mr, &mut pp, &clock, ts::ctx(&mut scenario));
        assert!(mandate::mandate_revoked(&mandate), 0);

        ts::return_shared(wrapper); ts::return_shared(mandate);
        ts::return_shared(mr); ts::return_shared(pp);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

// ═══════════════════════════════════════════════════════════════════════
// Error paths — construction
// ═══════════════════════════════════════════════════════════════════════
#[test]
#[expected_failure(abort_code = rescuegrid::policy::EZeroBudget)]
fun test_create_wrapper_zero_budget_aborts() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    init_world(&mut scenario, &clock);
    let mandate = mk_mandate(&mut scenario, &clock);

    ts::next_tx(&mut scenario, OWNER);
    let wrapper = policy::create_policy_wrapper(
        &mandate, pool(), coin_type(), 0 /* zero budget */, SLIP_BPS, hash(), ts::ctx(&mut scenario),
    );

    // unreachable
    transfer::public_share_object(wrapper);
    transfer::public_share_object(mandate);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = rescuegrid::policy::ESlippageOverCap)]
fun test_create_wrapper_slippage_over_cap_aborts() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    init_world(&mut scenario, &clock);
    let mandate = mk_mandate(&mut scenario, &clock);

    ts::next_tx(&mut scenario, OWNER);
    let wrapper = policy::create_policy_wrapper(
        &mandate, pool(), coin_type(), BUDGET, 600 /* > 500 cap */, hash(), ts::ctx(&mut scenario),
    );

    transfer::public_share_object(wrapper);
    transfer::public_share_object(mandate);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

// ═══════════════════════════════════════════════════════════════════════
// Error paths — assert_policy_valid
// ═══════════════════════════════════════════════════════════════════════
#[test]
#[expected_failure(abort_code = rescuegrid::policy::EPoolMismatch)]
fun test_assert_pool_mismatch_aborts() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    init_world(&mut scenario, &clock);
    let mandate = mk_mandate(&mut scenario, &clock);

    ts::next_tx(&mut scenario, OWNER);
    let wrapper = policy::create_policy_wrapper(&mandate, pool(), coin_type(), BUDGET, SLIP_BPS, hash(), ts::ctx(&mut scenario));
    policy::assert_policy_valid(&wrapper, AGENT, object::id_from_address(OTHER_POOL_ADDR), 10_000, 50);

    transfer::public_share_object(wrapper);
    transfer::public_share_object(mandate);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = rescuegrid::policy::EBudgetExceeded)]
fun test_assert_budget_exceeded_aborts() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    init_world(&mut scenario, &clock);
    let mandate = mk_mandate(&mut scenario, &clock);

    ts::next_tx(&mut scenario, OWNER);
    let wrapper = policy::create_policy_wrapper(&mandate, pool(), coin_type(), BUDGET, SLIP_BPS, hash(), ts::ctx(&mut scenario));
    policy::assert_policy_valid(&wrapper, AGENT, pool(), BUDGET + 1 /* over ceiling */, 50);

    transfer::public_share_object(wrapper);
    transfer::public_share_object(mandate);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = rescuegrid::policy::ESlippageTooHigh)]
fun test_assert_slippage_too_high_aborts() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    init_world(&mut scenario, &clock);
    let mandate = mk_mandate(&mut scenario, &clock);

    ts::next_tx(&mut scenario, OWNER);
    let wrapper = policy::create_policy_wrapper(&mandate, pool(), coin_type(), BUDGET, SLIP_BPS, hash(), ts::ctx(&mut scenario));
    policy::assert_policy_valid(&wrapper, AGENT, pool(), 10_000, SLIP_BPS + 1 /* over wrapper cap */);

    transfer::public_share_object(wrapper);
    transfer::public_share_object(mandate);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = rescuegrid::policy::EWrongAgent)]
fun test_assert_wrong_agent_aborts() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    init_world(&mut scenario, &clock);
    let mandate = mk_mandate(&mut scenario, &clock);

    ts::next_tx(&mut scenario, OWNER);
    let wrapper = policy::create_policy_wrapper(&mandate, pool(), coin_type(), BUDGET, SLIP_BPS, hash(), ts::ctx(&mut scenario));
    policy::assert_policy_valid(&wrapper, OWNER /* not the agent */, pool(), 10_000, 50);

    transfer::public_share_object(wrapper);
    transfer::public_share_object(mandate);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}
