#!/usr/bin/env node

// Read-only diagnostic for the peer request in TokenQuoteSync.pullPrice().
// Run in the same container/environment as stat_task to inspect its KV settings.
process.env.DEBUG = process.env.DEBUG || 'proxy-agent*,http-proxy-agent*,https-proxy-agent*';

const dns = require('dns').promises;
const net = require('net');
const {Sequelize, QueryTypes} = require('sequelize');
const superagent = require('superagent');
const {ProxyAgent} = require('proxy-agent');

const PEER_URLS = {
  1029: 'https://www.confluxscan.org',
  1030: 'https://evm.confluxscan.org',
};
const DEFAULT_PROXY = 'http://127.0.0.1:1080';
const TIMEOUT_MS = 13000;

function log(step, details) {
  console.log(`[${new Date().toISOString()}] ${step}`, details || '');
}

function usage() {
  console.log('Usage: npm run debug:peer-quote -- --network-id 1030 [--address ADDRESS ...] [--peer-url URL] [--skip-db] [--no-proxy] [--proxy-url URL]');
  console.log('By default, reads the live KV proxy settings and token addresses from the configured database.');
  console.log('Use --skip-db with --address to diagnose without database access; KV settings are then unavailable.');
}

function parseArgs(args) {
  const options = {addresses: []};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') { options.help = true; continue; }
    if (arg === '--skip-db' || arg === '--no-proxy') {
      options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
      continue;
    }
    if (!['--network-id', '--address', '--peer-url', '--proxy-url'].includes(arg) || !args[i + 1]) {
      throw new Error(`Unknown or incomplete option: ${arg}`);
    }
    const value = args[++i];
    if (arg === '--address') options.addresses.push(value);
    else options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return options;
}

function safeProxyUrl(value) {
  const url = new URL(value);
  url.username = '';
  url.password = '';
  return url.toString();
}

