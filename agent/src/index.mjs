#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

const VERSION = '0.1.0';
const DEFAULT_WORKER_URL = 'http://localhost:8787';
const DEFAULT_AGENT_ID = 'default';
const HEARTBEAT_MS = 30_000;

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`Sentry local daemon ${VERSION}

Usage:
  sentry-daemon --token <sk_daemon_xxx> [options]

Options:
  --worker-url <url>    Worker API base URL. Default: ${DEFAULT_WORKER_URL}
  --agent-id <id>       Local agent id. Default: ${DEFAULT_AGENT_ID}
  --agent-cmd <cmd>     External agent command to start on agent.start.
  --no-reconnect        Exit instead of reconnecting when the WebSocket closes.
  --print-config        Print redacted runtime config and exit.
  --help                Show this help.

Examples:
  npx @sentry/daemon --token sk_daemon_xxxx --worker-url https://sentry.example.workers.dev
  sentry-daemon --token sk_daemon_xxxx --agent-cmd "codex"
`);
}

function redact(value) {
  if (!value) return null;
  if (value.length <= 10) return '***';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function workerToWebSocketUrl(workerUrl, agentId, token) {
  const base = workerUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/api/local-agents/${encodeURIComponent(agentId)}/connect`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  return url.toString();
}

function parseCommandLine(commandLine) {
  if (!commandLine || !commandLine.trim()) return [];
  const parts = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match = re.exec(commandLine);
  while (match) {
    parts.push(match[1] ?? match[2] ?? match[3]);
    match = re.exec(commandLine);
  }
  return parts;
}

function truncate(value, max = 4000) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function makeEnvelope(kind, payload = {}, extra = {}) {
  return {
    kind,
    message_id: `${kind}_${crypto.randomUUID()}`,
    issued_at: new Date().toISOString(),
    payload,
    ...extra,
  };
}

function main() {
  if (hasArg('--help') || hasArg('-h')) {
    usage();
    return;
  }
  if (typeof WebSocket !== 'function') {
    console.error(
      'Node.js >=22 is required because this daemon uses the built-in WebSocket client.'
    );
    process.exitCode = 1;
    return;
  }

  const token = readArg('--token', process.env.SENTRY_DAEMON_TOKEN);
  const workerUrl = readArg('--worker-url', process.env.SENTRY_WORKER_URL || DEFAULT_WORKER_URL);
  const agentId = readArg('--agent-id', process.env.SENTRY_AGENT_ID || DEFAULT_AGENT_ID);
  const defaultAgentCommand = readArg('--agent-cmd', process.env.SENTRY_AGENT_COMMAND || '');
  const noReconnect = hasArg('--no-reconnect');

  const config = {
    workerUrl,
    agentId,
    token: redact(token),
    defaultAgentCommand: defaultAgentCommand || null,
    noReconnect,
  };

  if (hasArg('--print-config')) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  if (!token) {
    console.error('Missing daemon token. Pass --token <sk_daemon_xxx> or set SENTRY_DAEMON_TOKEN.');
    process.exitCode = 1;
    return;
  }

  let ws = null;
  let reconnectAttempt = 0;
  let heartbeatTimer = null;
  let child = null;
  let childCommand = null;
  let childStartedAt = null;

  function log(event, detail = {}) {
    console.log(JSON.stringify({ t: new Date().toISOString(), event, ...detail }));
  }

  function activeProcess() {
    if (!child) return null;
    return {
      pid: child.pid,
      command: childCommand,
      started_at: childStartedAt,
    };
  }

  function statusPayload() {
    return {
      daemon_version: VERSION,
      pid: process.pid,
      uptime_seconds: Math.round(process.uptime()),
      active_process: activeProcess(),
      capabilities: ['agent.status', 'agent.start', 'agent.stop', 'stdio.output'],
    };
  }

  function send(kind, payload = {}, extra = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(makeEnvelope(kind, payload, extra)));
    return true;
  }

  function sendResult(original, payload) {
    send('command_result', payload, {
      idempotency_key: original.idempotency_key,
      payload: {
        command_message_id: original.message_id ?? null,
        ...payload,
      },
    });
  }

  function startExternalAgent(commandLine) {
    if (child) {
      return { status: 'ok', already_running: true, active_process: activeProcess() };
    }
    const parts = parseCommandLine(commandLine || defaultAgentCommand);
    if (!parts.length) {
      return {
        status: 'error',
        code: 'AGENT_COMMAND_REQUIRED',
        message: 'agent.start requires payload.command or --agent-cmd.',
      };
    }
    const [cmd, ...args] = parts;
    childCommand = [cmd, ...args].join(' ');
    childStartedAt = new Date().toISOString();
    child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    child.stdout.on('data', (chunk) => {
      send('agent.output', {
        stream: 'stdout',
        pid: child?.pid ?? null,
        text: truncate(chunk.toString()),
      });
    });
    child.stderr.on('data', (chunk) => {
      send('agent.output', {
        stream: 'stderr',
        pid: child?.pid ?? null,
        text: truncate(chunk.toString()),
      });
    });
    child.on('exit', (code, signal) => {
      send('agent.output', {
        stream: 'system',
        pid: child?.pid ?? null,
        text: `process exited code=${code ?? 'null'} signal=${signal ?? 'null'}`,
      });
      child = null;
      childCommand = null;
      childStartedAt = null;
    });
    return { status: 'ok', active_process: activeProcess() };
  }

  function stopExternalAgent() {
    if (!child) return { status: 'ok', already_stopped: true };
    const stopped = child.kill('SIGTERM');
    return { status: 'ok', stopping: stopped, active_process: activeProcess() };
  }

  function handleCommand(message) {
    const payload = message.payload || {};
    const type = payload.type;
    send('command_ack', {
      command_message_id: message.message_id ?? null,
      type,
      accepted: true,
    });
    if (type === 'agent.status') {
      sendResult(message, { status: 'ok', agent: statusPayload() });
      return;
    }
    if (type === 'agent.start') {
      sendResult(message, startExternalAgent(payload.command));
      return;
    }
    if (type === 'agent.stop') {
      sendResult(message, stopExternalAgent());
      return;
    }
    sendResult(message, {
      status: 'error',
      code: 'UNSUPPORTED_REMOTE_COMMAND',
      message: `Unsupported command: ${type}`,
    });
  }

  function connect() {
    const wsUrl = workerToWebSocketUrl(workerUrl, agentId, token);
    log('bridge.connecting', { workerUrl, agentId, token: redact(token) });
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => {
      reconnectAttempt = 0;
      log('bridge.connected', { agentId });
      send('hello', statusPayload());
      heartbeatTimer = setInterval(() => send('heartbeat', statusPayload()), HEARTBEAT_MS);
    });
    ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        log('bridge.bad_json');
        return;
      }
      if (message.kind === 'command') handleCommand(message);
      if (message.kind === 'session_accepted')
        log('bridge.session_accepted', message.payload || {});
    });
    ws.addEventListener('close', (event) => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      log('bridge.closed', { code: event.code, reason: event.reason || null });
      if (noReconnect) return;
      const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      setTimeout(connect, delay);
    });
    ws.addEventListener('error', () => {
      log('bridge.error');
    });
  }

  connect();
}

main();
