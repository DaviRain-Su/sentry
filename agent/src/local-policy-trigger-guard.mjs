function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function numericValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
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

function taskMarketSymbol(task = {}) {
  const params = task.action?.params || {};
  return (
    params.instId ||
    params.instrument ||
    params.symbol ||
    params.market ||
    params.coin ||
    params.asset ||
    params.inputMint ||
    params.input_token ||
    params.inputToken ||
    null
  );
}

function triggerDefinition(policy = {}) {
  const trigger =
    policy.trigger ||
    policy.strategy?.trigger ||
    policy.strategy?.trigger_condition ||
    policy.constraints?.trigger ||
    {};
  return isObject(trigger) ? trigger : {};
}

export function localPolicyTriggerGuardRequired(policy = {}) {
  const trigger = triggerDefinition(policy);
  return Boolean(Object.keys(trigger).length && trigger.enabled !== false);
}

function skippedTrigger(reason) {
  return {
    status: 'skipped',
    local_decision: reason,
  };
}

function blockedTrigger(code, message, extra = {}) {
  return {
    status: 'blocked',
    local_decision: 'blocked_by_local_trigger_guard',
    code,
    message,
    ...extra,
  };
}

function notTriggered(message, extra = {}) {
  return {
    status: 'skipped',
    local_decision: 'trigger_not_satisfied',
    code: 'POLICY_TRIGGER_NOT_SATISFIED',
    message,
    ...extra,
  };
}

function marketRowsFromObject(value, source = 'market') {
  if (!isObject(value)) return [];
  return Object.entries(value).map(([key, row]) =>
    isObject(row)
      ? {
          ...row,
          symbol: row.symbol || row.market || row.instId || row.instrument || key,
          source,
        }
      : {
          symbol: key,
          price: row,
          source,
        }
  );
}

function marketRows(snapshot = {}) {
  if (!isObject(snapshot)) return [];
  const rows = [];
  for (const key of ['markets', 'prices', 'tickers', 'data']) {
    const value = snapshot[key];
    if (Array.isArray(value))
      rows.push(...value.filter(isObject).map((row) => ({ ...row, source: key })));
    else if (isObject(value)) rows.push(...marketRowsFromObject(value, key));
  }
  if (
    [
      'price',
      'current_price',
      'mark_price',
      'last_price',
      'index_price',
      'funding_rate',
      'health',
    ].some((key) => snapshot[key] !== undefined)
  ) {
    rows.push({ ...snapshot, source: 'root' });
  }
  return rows;
}

function rowVenueId(row = {}) {
  return normalizeString(row.venue_id || row.venue || row.exchange || row.source_venue);
}

function rowSymbol(row = {}) {
  return normalizeString(
    row.symbol || row.market || row.instId || row.instrument || row.coin || row.asset || row.id
  );
}

function triggerVenueId(trigger = {}, task = {}) {
  return normalizeString(trigger.venue_id || trigger.venue || taskVenueId(task));
}

function triggerSymbol(trigger = {}, task = {}) {
  return normalizeString(
    trigger.symbol ||
      trigger.market ||
      trigger.instId ||
      trigger.instrument ||
      trigger.coin ||
      trigger.asset ||
      taskMarketSymbol(task)
  );
}

function findMarketRow(snapshot, trigger, task) {
  const venueId = triggerVenueId(trigger, task);
  const symbol = triggerSymbol(trigger, task);
  const rows = marketRows(snapshot);
  return (
    rows.find((row) => {
      const venueMatches = !venueId || !rowVenueId(row) || rowVenueId(row) === venueId;
      const symbolMatches =
        !symbol || !rowSymbol(row) || rowSymbol(row).toLowerCase() === symbol.toLowerCase();
      return venueMatches && symbolMatches;
    }) || null
  );
}

function rowPrice(row = {}) {
  return numericValue(
    row.current_price ??
      row.price ??
      row.mark_price ??
      row.markPx ??
      row.last_price ??
      row.last ??
      row.index_price ??
      row.mid
  );
}

function rowReferencePrice(row = {}, trigger = {}) {
  return numericValue(
    trigger.reference_price ??
      trigger.baseline_price ??
      trigger.previous_price ??
      row.reference_price ??
      row.baseline_price ??
      row.previous_price ??
      row.open_price ??
      row.start_price
  );
}

function rowFundingRate(row = {}) {
  return numericValue(row.funding_rate ?? row.fundingRate ?? row.predicted_funding_rate);
}

function thresholdPrice(trigger = {}) {
  return numericValue(
    trigger.threshold_price ??
      trigger.threshold ??
      trigger.price ??
      trigger.price_threshold ??
      trigger.target_price
  );
}

function thresholdBps(trigger = {}, ...keys) {
  for (const key of keys) {
    const number = numericValue(trigger[key]);
    if (number !== null) return number;
  }
  return numericValue(trigger.threshold_bps ?? trigger.bps);
}

