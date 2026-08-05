import * as Koa from "koa";
import { koaSwagger } from "koa2-swagger-ui";

const yamljs = require('yamljs');
const swStats = require('swagger-stats');
const e2k = require('express-to-koa');

type AnyObj = Record<string, any>;

interface RegisteredSpec {
    yamlPath: string;
    prefix: string;
    spec: AnyObj;
}

interface InitSwaggerStatsOptions {
    uriPath?: string;   // default: /swagger-stats
    hostname?: string;  // default: ScanApi
    basePath?: string;  // default: /
}

const registeredSpecs: RegisteredSpec[] = [];
const registeredYamlPathSet = new Set<string>();
let swStatsExpressMiddleware: any | null = null;
const swStatsAttachedApps = new WeakSet<Koa>();

/** 
 *  Attach Swagger documentation (can be called multiple times)
 *  Register the spec in the global pool for subsequent merging.
 */
export function addSwaggerDoc(app: Koa, prefix: string, swaggerYamlPath: string): AnyObj {
    console.log(`[swagger] loading yaml: ${swaggerYamlPath}`);
    const spec = yamljs.load(swaggerYamlPath);
    console.log(`[swagger] loaded yaml: ${swaggerYamlPath}`);

    registerSpec(swaggerYamlPath, prefix, spec);

    app.use(
        koaSwagger({
            routePrefix: `${prefix}/doc`,
            specPrefix: `${prefix}/spec`,
            exposeSpec: true,
            oauthOptions: {},
            swaggerOptions: {
                title: 'open-api-doc',
                spec,
            },
        }),
    );

    return spec;
}

/** 
 *  Initialize and mount swagger-stats (initialized only once per process)
 *  Accepts a single app or an array of apps
 */
export function initSwaggerStatsOnce(
    appOrApps: Koa | Koa[],
    options: InitSwaggerStatsOptions = {},
): void {
    const apps = Array.isArray(appOrApps) ? appOrApps : [appOrApps];
    const uriPath = options.uriPath ?? '/swagger-stats';
    const hostname = options.hostname ?? 'ScanApi';
    const basePath = options.basePath ?? '/';

    // Create the swStats middleware only once (to avoid duplicate registration with prom-client).
    if (!swStatsExpressMiddleware) {
        if (registeredSpecs.length === 0) {
            throw new Error(
                '[swagger-stats] no swagger specs registered. ' +
                'Please call addSwaggerDoc(...) before initSwaggerStatsOnce(...).',
            );
        }

        const mergedSpec = mergeSwaggerSpecsForStats(registeredSpecs);
        swStatsExpressMiddleware = swStats.getMiddleware({
            uriPath,
            hostname, // hide the real hostname
            basePath,
            swaggerSpec: mergedSpec,
        });

        console.log(
            `[swagger-stats] initialized once. specs=${registeredSpecs.length}, uriPath=${uriPath}`,
        );
    }

    // Can be mounted to multiple Koa apps (reusing the same express middleware)
    for (const app of apps) {
        if (swStatsAttachedApps.has(app)) continue;
        app.use(e2k(swStatsExpressMiddleware));
        swStatsAttachedApps.add(app);
        console.log('[swagger-stats] attached to one Koa app');
    }
}

/** 
 *  Register spec (deduplication)
 */
function registerSpec(yamlPath: string, prefix: string, spec: AnyObj): void {
    const key = `${yamlPath}@@${prefix}`;
    if (registeredYamlPathSet.has(key)) return;
    registeredYamlPathSet.add(key);
    registeredSpecs.push({ yamlPath, prefix, spec });
}

function mergeSwaggerSpecsForStats(items: RegisteredSpec[]): AnyObj {
    const prefixedSpecs = items.map(({ spec, prefix }) => buildPrefixedSpecForStats(spec, prefix));
    return mergeSwaggerSpecs(prefixedSpecs);
}

