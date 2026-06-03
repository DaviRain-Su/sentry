// G1 — print the config a fresh clone needs: on-chain ids + env templates.
//   node scripts/demo-config.mjs
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync(new URL('../deployment.testnet.json', import.meta.url), 'utf8'));
const line = '─'.repeat(64);

console.log(`${line}\nSentry — Sui Testnet deployment\n${line}`);
console.log(`chain                ${d.chain}`);
console.log(`sentry package   ${d.sentry.package_id}`);
console.log(`agent address        ${d.agent.address}`);
console.log(`agent passport       ${d.agent.passport_id}`);
console.log(`agent BalanceManager ${d.agent.balance_manager_id}  (unfunded — DBUSDC pending)`);
console.log(`MoveGate (orig)      ${d.movegate.package_id_original}`);
console.log(
  `Deepbook pool        ${d.deepbook.pools[d.deepbook.default_pool].pool_id}  (${d.deepbook.default_pool})`
);

console.log(`\n${line}\nfrontend  ->  .env.local\n${line}`);
console.log(`VITE_WORKER_URL=http://localhost:8787`);
console.log(`VITE_ENOKI_API_KEY=        # enoki public key (portal.enoki.mystenlabs.com)`);
console.log(`VITE_GOOGLE_CLIENT_ID=     # Google OAuth web client id`);

console.log(`\n${line}\nworker  ->  worker/.dev.vars\n${line}`);
console.log(
  `AGENT_KEY: set locally                 # generated: node worker/scripts/gen-agent-key.mjs`
);
console.log(`INTERNAL_AGENT_TICK_TOKEN: set locally # never print the raw token in evidence`);
console.log(`SENTRY_DEMO_MODE: true|false`);
console.log(
  `EXECUTION_ENABLED: false               # flip to true only once usable DBUSDC/DEEP funding is verified`
);
console.log(`\nRun:  (worker) cd worker && npm i && npm run dev`);
console.log(`      (web)    npm i && npm run dev   # http://localhost:5173`);
console.log(line);
