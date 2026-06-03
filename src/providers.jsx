// Real zkLogin via Enoki + dapp-kit. Wraps the app in the Sui client + wallet
// providers and registers Enoki zkLogin wallets (Google) when configured.
// Without VITE_ENOKI_API_KEY / VITE_GOOGLE_CLIENT_ID the providers are still
// present, but no Enoki wallet is registered.
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
  useSuiClient,
} from '@mysten/dapp-kit';
import { registerEnokiWallets } from '@mysten/enoki';
import '@mysten/dapp-kit/dist/index.css';

const TESTNET_URL = 'https://fullnode.testnet.sui.io:443';
const { networkConfig } = createNetworkConfig({ testnet: { url: TESTNET_URL } });
const queryClient = new QueryClient();

const ENOKI_API_KEY = import.meta.env.VITE_ENOKI_API_KEY;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function RegisterEnoki() {
  const client = useSuiClient();
  useEffect(() => {
    if (!ENOKI_API_KEY || !GOOGLE_CLIENT_ID) return;
    const { unregister } = registerEnokiWallets({
      apiKey: ENOKI_API_KEY,
      client,
      network: 'testnet',
      providers: {
        google: {
          clientId: GOOGLE_CLIENT_ID,
          redirectUrl: window.location.origin + window.location.pathname,
        },
      },
    });
    return unregister;
  }, [client]);
  return null;
}

export function Providers({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <WalletProvider autoConnect={false}>
          <RegisterEnoki />
          {children}
        </WalletProvider>
      </SuiClientProvider>
      {import.meta.env.DEV && (
        <ReactQueryDevtools buttonPosition="bottom-right" position="bottom" />
      )}
    </QueryClientProvider>
  );
}
