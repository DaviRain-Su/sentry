function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeAsset(value) {
  return normalizeString(value).toUpperCase();
}

function numericValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nowMsValue(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

function blockedGuard(code, message, extra = {}) {
  return {
    status: 'blocked',
    local_decision: 'blocked_by_local_inventory_guard',
    code,
    message,
    ...extra,
  };
}

function taskVenueId(task = {}) {
  return (
    task.venue_id ||
    task.policy_context?.venue_id ||
    task.policy_context?.venue ||
    task.authorization?.venue_id ||
    null
  );
}

function taskNotionalUsd(task = {}) {
  const constraints = task.constraints || {};
  const params = task.action?.params || {};
  const explicit = numericValue(
    constraints.max_notional_usd ||
      constraints.max_quote_amount ||
      constraints.max_input_amount_usd ||
      params.max_notional_usd ||
      params.max_quote_amount ||
      params.max_input_amount_usd
  );
  if (explicit !== null) return { status: 'ok', amount: explicit, source: 'explicit_budget' };

  const size = numericValue(params.sz || params.size || params.base_amount);
  const price = numericValue(params.px || params.price || params.limitPx || params.limit_px);
  if (size !== null && price !== null) {
    return { status: 'ok', amount: size * price, source: 'price_times_size' };
  }
  return {
    status: 'missing',
    code: 'POLICY_TASK_NOTIONAL_REQUIRED',
    message: 'Task needs explicit USD notional or price*size for exposure checks.',
  };
}

function riskConfig(policy = {}) {
  const fromConstraints = isObject(policy.constraints?.risk_checks)
    ? policy.constraints.risk_checks
    : {};
  const direct = isObject(policy.risk_checks) ? policy.risk_checks : {};
  const constraints = isObject(policy.constraints) ? policy.constraints : {};
  return {
    ...direct,
    ...fromConstraints,
    max_inventory_age_ms:
      fromConstraints.max_inventory_age_ms ??
      direct.max_inventory_age_ms ??
      constraints.max_inventory_age_ms ??
      constraints.inventory_max_age_ms,
    min_available_balances:
      fromConstraints.min_available_balances ??
      direct.min_available_balances ??
      constraints.min_available_balances ??
      constraints.min_available_balance,
    max_position_value_usd:
      fromConstraints.max_position_value_usd ??
      direct.max_position_value_usd ??
      constraints.max_position_value_usd,
    max_venue_exposure_usd:
      fromConstraints.max_venue_exposure_usd ??
      direct.max_venue_exposure_usd ??
      constraints.max_venue_exposure_usd,
    require_inventory:
      fromConstraints.require_inventory ??
      direct.require_inventory ??
      constraints.require_inventory,
  };
}

function hasConfiguredRiskChecks(config = {}) {
  return Boolean(
    config.require_inventory ||
      config.max_inventory_age_ms !== undefined ||
      config.min_available_balances !== undefined ||
      config.max_position_value_usd !== undefined ||
      config.max_venue_exposure_usd !== undefined
  );
}

export function localPolicyRiskGuardRequired(policy = {}) {
  return hasConfiguredRiskChecks(riskConfig(policy));
}

function relevantVenueIds(policy = {}, task = {}) {
  const venueId = taskVenueId(task);
  return [...new Set([venueId, ...(policy.target_venue_ids || [])].filter(Boolean))];
}

function relevantAccessIssues(snapshot = {}, venueIds = []) {
  return list(snapshot.access_issues).filter(
    (issue) =>
      (!issue.venue_id || venueIds.includes(issue.venue_id)) &&
      ['blocked', 'error'].includes(issue.severity)
  );
}

function relevantLiveReadIssues(snapshot = {}, venueIds = []) {
  return list(snapshot.live_reads).filter(
    (read) =>
      (!read.venue_id || venueIds.includes(read.venue_id)) &&
      !['ok', 'skipped'].includes(read.status)
  );
}

function positionMatches(position = {}, requirement = {}, fallbackVenueId) {
  const venueId = requirement.venue_id || fallbackVenueId;
  if (venueId && position.venue_id !== venueId) return false;
  const asset = normalizeAsset(requirement.asset || requirement.ccy || requirement.symbol);
  if (asset && normalizeAsset(position.asset) !== asset) return false;
  return true;
}

function sumPositions(positions, requirement, fallbackVenueId, fieldCandidates) {
  let matched = 0;
  let amount = 0;
  let latestObservedAt = null;
  for (const position of positions) {
    if (!positionMatches(position, requirement, fallbackVenueId)) continue;
    matched += 1;
    for (const field of fieldCandidates) {
      const value = numericValue(position[field]);
      if (value !== null) {
        amount += value;
        break;
      }
    }
    if (position.observed_at) {
      if (!latestObservedAt || Date.parse(position.observed_at) > Date.parse(latestObservedAt)) {
        latestObservedAt = position.observed_at;
      }
    }
  }
  return { matched, amount, observed_at: latestObservedAt };
}

function staleInventoryIssue(snapshot = {}, config = {}, nowMs) {
  const maxAgeMs = numericValue(config.max_inventory_age_ms);
  if (maxAgeMs === null) return null;
  const generatedAt = snapshot.generated_at || snapshot.observed_at;
  if (!generatedAt) {
    return {
      age_ms: null,
      generated_at: null,
      max_age_ms: maxAgeMs,
    };
  }
  const ageMs = nowMs - Date.parse(generatedAt);
  if (!Number.isFinite(ageMs) || ageMs > maxAgeMs) {
    return {
      age_ms: Number.isFinite(ageMs) ? ageMs : null,
      generated_at: generatedAt,
      max_age_ms: maxAgeMs,
    };
  }
  return null;
}

function normalizeRequirements(value) {
  return list(value)
    .map((item) => (isObject(item) ? item : { amount: item }))
    .filter(isObject);
}

function minAmount(requirement) {
  return numericValue(requirement.amount ?? requirement.min_amount ?? requirement.available);
}

function maxAmount(requirement) {
  return numericValue(requirement.amount ?? requirement.max_amount ?? requirement.value_usd);
}

export function evaluateLocalPolicyRiskGuard(policy = {}, task = {}, options = {}) {
  const config = riskConfig(policy);
  const hasChecks = hasConfiguredRiskChecks(config);
  if (!hasChecks) {
    return {
      status: 'skipped',
      local_decision: 'inventory_guard_not_configured',
      policy_id: policy.policy_id || null,
      task_id: task.task_id || null,
    };
  }

  const snapshot = options.inventorySnapshot || options.inventory_snapshot || null;
  if (!isObject(snapshot)) {
    return blockedGuard(
      'POLICY_INVENTORY_SNAPSHOT_REQUIRED',
      'Policy risk checks require a local inventory snapshot before readiness or dispatch.',
      {
        policy_id: policy.policy_id || null,
        task_id: task.task_id || null,
      }
    );
  }

  const nowMs = nowMsValue(options.now);
  const venueIds = relevantVenueIds(policy, task);
  const accessIssues = relevantAccessIssues(snapshot, venueIds);
  if (accessIssues.length) {
    return blockedGuard(
      'POLICY_INVENTORY_ACCESS_BLOCKED',
      'Inventory access has blocked/error issues for a target venue.',
      {
        venue_ids: venueIds,
        access_issues: accessIssues,
      }
    );
  }

  const liveReadIssues = relevantLiveReadIssues(snapshot, venueIds);
  if (liveReadIssues.length) {
    return blockedGuard(
      'POLICY_INVENTORY_LIVE_READ_FAILED',
      'Live inventory read failed for a target venue.',
      {
        venue_ids: venueIds,
        live_reads: liveReadIssues,
      }
    );
  }

  const stale = staleInventoryIssue(snapshot, config, nowMs);
  if (stale) {
    return blockedGuard('POLICY_INVENTORY_STALE', 'Inventory snapshot is stale.', stale);
  }

  const positions = list(snapshot.positions).filter(isObject);
  const venueId = taskVenueId(task);
  const minAvailable = normalizeRequirements(config.min_available_balances);
  for (const requirement of minAvailable) {
    const required = minAmount(requirement);
    if (required === null) {
      return blockedGuard(
        'POLICY_MIN_AVAILABLE_AMOUNT_REQUIRED',
        'min_available_balances entries need amount/min_amount.',
        { requirement }
      );
    }
    const summed = sumPositions(positions, requirement, venueId, [
      'available',
      'available_balance',
      'free',
      'quantity',
    ]);
    if (summed.amount < required) {
      return blockedGuard(
        'POLICY_AVAILABLE_BALANCE_TOO_LOW',
        'Available balance is below the local policy minimum.',
        {
          requirement,
          matched_position_count: summed.matched,
          available: summed.amount,
          required,
          observed_at: summed.observed_at,
        }
      );
    }
  }

  const maxPositionValues = normalizeRequirements(config.max_position_value_usd);
  for (const requirement of maxPositionValues) {
    const cap = maxAmount(requirement);
    if (cap === null) {
      return blockedGuard(
        'POLICY_MAX_POSITION_VALUE_REQUIRED',
        'max_position_value_usd entries need amount/max_amount/value_usd.',
        { requirement }
      );
    }
    const summed = sumPositions(positions, requirement, venueId, ['value_usd']);
    if (summed.amount > cap) {
      return blockedGuard(
        'POLICY_POSITION_VALUE_EXCEEDED',
        'Position value exceeds the local policy cap.',
        {
          requirement,
          matched_position_count: summed.matched,
          value_usd: summed.amount,
          max_value_usd: cap,
          observed_at: summed.observed_at,
        }
      );
    }
  }

  const maxVenueExposure = normalizeRequirements(config.max_venue_exposure_usd);
  for (const requirement of maxVenueExposure) {
    const cap = maxAmount(requirement);
    if (cap === null) {
      return blockedGuard(
        'POLICY_MAX_VENUE_EXPOSURE_REQUIRED',
        'max_venue_exposure_usd entries need amount/max_amount/value_usd.',
        { requirement }
      );
    }
    const targetVenueId = requirement.venue_id || venueId;
    const currentExposure = positions
      .filter((position) => !targetVenueId || position.venue_id === targetVenueId)
      .reduce((sum, position) => sum + (numericValue(position.value_usd) || 0), 0);
    const notional = taskNotionalUsd(task);
    if (notional.status !== 'ok') {
      return blockedGuard(notional.code, notional.message, { requirement });
    }
    const projectedExposure = currentExposure + notional.amount;
    if (projectedExposure > cap) {
      return blockedGuard(
        'POLICY_VENUE_EXPOSURE_EXCEEDED',
        'Projected venue exposure exceeds the local policy cap.',
        {
          requirement,
          current_exposure_usd: currentExposure,
          task_notional_usd: notional.amount,
          notional_source: notional.source,
          projected_exposure_usd: projectedExposure,
          max_exposure_usd: cap,
        }
      );
    }
  }

  return {
    status: 'ok',
    local_decision: 'allowed_by_local_inventory_guard',
    policy_id: policy.policy_id || null,
    task_id: task.task_id || null,
    venue_ids: venueIds,
    check_count:
      minAvailable.length + maxPositionValues.length + maxVenueExposure.length + (stale ? 1 : 0),
    inventory_generated_at: snapshot.generated_at || snapshot.observed_at || null,
  };
}