async function probeProxy(url) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  const started = Date.now();
  await new Promise((resolve, reject) => {
    const socket = net.connect({host, port});
    socket.setTimeout(3000);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('TCP probe timed out after 3000ms')); });
    socket.once('error', reject);
  });
  log('proxy TCP reachable', {host, port, elapsedMs: Date.now() - started});
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { usage(); return; }
  const networkId = Number(options.networkId);
  const peerBase = options.peerUrl || PEER_URLS[networkId];
  if (!peerBase || !Number.isInteger(networkId)) {
    usage();
    throw new Error('Provide --network-id 1029 or 1030, or a numeric network ID with --peer-url');
  }
  if (options.skipDb && !options.addresses.length) {
    throw new Error('--skip-db requires at least one --address');
  }
  if (options.noProxy && options.proxyUrl) {
    throw new Error('--no-proxy and --proxy-url cannot be combined');
  }

  log('debug mode enabled', {DEBUG: process.env.DEBUG, networkId, peerBase, timeoutMs: TIMEOUT_MS});
  let sequelize;
  let proxyAgent;
  let kvProxy;
  let kvDisableProxy;
  try {
    if (!options.skipDb) {
      const {loadConfig} = require('../stat/config/StatConfig');
      const config = loadConfig('Prod');
      if (!config.database) throw new Error('Database configuration is missing; use --skip-db with --address');
      log('connecting to configured database', {instanceName: config.database.instanceName, host: config.database.host});
      sequelize = new Sequelize(config.database.instanceName, null, null, {...config.database, logging: false});
      await sequelize.authenticate();
      log('database connected');
      const rows = await sequelize.query(
        'SELECT `key`, `value` FROM `config` WHERE `key` IN (:keys)',
        {replacements: {keys: ['KEY_TOKEN_QUOTE_DISABLE_PROXY', 'KEY_TOKEN_QUOTE_PROXY']}, type: QueryTypes.SELECT},
      );
      const settings = Object.fromEntries(rows.map(row => [row.key, row.value]));
      kvDisableProxy = String(settings.KEY_TOKEN_QUOTE_DISABLE_PROXY || '').toLowerCase() === 'true';
      kvProxy = settings.KEY_TOKEN_QUOTE_PROXY || null;
      log('KV settings loaded', {disableProxy: kvDisableProxy, proxyUrl: kvProxy ? safeProxyUrl(kvProxy) : '(unset)'});
      if (!options.addresses.length) {
        const tokens = await sequelize.query(
          'SELECT `base32` AS address FROM `token` WHERE `bnId` IS NOT NULL OR `cmcId` IS NOT NULL',
          {type: QueryTypes.SELECT},
        );
        options.addresses = tokens.map(token => token.address);
        log('token list loaded', {count: options.addresses.length});
      }
    } else {
      log('database skipped; KV settings are not available');
    }

    if (!options.addresses.length) throw new Error('No token addresses to request; pass --address ADDRESS');
    const disableProxy = options.noProxy || (!options.proxyUrl && kvDisableProxy === true);
    const proxyUrl = options.proxyUrl || kvProxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || DEFAULT_PROXY;
    const proxySource = options.proxyUrl ? 'CLI' : kvProxy ? 'KV' : process.env.HTTPS_PROXY ? 'HTTPS_PROXY' : process.env.HTTP_PROXY ? 'HTTP_PROXY' : 'default';
    if (!disableProxy && (new URL(proxyUrl).username || new URL(proxyUrl).password)) {
      require('debug').disable();
      log('library proxy debug disabled to avoid printing proxy credentials');
    }
    log('proxy decision', {enabled: !disableProxy, source: disableProxy ? 'disabled by CLI/KV' : proxySource,
      url: disableProxy ? '(direct)' : safeProxyUrl(proxyUrl)});

    const peer = new URL(peerBase);
    try {
      const resolved = await dns.lookup(peer.hostname, {all: true});
      log('peer DNS resolved', {hostname: peer.hostname, addresses: resolved});
    } catch (error) {
      log('peer DNS lookup failed (proxy may resolve peer remotely)', {hostname: peer.hostname, code: error.code, message: error.message});
    }
    if (!disableProxy) {
      try { await probeProxy(proxyUrl); }
      catch (error) { log('proxy TCP probe failed', {code: error.code, message: error.message}); }
    }

    const requestUrl = new URL('/v1/token', peerBase);
    for (const address of options.addresses) requestUrl.searchParams.append('addressArray', address);
    log('sending peer request', {host: requestUrl.host, path: requestUrl.pathname,
      addressCount: options.addresses.length, responseTimeoutMs: TIMEOUT_MS, deadlineMs: TIMEOUT_MS});
    const request = superagent.get(requestUrl.toString()).timeout({response: TIMEOUT_MS, deadline: TIMEOUT_MS});
    if (!disableProxy) {
      proxyAgent = new ProxyAgent({getProxyForUrl: () => proxyUrl});
      request.agent(proxyAgent);
    }
    request.on('request', () => log('request dispatched'));
    request.on('response', response => log('response received', {status: response.status, contentType: response.headers['content-type']}));
    const started = Date.now();
    try {
      const response = await request;
      const tokenList = response.body?.data?.list || response.body?.result?.list;
      log('request completed', {elapsedMs: Date.now() - started, status: response.status,
        bodyKeys: Object.keys(response.body || {}), quoteCount: Array.isArray(tokenList) ? tokenList.length : null});
      if (!Array.isArray(tokenList)) throw new Error('Response has no data.list or result.list array');
    } catch (error) {
      log('request failed', {elapsedMs: Date.now() - started, name: error.name, code: error.code,
        errno: error.errno, status: error.status, timeout: error.timeout, message: error.message,
        cause: error.cause?.message});
      throw error;
    }
  } finally {
    if (proxyAgent) proxyAgent.destroy();
    if (sequelize) { await sequelize.close(); log('database connection closed'); }
  }
}

main().then(() => process.exit(0)).catch(error => {
  log('diagnostic failed', {message: error.message});
  // A timed-out proxy tunnel can leave an open socket after Superagent aborts.
  process.exit(1);
});
