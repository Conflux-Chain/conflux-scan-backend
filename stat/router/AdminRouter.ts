import * as crypto from 'crypto';
import * as Router from 'koa-router';
import {promisify} from 'util';
import {format} from 'js-conflux-sdk';
import {Hex40Map} from '../model/HexMap';
import {KV} from '../model/KV';
import {Token} from '../model/Token';
import {StatApp} from '../StatApp';
import {Errors} from '../service/common/LogicError';

const ADMIN_PWD_KEY = 'adminPwd';
const MAX_HEX_ID = BigInt('9223372036854775807');
const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_HASH_PREFIX = 'scrypt$';
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 32;

async function derivePasswordHash(password: string, salt: Buffer): Promise<Buffer> {
    return await scryptAsync(password, salt, PASSWORD_KEY_BYTES) as Buffer;
}

async function createPasswordHash(password: string): Promise<string> {
    const salt = crypto.randomBytes(PASSWORD_SALT_BYTES);
    const hash = await derivePasswordHash(password, salt);
    return `${PASSWORD_HASH_PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<{valid: boolean; legacy: boolean}> {
    if (stored.startsWith(PASSWORD_HASH_PREFIX)) {
        const [, saltHex, hashHex] = stored.split('$');
        if (!/^[0-9a-f]{32}$/i.test(saltHex || '') || !/^[0-9a-f]{64}$/i.test(hashHex || '')) {
            return {valid: false, legacy: false};
        }
        const expected = Buffer.from(hashHex, 'hex');
        const supplied = await derivePasswordHash(password, Buffer.from(saltHex, 'hex'));
        return {valid: crypto.timingSafeEqual(expected, supplied), legacy: false};
    }

    // Existing deployments may still have a plaintext KV value. Verify it once
    // and transparently migrate it to a salted scrypt hash after success.
    const expected = Buffer.from(stored);
    const supplied = Buffer.from(password);
    return {
        valid: expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied),
        legacy: true,
    };
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
    if (typeof password !== 'string' || !password) {
        throw new Errors.PermissionError('密码错误');
    }
    const verification = await verifyPassword(password, row.value);
    if (!verification.valid) {
        throw new Errors.PermissionError('密码错误');
    }
    if (verification.legacy) {
        await KV.update({value: await createPasswordHash(password)}, {where: {key: ADMIN_PWD_KEY}});
    }
}

export function registerAdminRoutes(router: Router<any, {}>) {
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
}
