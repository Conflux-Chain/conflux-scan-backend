import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import {URL} from 'url';
import axios, {AxiosResponse} from 'axios';

export interface SafeFetchOptions {
    timeoutMs?: number;
    maxBytes?: number;
    allowedHosts?: string[];
}

const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_SAFE_FETCH_MAX_BYTES = 1024 * 1024; // 1MB

function ipToLong(ip: string): number {
    return ip.split('.').reduce((acc, octet) => {
        return ((acc << 8) + Number.parseInt(octet, 10)) >>> 0;
    }, 0);
}

function inIPv4Range(ip: string, start: string, end: string): boolean {
    const n = ipToLong(ip);
    return n >= ipToLong(start) && n <= ipToLong(end);
}

function isPrivateIPv4(ip: string): boolean {
    return (
        inIPv4Range(ip, '0.0.0.0', '0.255.255.255') ||            // 0.0.0.0/8
        inIPv4Range(ip, '10.0.0.0', '10.255.255.255') ||          // RFC1918
        inIPv4Range(ip, '100.64.0.0', '100.127.255.255') ||       // CGNAT
        inIPv4Range(ip, '127.0.0.0', '127.255.255.255') ||        // loopback
        inIPv4Range(ip, '169.254.0.0', '169.254.255.255') ||      // link-local / metadata
        inIPv4Range(ip, '172.16.0.0', '172.31.255.255') ||        // RFC1918
        inIPv4Range(ip, '192.168.0.0', '192.168.255.255') ||      // RFC1918
        inIPv4Range(ip, '224.0.0.0', '255.255.255.255')           // multicast/reserved
    );
}

function isPrivateIPv6(ip: string): boolean {
    const normalized = ip.toLowerCase();

    return (
        normalized === '::1' ||                   // loopback
        normalized === '::' ||
        normalized.startsWith('fc') ||            // fc00::/7
        normalized.startsWith('fd') ||            // fd00::/8
        normalized.startsWith('fe80') ||          // link-local
        normalized.startsWith('::ffff:127.') ||
        normalized.startsWith('::ffff:10.') ||
        normalized.startsWith('::ffff:192.168.') ||
        normalized.startsWith('::ffff:169.254.') ||
        /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
    );
}

function isForbiddenIp(ip: string): boolean {
    const family = net.isIP(ip);

    if (family === 4) return isPrivateIPv4(ip);
    if (family === 6) return isPrivateIPv6(ip);

    return true;
}

async function resolvePublicAddresses(hostname: string): Promise<string[]> {
    const records = await dns.promises.lookup(hostname, {all: true, verbatim: true});

    if (!records.length) {
        throw new Error('host resolution failed');
    }

    const addresses = records.map(item => item.address);

    for (const addr of addresses) {
        if (isForbiddenIp(addr)) {
            throw new Error(`forbidden host ip: ${addr}`);
        }
    }

    return addresses;
}

function assertAllowedProtocol(protocol: string): void {
    if (protocol !== 'http:' && protocol !== 'https:') {
        throw new Error(`unsupported protocol: ${protocol}`);
    }
}

function assertAllowedHost(hostname: string, allowedHosts?: string[]): void {
    if (!allowedHosts || allowedHosts.length === 0) {
        return;
    }

    const normalized = hostname.toLowerCase();
    const ok = allowedHosts.some(item => item.toLowerCase() === normalized);
    if (!ok) {
        throw new Error(`host is not allowlisted: ${hostname}`);
    }
}

async function validateFetchTarget(rawUrl: string, options: SafeFetchOptions = {}) {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error('invalid url');
    }

    assertAllowedProtocol(parsed.protocol);

    if (!parsed.hostname) {
        throw new Error('hostname is empty');
    }

    assertAllowedHost(parsed.hostname, options.allowedHosts);

    const addresses = await resolvePublicAddresses(parsed.hostname);

    return {finalUrl: parsed.toString(), hostname: parsed.hostname, addresses};
}

export async function validateFetchUrl(rawUrl: string, options: SafeFetchOptions = {}): Promise<string> {
    return (await validateFetchTarget(rawUrl, options)).finalUrl;
}

function createPinnedLookup(expectedHostname: string, addresses: string[]) {
    return (hostname: string, lookupOptions: any, callback: Function) => {
        if (hostname.toLowerCase() !== expectedHostname.toLowerCase()) {
            callback(new Error(`unexpected lookup hostname: ${hostname}`));
            return;
        }

        const family = typeof lookupOptions === 'number' ? lookupOptions : lookupOptions?.family;
        const candidates = family ? addresses.filter(address => net.isIP(address) === family) : addresses;
        if (!candidates.length) {
            callback(new Error(`no validated address for address family ${family}`));
            return;
        }
        if (lookupOptions?.all) {
            callback(null, candidates.map(address => ({address, family: net.isIP(address)})));
            return;
        }
        callback(null, candidates[0], net.isIP(candidates[0]));
    };
}

export async function safeFetch(
    rawUrl: string,
    options: SafeFetchOptions = {}
) {
    const {finalUrl, hostname, addresses} = await validateFetchTarget(rawUrl, options);
    const lookup = createPinnedLookup(hostname, addresses);

    const response: AxiosResponse<string> = await axios.get(finalUrl, {
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        responseType: 'text',
        maxRedirects: 0, // critical: do not follow redirects
        maxContentLength: options.maxBytes ?? DEFAULT_SAFE_FETCH_MAX_BYTES,
        maxBodyLength: options.maxBytes ?? DEFAULT_SAFE_FETCH_MAX_BYTES,
        httpAgent: new http.Agent({lookup} as any),
        httpsAgent: new https.Agent({lookup} as any),
        proxy: false,
    });

    return response.data;
}
