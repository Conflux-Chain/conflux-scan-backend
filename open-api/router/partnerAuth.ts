import {getClientIP, IRateKey, lookupRateKey} from "../../stat/router/RateLimiter";

/**
 * Scope-checked auth for the partner registry endpoints.
 *
 * Shaped after the Router's admin usage APIs: a bearer credential carrying a
 * scope, `401` when the credential itself is bad and `403` when it is valid but
 * lacks the scope. Those endpoints are all read-only and use `usage:read`;
 * this module adds the write half the registry needs.
 *
 * Credentials live in `rate_key`, which the rate limiter already refreshes into
 * memory every 10s, so a check here costs no query. Keys predating the `scope`
 * column grant nothing -- existing rate-limiting keys must not silently become
 * able to rewrite attribution.
 *
 * This is deliberately not an implementation of the Router's `mk-` keys.
 * Validating those needs either token introspection against the Router or a
 * shared signing secret, and, more importantly, a way to learn which
 * `source_id` a token may act for. Until that exists, the supported topology is
 * a service credential held by the Solutions Hub backend, which already knows
 * which partner the signed-in user belongs to and authorizes on its own side.
 */

/**
 * Bad-request signal for the partner endpoints.
 *
 * The shared `handleException` only special-cases `InvalidParamError`, so a
 * `LogicError` thrown from a handler falls through to its 500 branch: HTTP 200
 * with a 500-shaped body, plus a line in the error log. These endpoints answer
 * with the Router's convention instead -- HTTP 400 and a machine-readable code
 * -- so `requireScope` catches this on the way out.
 */
export class PartnerParamError extends Error {
    public readonly code: string;

    constructor(code: string, message?: string) {
        super(message || code);
        this.code = code;
    }
}

export const SCOPE_PARTNER_READ = 'partner:read';
export const SCOPE_PARTNER_WRITE = 'partner:write';

export interface IPartnerPrincipal {
    rateKeyId: number
    actor: string
    scopes: string[]
    ip: string
}

function fail(ctx, status: number, code: string, message: string) {
    ctx.status = status;
    ctx.body = {object: 'error', code, message};
}

/**
 * Bearer first, matching the Router. The legacy `?apiKey=` form is accepted so
 * an operator can curl an endpoint, but note the existing rate limiter also
 * reads `ctx.headers['apiKey']`, which never matches -- Node lower-cases
 * incoming header names -- so that path is not a real alternative today.
 */
function extractKey(ctx): string {
    const auth = ctx.headers['authorization'] || '';
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) {
        return m[1].trim();
    }
    return (ctx.request?.query?.apiKey || ctx.headers['apikey'] || '').toString().trim();
}

function parseScopes(key: IRateKey): string[] {
    return (key.scope || '').split(/\s+/).filter(Boolean);
}

function withinValidity(key: IRateKey, now: number): boolean {
    const from = key.effectiveAt ? new Date(key.effectiveAt).getTime() : 0;
    const to = key.expireAt ? new Date(key.expireAt).getTime() : Number.MAX_SAFE_INTEGER;
    return from <= now && now <= to;
}

/**
 * Koa middleware requiring `scope`. On success it leaves the caller on
 * `ctx.state.partnerPrincipal` so handlers can record who acted.
 */
export function requireScope(scope: string) {
    return async function partnerAuth(ctx, next) {
        const raw = extractKey(ctx);
        if (!raw) {
            return fail(ctx, 401, 'invalid_auth', 'Missing credential. Send `Authorization: Bearer <key>`.');
        }
        const key = lookupRateKey(raw);
        if (!key) {
            return fail(ctx, 401, 'invalid_auth', 'Unknown credential.');
        }
        if (!withinValidity(key, Date.now())) {
            return fail(ctx, 401, 'invalid_auth', 'Credential is expired or not yet effective.');
        }
        const scopes = parseScopes(key);
        if (!scopes.includes(scope)) {
            return fail(ctx, 403, 'insufficient_scope', `This credential lacks the \`${scope}\` scope.`);
        }
        ctx.state.partnerPrincipal = {
            rateKeyId: key.id || 0,
            actor: key.remark || '',
            scopes,
            ip: getClientIP(ctx),
        } as IPartnerPrincipal;

        try {
            await next();
        } catch (e) {
            if (e instanceof PartnerParamError) {
                return fail(ctx, 400, e.code, e.message);
            }
            throw e;
        }
    };
}

export function principalOf(ctx): IPartnerPrincipal {
    return ctx.state?.partnerPrincipal || {rateKeyId: 0, actor: '', scopes: [], ip: getClientIP(ctx)};
}
