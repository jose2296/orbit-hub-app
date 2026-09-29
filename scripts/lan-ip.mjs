#!/usr/bin/env node
/**
 * Find this machine's LAN address, so a phone on the same WiFi can reach both
 * the API and the Metro dev server.
 *
 *   node scripts/lan-ip.mjs             print the address
 *   node scripts/lan-ip.mjs api-url     print the API base URL for a device
 *   node scripts/lan-ip.mjs exec <cmd>  run <cmd> with EXPO_PUBLIC_API_URL set
 *
 * Why this injects a shell variable instead of rewriting apps/mobile/.env:
 * Expo inlines EXPO_PUBLIC_* into the bundle, and @expo/env never overwrites a
 * variable that is already present in the environment. The shell therefore wins
 * for this one command, while the .env keeps serving the web target, the
 * simulators and anyone who clones the repo.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { API_PREFIX } from '@orbit-hub/config';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Virtual interfaces a phone on the same WiFi can never reach. */
const VIRTUAL = /^(docker|br-|veth|utun|tun|tap|wg|zt|virbr|awdl|llw|anpi)/i;

/**
 * Higher is a better guess. A phone on the same WiFi needs an address on the
 * subnet the router gave us, so a home WiFi address outranks everything else.
 */
function rank(name, address) {
  let score = 0;
  if (/^en0$/i.test(name)) score += 100; // macOS WiFi
  else if (/^(en\d+|eth\d+|wi-?fi|ethernet)$/i.test(name)) score += 60;
  if (address.startsWith('192.168.')) score += 40; // most home routers
  else if (address.startsWith('10.')) score += 30; // corporate / campus
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score += 20;
  else if (address.startsWith('100.')) score -= 50; // CGNAT, e.g. Tailscale
  else score -= 10; // a public IP bound to the interface
  return score;
}

function lanAddress() {
  const override = process.env.ORBIT_LAN_IP?.trim();
  if (override) return override;

  const candidates = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const { family, address, internal } of addresses ?? []) {
      // Node 18+ reports 'IPv4'; older runtimes report the number 4.
      if (family !== 'IPv4' && family !== 4) continue;
      if (internal) continue;
      if (address.startsWith('169.254.')) continue; // link-local autoconfig
      if (VIRTUAL.test(name)) continue;
      candidates.push({ name, address, score: rank(name, address) });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length === 0) {
    throw new Error(
      'No LAN address found. Connect to a WiFi network, or set ORBIT_LAN_IP manually.',
    );
  }
  return candidates[0].address;
}

/** The API port, read from the same .env the API itself uses. */
function apiPort() {
  const fromShell = process.env.PORT?.trim();
  if (fromShell) return fromShell;
  try {
    const line = readFileSync(join(root, 'apps', 'api', '.env'), 'utf8')
      .split('\n')
      .find((entry) => entry.startsWith('PORT='));
    if (line) return line.slice('PORT='.length).trim();
  } catch {
    // No .env yet; the API defaults to 4000.
  }
  return '4000';
}

function deviceApiUrl() {
  // An explicit value always wins, so a developer can point one run at a tunnel.
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  return `http://${lanAddress()}:${apiPort()}${API_PREFIX}`;
}

function run(argv, url) {
  const child = spawn(argv[0], argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, EXPO_PUBLIC_API_URL: url },
  });
  // Forward the interrupts so ^C reaches Metro and the API, not just this script.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

const [mode = 'address', ...rest] = process.argv.slice(2);

try {
  if (mode === 'address') {
    console.log(lanAddress());
  } else if (mode === 'api-url') {
    console.log(deviceApiUrl());
  } else if (mode === 'exec') {
    if (rest.length === 0) {
      console.error('Usage: node scripts/lan-ip.mjs exec <command> [args...]');
      process.exit(2);
    }
    const url = deviceApiUrl();
    console.error(`[lan-ip] EXPO_PUBLIC_API_URL=${url}`);
    run(rest, url);
  } else {
    console.error(`Unknown mode: ${mode}. Use address, api-url or exec.`);
    process.exit(2);
  }
} catch (error) {
  console.error(`[lan-ip] ${error.message}`);
  process.exit(1);
}
