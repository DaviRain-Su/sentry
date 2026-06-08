export function isSessionRevokedMessage(message = {}) {
  return message?.kind === 'session_revoked';
}

export function isRevokedCloseEvent(event = {}) {
  const reason = String(event.reason || '').toLowerCase();
  return Number(event.code) === 1008 && reason.includes('revoked');
}

export function shouldReconnectBridge({
  noReconnect = false,
  bridgeRevoked = false,
  closeEvent = {},
} = {}) {
  if (noReconnect) return false;
  if (bridgeRevoked) return false;
  if (isRevokedCloseEvent(closeEvent)) return false;
  return true;
}
