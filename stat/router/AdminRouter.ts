import * as crypto from 'crypto';
import * as Router from 'koa-router';
import {format} from 'js-conflux-sdk';
import {Hex40Map} from '../model/HexMap';
import {KV} from '../model/KV';
import {Epoch} from '../model/Epoch';
import {Token} from '../model/Token';
import {StatApp} from '../StatApp';
import {Errors} from '../service/common/LogicError';
import {spawn} from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {CursorStore} from '../../tools/epoch-data-checker/CursorStore';
import {ENABLED, isEnabled, leaseOwner, setEnabled, LAST_ERROR, RATE_FORWARD, RATE_BACKWARD, INTERVAL_SECONDS} from '../../tools/epoch-data-checker/Control';

const ADMIN_PWD_KEY = 'adminPwd';
const MAX_HEX_ID = BigInt('9223372036854775807');

function parseCheckerInterval(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === '') return fallback;
    const interval = Number(value);
    if (!Number.isFinite(interval) || interval < 0 || interval > 86400) {
        throw new Errors.ParameterError('interval 必须是 0 到 86400 秒之间的数字');
    }
    return interval;
}

function parseAddress(input: unknown): {id?: string; hex?: string} {
    if (typeof input !== 'string') {
        throw new Errors.ParameterError('请输入地址或 hex ID');
    }
    const value = input.trim();
    if (/^[0-9]+$/.test(value)) {
        const id = BigInt(value);
        if (id < BigInt(1) || id > MAX_HEX_ID) {
            throw new Errors.ParameterError('hex ID 超出范围');
        }
        return {id: id.toString()};
    }
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
        return {hex: value.slice(2).toLowerCase()};
    }
    if (value.length <= 100 && value.includes(':')) {
        try {
            const hex = format.hexAddress(value);
            if (/^0x[0-9a-fA-F]{40}$/.test(hex)) {
                return {hex: hex.slice(2).toLowerCase()};
            }
        } catch (_) { /* invalid address */ }
    }
    throw new Errors.ParameterError('请输入有效的 hex ID、0x 地址或 base32 地址');
}

async function checkAdminPassword(password: unknown): Promise<void> {
    const row = await KV.findOne({where: {key: ADMIN_PWD_KEY}, attributes: ['value']});
    if (!row?.value) {
        throw new Errors.PermissionError('管理查询未启用');
    }
    const expectedHash = crypto.createHash('sha256').update(row.value).digest();
    const suppliedHash = crypto.createHash('sha256').update(typeof password === 'string' ? password : '').digest();
    if (typeof password !== 'string' || !password || !crypto.timingSafeEqual(expectedHash, suppliedHash)) {
        throw new Errors.PermissionError('密码错误');
    }
}

