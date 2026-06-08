export const RAW_WALLET_SECRET_FIELD_NAMES = [
  'secret',
  'api_secret',
  'apiSecret',
  'private_key',
  'privateKey',
  'passphrase',
  'password',
  'seed',
  'mnemonic',
  'token',
  'api_token',
  'apiToken',
  'ows_token',
  'owsToken',
  'wallet_token',
  'walletToken',
];

export const DEFAULT_WALLET_CAPABILITIES = ['read', 'sign', 'submit_tx'];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rawSecretFieldPath(value, prefix = '') {
  if (!isObject(value) && !Array.isArray(value)) return null;
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  for (const [key, child] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Array.isArray(value) && RAW_WALLET_SECRET_FIELD_NAMES.includes(key)) return path;
    const nested = rawSecretFieldPath(child, path);
    if (nested) return nested;
  }
  return null;
}

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function listValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

export function normalizeCaipAccount(input = {}) {
  const caip10 = normalizeString(input.caip10 || input.account || input.account_id);
  const chainId = normalizeString(input.chain_id || input.chainId || input.caip2);
  const address = normalizeString(
    input.address || input.account_address || input.wallet_address || input.public_key
  );
  const resolvedChainId = chainId || caip10.split(':').slice(0, 2).join(':');
  const resolvedAddress = address || caip10.split(':').slice(2).join(':');
  if (!resolvedChainId || !resolvedAddress) {
    return {
      status: 'error',
      code: 'BAD_CAIP_ACCOUNT',
      message: 'Wallet account requires chain_id plus address, or a CAIP-10 account string.',
    };
  }
  return {
    status: 'ok',
    account: {
      caip10: `${resolvedChainId}:${resolvedAddress}`,
      chain_id: resolvedChainId,
      address: resolvedAddress,
      label: input.label || null,
      capabilities: unique(listValue(input.capabilities)).length
        ? unique(listValue(input.capabilities))
        : DEFAULT_WALLET_CAPABILITIES,
    },
  };
}

export function parseWalletAccounts(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? { caip10: item } : item));
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((caip10) => ({ caip10 }));
}

export function validateWalletReference(input = {}) {
  if (!isObject(input)) {
    return {
      status: 'error',
      code: 'BAD_WALLET_REFERENCE',
      message: 'Wallet reference metadata must be an object.',
    };
  }
  const secretPath = rawSecretFieldPath(input);
  if (secretPath) {
    return {
      status: 'error',
      code: 'RAW_WALLET_SECRET_REJECTED',
      message: `Wallet references must not include raw secret field: ${secretPath}`,
      path: secretPath,
    };
  }

  const walletId = normalizeString(input.wallet_id || input.id || input.ows_wallet_id);
  if (!walletId) {
    return {
      status: 'error',
      code: 'WALLET_ID_REQUIRED',
      message: 'wallet_id is required.',
    };
  }
  const provider = normalizeString(input.provider || input.wallet_provider || 'ows').toLowerCase();
  if (provider !== 'ows') {
    return {
      status: 'error',
      code: 'WALLET_PROVIDER_UNSUPPORTED',
      message: 'Only OWS wallet references are supported in the local wallet store.',
    };
  }

  const accountResults = parseWalletAccounts(input.accounts || input.caip_accounts).map((account) =>
    normalizeCaipAccount(account)
  );
  const issues = accountResults.filter((result) => result.status !== 'ok');
  if (issues.length) {
    return {
      status: 'error',
      code: 'BAD_WALLET_ACCOUNTS',
      message: 'One or more wallet accounts are invalid.',
      issues,
    };
  }
  const accounts = accountResults.map((result) => result.account);
  if (!accounts.length) {
    return {
      status: 'error',
      code: 'WALLET_ACCOUNT_REQUIRED',
      message: 'At least one CAIP-10 wallet account is required.',
    };
  }

  return {
    status: 'ok',
    wallet: {
      wallet_id: walletId,
      provider,
      display_name: input.display_name || input.name || walletId,
      vault_path: input.vault_path || input.ows_vault_path || '~/.ows',
      policy_ids: unique(listValue(input.policy_ids || input.policies || input.policy_id)),
      capabilities: unique(listValue(input.capabilities)).length
        ? unique(listValue(input.capabilities))
        : DEFAULT_WALLET_CAPABILITIES,
      accounts,
      status: input.status || 'linked',
      linked_at: input.linked_at || new Date().toISOString(),
      updated_at: input.updated_at || new Date().toISOString(),
    },
  };
}

export function buildWalletReferenceSnapshot(records = []) {
  const validated = (records || []).map(validateWalletReference);
  const wallets = validated.filter((entry) => entry.status === 'ok').map((entry) => entry.wallet);
  const issues = validated.filter((entry) => entry.status !== 'ok');
  return {
    status: issues.length ? 'partial' : 'ok',
    wallet_count: wallets.length,
    account_count: wallets.reduce((sum, wallet) => sum + wallet.accounts.length, 0),
    wallets,
    issues,
    raw_secret_policy:
      'never put OWS tokens, wallet passphrases, private keys, seeds or mnemonics in wallet references',
  };
}

export function findWalletAccount(walletStore = {}, input = {}) {
  const chainId = normalizeString(input.chain_id || input.chainId || input.caip2);
  const address = normalizeString(
    input.address || input.account || input.owner || input.wallet_address
  );
  const caip10 = normalizeString(input.caip10 || input.account_id);
  const wallets = Array.isArray(walletStore?.wallets) ? walletStore.wallets : [];
  for (const wallet of wallets) {
    for (const account of wallet.accounts || []) {
      const accountCaip10 = normalizeString(account.caip10);
      const accountChainId = normalizeString(account.chain_id);
      const accountAddress = normalizeString(account.address);
      const caipMatch = caip10 && accountCaip10 === caip10;
      const chainAddressMatch =
        chainId &&
        address &&
        accountChainId === chainId &&
        accountAddress.toLowerCase() === address.toLowerCase();
      if (!caipMatch && !chainAddressMatch) continue;
      return {
        status: 'ok',
        wallet: {
          wallet_id: wallet.wallet_id,
          provider: wallet.provider,
          display_name: wallet.display_name,
          vault_path: wallet.vault_path,
          policy_ids: wallet.policy_ids || [],
          capabilities: wallet.capabilities || [],
          status: wallet.status,
        },
        account,
      };
    }
  }
  return {
    status: 'missing',
    code: 'WALLET_ACCOUNT_REF_MISSING',
    message: 'No linked OWS wallet reference matched the requested chain/account.',
    chain_id: chainId || null,
    address: address || null,
    caip10: caip10 || null,
  };
}