function buildPrefixedSpecForStats(rawSpec: AnyObj, mountPrefix: string): AnyObj {
    const spec = clone(rawSpec);
    const prefix = normalizePrefix(mountPrefix);

    const oldPaths = spec.paths || {};
    const newPaths: AnyObj = {};

    for (const p of Object.keys(oldPaths)) {
        const fullPath = withPrefix(p, prefix); // /users -> /v1/users or /stat/users
        if (newPaths[fullPath]) {
            throw new Error(`[swagger-prefix] duplicated path after prefixing: ${fullPath}`);
        }
        newPaths[fullPath] = oldPaths[p];
    }

    spec.paths = newPaths;

    // avoid the stacking of `basePath/servers` from causing a mismatch.
    if (spec.swagger) {
        // Swagger 2.0
        spec.basePath = '/';
    }
    if (spec.openapi) {
        // OpenAPI 3.x
        spec.servers = [{ url: '/' }];
    }

    return spec;
}

function normalizePrefix(p: string): string {
    if (!p) return '';
    let s = p.trim();
    if (!s.startsWith('/')) s = '/' + s;
    if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
    return s;
}

function withPrefix(pathKey: string, prefix: string): string {
    let p = pathKey || '/';
    if (!p.startsWith('/')) p = '/' + p;
    if (!prefix || prefix === '/') return p;

    // do not add the prefix again if it is already included.
    if (p === prefix || p.startsWith(prefix + '/')) return p;

    return `${prefix}${p}`;
}

/** 
 *  merge multiple OpenAPI/Swagger specs
 *  Focus on merging paths + components (and common top-level fields)
 */
function mergeSwaggerSpecs(specs: AnyObj[]): AnyObj {
    if (specs.length === 1) return clone(specs[0]);

    // Use the first spec as the base
    const base = clone(specs[0]);

    base.paths = base.paths || {};
    base.components = base.components || {};
    base.tags = Array.isArray(base.tags) ? base.tags : [];

    for (let i = 1; i < specs.length; i++) {
        const s = specs[i] || {};

        // paths: merge path + method, throw error on conflict (to avoid silent overwrite)
        mergePaths(base.paths, s.paths || {});

        // components: merge recursively (keep base on conflict to avoid accidental overwrite)
        base.components = deepMergeKeepLeft(base.components || {}, s.components || {});

        // Swagger 2.0 common fields compatibility
        base.definitions = deepMergeKeepLeft(base.definitions || {}, s.definitions || {});
        base.parameters = deepMergeKeepLeft(base.parameters || {}, s.parameters || {});
        base.responses = deepMergeKeepLeft(base.responses || {}, s.responses || {});
        base.securityDefinitions = deepMergeKeepLeft(
            base.securityDefinitions || {},
            s.securityDefinitions || {},
        );

        // deduplicate tags (by name)
        if (Array.isArray(s.tags)) {
            const seen = new Set((base.tags || []).map((t: any) => t?.name).filter(Boolean));
            for (const t of s.tags) {
                if (!t?.name || seen.has(t.name)) continue;
                base.tags.push(t);
                seen.add(t.name);
            }
        }
    }

    // set a unified title for info to avoid confusion
    base.info = base.info || {};
    if (!base.info.title) base.info.title = 'merged-open-api';
    if (!base.info.version) base.info.version = '1.0.0';

    return base;
}

function mergePaths(targetPaths: AnyObj, sourcePaths: AnyObj): void {
    for (const p of Object.keys(sourcePaths)) {
        targetPaths[p] = targetPaths[p] || {};
        const srcPathItem = sourcePaths[p] || {};
        const dstPathItem = targetPaths[p];

        for (const method of Object.keys(srcPathItem)) {
            const m = method.toLowerCase();
            if (dstPathItem[m]) {
                throw new Error(
                    `[swagger-merge] path conflict: "${p}" method "${m}" exists in multiple specs`,
                );
            }
            dstPathItem[m] = srcPathItem[method];
        }
    }
}

function deepMergeKeepLeft(left: AnyObj, right: AnyObj): AnyObj {
    const out = clone(left);

    for (const k of Object.keys(right || {})) {
        const lv = out[k];
        const rv = right[k];

        if (lv === undefined) {
            out[k] = clone(rv);
            continue;
        }

        if (isPlainObject(lv) && isPlainObject(rv)) {
            out[k] = deepMergeKeepLeft(lv, rv);
            continue;
        }

        // If you want to override with the right side, uncomment the following line:
        // out[k] = clone(rv);
    }

    return out;
}

function isPlainObject(v: any): v is AnyObj {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
}