export function registerAdminRoutes(router: Router<any, {}>, statApp?: StatApp) {
    router.get('/epoch-checker-reports/:file', async ctx => {
        const file = String(ctx.params.file || '');
        if (!/^epoch-[0-9]+-[0-9]+\.html$/.test(file)) {
            ctx.status = 404;
            return;
        }
        const reportPath = path.resolve(process.cwd(), 'public/stat/epoch-checker-reports', file);
        if (!fs.existsSync(reportPath)) {
            ctx.status = 404;
            return;
        }
        ctx.type = 'text/html';
        ctx.set('Cache-Control', 'no-store');
        ctx.body = fs.createReadStream(reportPath);
    });
    router.get('/admin/status', async ctx => {
        ctx.set('Cache-Control', 'no-store');
        const row = await KV.findOne({where: {key: ADMIN_PWD_KEY}, attributes: ['value']});
        ctx.body = {enabled: !!row?.value};
    });

    router.post('/admin/auth', async ctx => {
        ctx.set('Cache-Control', 'no-store');
        await checkAdminPassword((ctx.request.body as any)?.password);
        ctx.body = {authenticated: true};
    });

    router.post('/admin/address', async ctx => {
        ctx.set('Cache-Control', 'no-store');
        const body = ctx.request.body as any;
        await checkAdminPassword(body?.password);

        const parsed = parseAddress(body?.address);
        const address = await Hex40Map.findOne({
            where: parsed.id ? {id: parsed.id} : {hex: parsed.hex},
            attributes: ['id', 'hex'], raw: true,
        });
        const hex = address?.hex || parsed.hex || null;
        const token = address ? await Token.findOne({
            where: {hex40id: address.id},
            attributes: ['id', 'base32', 'name', 'symbol', 'type', 'decimals', 'totalSupply'],
            raw: true,
        }) : null;
        ctx.body = {
            hex: hex ? `0x${hex}` : null,
            base32: hex ? format.address(`0x${hex}`, StatApp.networkId) : null,
            hexId: address?.id == null ? null : String(address.id),
            token,
        };
    });

    router.post('/admin/epoch-checker/start', async ctx => {
        const body = ctx.request.body as any;
        await checkAdminPassword(body?.password);
        const saved = Number(await KV.getString(INTERVAL_SECONDS, '0'));
        const interval = parseCheckerInterval(body?.interval, Number.isFinite(saved) && saved >= 0 ? saved : 0);
        await KV.upsert({key: INTERVAL_SECONDS, value: String(interval)});
        await setEnabled(true);
        const entry = path.resolve(__dirname, '../../tools/epoch-data-checker/run.js');
        // Keep the checker detached from the request, but forward its output to
        // the API process so container logs show startup, lease and cursor errors.
        const child = spawn(process.execPath, [entry, '--interval', String(interval)], {detached: true, stdio: ['ignore', 'pipe', 'pipe']});
        child.stdout?.on('data', chunk => process.stdout.write(`[epoch-checker] ${chunk}`));
        child.stderr?.on('data', chunk => process.stderr.write(`[epoch-checker][error] ${chunk}`));
        child.on('error', error => console.error('[epoch-checker] worker spawn failed', error));
        child.on('exit', (code, signal) => console.log(`[epoch-checker] worker exited pid=${child.pid} code=${code} signal=${signal || ''}`));
        console.log(`[epoch-checker] worker spawned pid=${child.pid}`);
        child.unref();
        ctx.body = {started: true, interval};
    });
    router.post('/admin/epoch-checker/stop', async ctx => {
        await checkAdminPassword((ctx.request.body as any)?.password);
        await setEnabled(false);
        ctx.body = {stopped: true};
    });
    router.post('/admin/epoch-checker/resume', async ctx => {
        const body = ctx.request.body as any;
        await checkAdminPassword(body?.password);
        const saved = Number(await KV.getString(INTERVAL_SECONDS, '0'));
        const interval = parseCheckerInterval(body?.interval, Number.isFinite(saved) && saved >= 0 ? saved : 0);
        await KV.upsert({key: INTERVAL_SECONDS, value: String(interval)});
        const cursors = new CursorStore();
        await Promise.all([cursors.resume('forward'), cursors.resume('backward')]);
        await setEnabled(true);
        const entry = path.resolve(__dirname, '../../tools/epoch-data-checker/run.js');
        const child = spawn(process.execPath, [entry, '--direction', 'both', '--interval', String(interval)], {detached: true, stdio: ['ignore', 'pipe', 'pipe']});
        child.stdout?.on('data', chunk => process.stdout.write(`[epoch-checker] ${chunk}`));
        child.stderr?.on('data', chunk => process.stderr.write(`[epoch-checker][error] ${chunk}`));
        child.on('error', error => console.error('[epoch-checker] worker spawn failed', error));
        child.on('exit', (code, signal) => console.log(`[epoch-checker] worker exited pid=${child.pid} code=${code} signal=${signal || ''}`));
        console.log(`[epoch-checker] worker resumed pid=${child.pid}`);
        child.unref();
        ctx.body = {resumed: true, interval};
    });
    router.post('/admin/epoch-checker/status', async ctx => {
        await checkAdminPassword((ctx.request.body as any)?.password);
        const cursors = new CursorStore();
        const latestFinalized = statApp?.cfx ? Number(await statApp.cfx.getEpochNumber('latest_finalized')) : null;
        const latestRow: any = latestFinalized == null ? null : await Epoch.findOne({where: {epoch: latestFinalized}, raw: true});
        const cursorData: any = {};
        for (const dir of ['forward', 'backward'] as any[]) {
            const ep = await cursors.get(dir);
            const row: any = ep == null ? null : await Epoch.findOne({where: {epoch: ep}, raw: true});
            cursorData[dir] = ep;
            cursorData[`${dir}Time`] = row?.timestamp || null;
        }
        const [forwardRate, backwardRate] = await Promise.all([
            KV.getString(RATE_FORWARD, ''),
            KV.getString(RATE_BACKWARD, ''),
        ]);
        const savedInterval = Number(await KV.getString(INTERVAL_SECONDS, '0'));
        ctx.body = {enabled: await isEnabled(), owner: await leaseOwner(), latestFinalized,
            latestFinalizedTime: latestRow?.timestamp || null,
            forward: await cursors.get('forward'), backward: await cursors.get('backward'),
            forwardTime: cursorData.forwardTime, backwardTime: cursorData.backwardTime,
            forwardRate: forwardRate ? Number(forwardRate) : null,
            backwardRate: backwardRate ? Number(backwardRate) : null,
            interval: Number.isFinite(savedInterval) && savedInterval >= 0 ? savedInterval : 0,
            lastError: await KV.getString(LAST_ERROR, ''),
            forwardPaused: await cursors.paused('forward'), backwardPaused: await cursors.paused('backward')};
    });
}
