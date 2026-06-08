export const SOLANA_MAINNET_CHAIN_ID = 'solana:mainnet';
export const ETHEREUM_MAINNET_CHAIN_ID = 'eip155:1';
export const SOLANA_MAINNET_VENUE_ID = 'solana-mainnet';
export const ETHEREUM_MAINNET_VENUE_ID = 'ethereum-mainnet';

export const TOKEN_REGISTRY = [
  {
    chain_id: SOLANA_MAINNET_CHAIN_ID,
    venue_id: SOLANA_MAINNET_VENUE_ID,
    symbol: 'SOL',
    address: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    native: true,
    aliases: ['WSOL'],
  },
  {
    chain_id: SOLANA_MAINNET_CHAIN_ID,
    venue_id: SOLANA_MAINNET_VENUE_ID,
    symbol: 'USDC',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    native: false,
    aliases: [],
  },
  {
    chain_id: ETHEREUM_MAINNET_CHAIN_ID,
    venue_id: ETHEREUM_MAINNET_VENUE_ID,
    symbol: 'ETH',
    address: 'native',
    decimals: 18,
    native: true,
    aliases: [],
  },
  {
    chain_id: ETHEREUM_MAINNET_CHAIN_ID,
    venue_id: ETHEREUM_MAINNET_VENUE_ID,
    symbol: 'WETH',
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    decimals: 18,
    native: false,
    aliases: [],
  },
  {
    chain_id: ETHEREUM_MAINNET_CHAIN_ID,
    venue_id: ETHEREUM_MAINNET_VENUE_ID,
    symbol: 'USDC',
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    decimals: 6,
    native: false,
    aliases: [],
  },
];

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeSymbol(value) {
  return normalizeString(value).toUpperCase();
}

function normalizeAddress(value) {
  const text = normalizeString(value);
  return text.startsWith('0x') ? text.toLowerCase() : text;
}

function normalizeToken(input = {}) {
  const symbol = normalizeSymbol(input.symbol || input.ticker);
  const address = normalizeAddress(input.address || input.mint || input.token_contract);
  if (!symbol || !address) return null;
  return {
    chain_id: normalizeString(input.chain_id || input.chainId || input.caip2),
    venue_id: normalizeString(input.venue_id || input.venueId),
    symbol,
    address,
    decimals: Number(input.decimals ?? 0),
    native: Boolean(input.native),
    aliases: Array.isArray(input.aliases) ? input.aliases.map(normalizeSymbol).filter(Boolean) : [],
  };
}

export function getTokenRegistrySnapshot(tokens = TOKEN_REGISTRY) {
  const normalized = tokens.map(normalizeToken).filter(Boolean);
  return {
    status: 'ok',
    token_count: normalized.length,
    chains: [...new Set(normalized.map((token) => token.chain_id))],
    tokens: normalized,
  };
}

export function tokensForChain(chainId, tokens = TOKEN_REGISTRY) {
  const chain = normalizeString(chainId);
  return getTokenRegistrySnapshot(tokens).tokens.filter((token) => token.chain_id === chain);
}

export function getTokenBySymbol(chainId, symbol, tokens = TOKEN_REGISTRY) {
  const wanted = normalizeSymbol(symbol);
  return (
    tokensForChain(chainId, tokens).find(
      (token) => token.symbol === wanted || token.aliases.includes(wanted)
    ) || null
  );
}

export function getTokenByAddress(chainId, address, tokens = TOKEN_REGISTRY) {
  const wanted = normalizeAddress(address);
  return tokensForChain(chainId, tokens).find((token) => token.address === wanted) || null;
}

export function parseTokenList(value, defaults = {}) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((token) =>
        normalizeToken({
          ...defaults,
          ...token,
        })
      )
      .filter(Boolean);
  }
  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    return parseTokenList(JSON.parse(text), defaults);
  }
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [symbol, address, decimals = defaults.decimals ?? '18'] = item.split(':');
      return normalizeToken({
        ...defaults,
        symbol,
        address,
        decimals,
      });
    })
    .filter(Boolean);
}