function triggerType(trigger = {}) {
  const explicit = normalizeString(trigger.type || trigger.kind || trigger.condition).toLowerCase();
  if (explicit) return explicit;
  if (trigger.price_below !== undefined) return 'price_below';
  if (trigger.price_above !== undefined) return 'price_above';
  if (trigger.price_drop_bps !== undefined || trigger.drop_bps !== undefined)
    return 'price_drop_bps';
  if (trigger.price_rise_bps !== undefined || trigger.rise_bps !== undefined)
    return 'price_rise_bps';
  if (trigger.funding_rate_above !== undefined) return 'funding_rate_above';
  if (trigger.funding_rate_below !== undefined) return 'funding_rate_below';
  if (trigger.require_venue_health !== undefined || trigger.health !== undefined)
    return 'venue_health';
  return 'unknown';
}

function marketProof(row = {}, trigger = {}, task = {}) {
  return {
    venue_id: rowVenueId(row) || triggerVenueId(trigger, task) || null,
    symbol: rowSymbol(row) || triggerSymbol(trigger, task) || null,
    price: rowPrice(row),
    reference_price: rowReferencePrice(row, trigger),
    funding_rate: rowFundingRate(row),
    health: row.health || row.status || null,
    source: row.source || null,
  };
}

function healthyStatus(value) {
  const text = normalizeString(value).toLowerCase();
  return ['ok', 'healthy', 'online', 'ready', 'up'].includes(text);
}

function evaluateSingleTrigger(policy, task, options = {}) {
  const trigger = triggerDefinition(policy);
  if (!localPolicyTriggerGuardRequired(policy)) return skippedTrigger('trigger_guard_not_required');

  const type = triggerType(trigger);
  if (['always', 'immediate'].includes(type)) {
    return {
      status: 'ok',
      local_decision: 'trigger_satisfied',
      trigger_type: type,
    };
  }

  const snapshot = options.marketSnapshot || options.market_snapshot;
  if (!snapshot) {
    return blockedTrigger(
      'POLICY_MARKET_SNAPSHOT_REQUIRED',
      'Policy trigger requires a market snapshot before readiness or dispatch.',
      { trigger_type: type }
    );
  }

  const row = findMarketRow(snapshot, trigger, task);
  if (!row) {
    return blockedTrigger(
      'POLICY_MARKET_POINT_REQUIRED',
      'No market data matched policy trigger.',
      {
        trigger_type: type,
        venue_id: triggerVenueId(trigger, task) || null,
        symbol: triggerSymbol(trigger, task) || null,
      }
    );
  }
  const proof = marketProof(row, trigger, task);

  if (type === 'price_below') {
    const threshold = numericValue(trigger.price_below) ?? thresholdPrice(trigger);
    if (threshold === null || proof.price === null) {
      return blockedTrigger(
        'POLICY_PRICE_TRIGGER_BAD_DATA',
        'Price-below trigger needs price and threshold.',
        {
          trigger_type: type,
          market: proof,
        }
      );
    }
    if (proof.price <= threshold) {
      return {
        status: 'ok',
        local_decision: 'trigger_satisfied',
        trigger_type: type,
        threshold,
        market: proof,
      };
    }
    return notTriggered('Current price is above the policy trigger threshold.', {
      trigger_type: type,
      threshold,
      market: proof,
    });
  }

  if (type === 'price_above') {
    const threshold = numericValue(trigger.price_above) ?? thresholdPrice(trigger);
    if (threshold === null || proof.price === null) {
      return blockedTrigger(
        'POLICY_PRICE_TRIGGER_BAD_DATA',
        'Price-above trigger needs price and threshold.',
        {
          trigger_type: type,
          market: proof,
        }
      );
    }
    if (proof.price >= threshold) {
      return {
        status: 'ok',
        local_decision: 'trigger_satisfied',
        trigger_type: type,
        threshold,
        market: proof,
      };
    }
    return notTriggered('Current price is below the policy trigger threshold.', {
      trigger_type: type,
      threshold,
      market: proof,
    });
  }

  if (type === 'price_drop_bps') {
    const threshold = thresholdBps(trigger, 'price_drop_bps', 'drop_bps');
    if (
      threshold === null ||
      proof.price === null ||
      proof.reference_price === null ||
      proof.reference_price <= 0
    ) {
      return blockedTrigger(
        'POLICY_PRICE_TRIGGER_BAD_DATA',
        'Price-drop trigger needs current price, reference price and bps threshold.',
        {
          trigger_type: type,
          market: proof,
        }
      );
    }
    const observedBps = ((proof.reference_price - proof.price) / proof.reference_price) * 10_000;
    if (observedBps >= threshold) {
      return {
        status: 'ok',
        local_decision: 'trigger_satisfied',
        trigger_type: type,
        threshold_bps: threshold,
        observed_bps: observedBps,
        market: proof,
      };
    }
    return notTriggered('Observed price drop is below the policy trigger threshold.', {
      trigger_type: type,
      threshold_bps: threshold,
      observed_bps: observedBps,
      market: proof,
    });
  }

  if (type === 'price_rise_bps') {
    const threshold = thresholdBps(trigger, 'price_rise_bps', 'rise_bps');
    if (
      threshold === null ||
      proof.price === null ||
      proof.reference_price === null ||
      proof.reference_price <= 0
    ) {
      return blockedTrigger(
        'POLICY_PRICE_TRIGGER_BAD_DATA',
        'Price-rise trigger needs current price, reference price and bps threshold.',
        {
          trigger_type: type,
          market: proof,
        }
      );
    }
    const observedBps = ((proof.price - proof.reference_price) / proof.reference_price) * 10_000;
    if (observedBps >= threshold) {
      return {
        status: 'ok',
        local_decision: 'trigger_satisfied',
        trigger_type: type,
        threshold_bps: threshold,
        observed_bps: observedBps,
        market: proof,
      };
    }
    return notTriggered('Observed price rise is below the policy trigger threshold.', {
      trigger_type: type,
      threshold_bps: threshold,
      observed_bps: observedBps,
      market: proof,
    });
  }

  if (type === 'funding_rate_above' || type === 'funding_rate_below') {
    const threshold = numericValue(trigger[type] ?? trigger.threshold ?? trigger.funding_rate);
    if (threshold === null || proof.funding_rate === null) {
      return blockedTrigger(
        'POLICY_FUNDING_TRIGGER_BAD_DATA',
        'Funding trigger needs funding_rate and threshold.',
        {
          trigger_type: type,
          market: proof,
        }
      );
    }
    const satisfied =
      type === 'funding_rate_above'
        ? proof.funding_rate >= threshold
        : proof.funding_rate <= threshold;
    if (satisfied) {
      return {
        status: 'ok',
        local_decision: 'trigger_satisfied',
        trigger_type: type,
        threshold,
        market: proof,
      };
    }
    return notTriggered('Observed funding rate does not satisfy policy trigger.', {
      trigger_type: type,
      threshold,
      market: proof,
    });
  }

  if (type === 'venue_health') {
    const shouldBeHealthy = trigger.require_venue_health !== false;
    const observedHealthy = healthyStatus(proof.health);
    if (observedHealthy === shouldBeHealthy) {
      return {
        status: 'ok',
        local_decision: 'trigger_satisfied',
        trigger_type: type,
        market: proof,
      };
    }
    return notTriggered('Venue health does not satisfy policy trigger.', {
      trigger_type: type,
      market: proof,
      required_healthy: shouldBeHealthy,
    });
  }

  return blockedTrigger('POLICY_TRIGGER_UNSUPPORTED', 'Unsupported local policy trigger type.', {
    trigger_type: type,
  });
}

