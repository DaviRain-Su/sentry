export function validateTickAuthorization({ authorizationHeader, expectedToken }) {
  if (!expectedToken || authorizationHeader !== `Bearer ${expectedToken}`) {
    return {
      ok: false,
      status: 401,
      body: {
        status: 'error',
        code: 'INVALID_AUTHORIZATION',
        blocker_code: 'INVALID_AUTHORIZATION',
        blocker_label: 'Invalid authorization',
        blocker_codes: ['INVALID_AUTHORIZATION'],
        blocker_labels: ['Invalid authorization'],
        message: 'Invalid internal token.',
        execution_claimed: false,
      },
    }
  }
  return { ok: true }
}

export function validateForceTrigger({ forceTriggerRequested, demoMode }) {
  if (forceTriggerRequested && demoMode !== 'true') {
    return {
      ok: false,
      status: 403,
      body: {
        status: 'error',
        code: 'FORCE_TRIGGER_DISABLED',
        blocker_code: 'FORCE_TRIGGER_DISABLED',
        blocker_label: 'Force trigger disabled',
        blocker_codes: ['FORCE_TRIGGER_DISABLED'],
        blocker_labels: ['Force trigger disabled'],
        message: 'force_trigger is only accepted when SENTRY_DEMO_MODE=true.',
        force_trigger_allowed: false,
        execution_claimed: false,
      },
    }
  }
  return { ok: true, forceTrigger: Boolean(forceTriggerRequested) }
}