function combineAll(results) {
  const blocked = results.find(
    (result) => result.status === 'blocked' || result.status === 'error'
  );
  if (blocked) return blocked;
  const notSatisfied = results.find((result) => result.status === 'skipped');
  if (notSatisfied) return notSatisfied;
  return {
    status: 'ok',
    local_decision: 'trigger_satisfied',
    trigger_type: 'all',
    children: results,
  };
}

function combineAny(results) {
  const satisfied = results.find((result) => result.status === 'ok');
  if (satisfied) {
    return {
      status: 'ok',
      local_decision: 'trigger_satisfied',
      trigger_type: 'any',
      children: results,
    };
  }
  const blocked = results.find(
    (result) => result.status === 'blocked' || result.status === 'error'
  );
  return (
    blocked || {
      status: 'skipped',
      local_decision: 'trigger_not_satisfied',
      code: 'POLICY_TRIGGER_NOT_SATISFIED',
      message: 'No trigger in the any-set was satisfied.',
      trigger_type: 'any',
      children: results,
    }
  );
}

export function evaluateLocalPolicyTriggerGuard(policy = {}, task = {}, options = {}) {
  const trigger = triggerDefinition(policy);
  if (!localPolicyTriggerGuardRequired(policy)) return skippedTrigger('trigger_guard_not_required');

  if (Array.isArray(trigger.all)) {
    const results = trigger.all.map((child) =>
      evaluateLocalPolicyTriggerGuard({ ...policy, trigger: child }, task, options)
    );
    return combineAll(results);
  }

  if (Array.isArray(trigger.any)) {
    const results = trigger.any.map((child) =>
      evaluateLocalPolicyTriggerGuard({ ...policy, trigger: child }, task, options)
    );
    return combineAny(results);
  }

  return evaluateSingleTrigger(policy, task, options);
}
