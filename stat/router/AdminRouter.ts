import * as crypto from 'crypto';
import * as Router from 'koa-router';
import {format} from 'js-conflux-sdk';
import {Hex40Map} from '../model/HexMap';
import {KV} from '../model/KV';
import {Token} from '../model/Token';
import {StatApp} from '../StatApp';
import {Errors} from '../service/common/LogicError';

const ADMIN_PWD_KEY = 'adminPwd';
const MAX_HEX_ID = BigInt('9223372036854775807');

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

export function registerAdminRoutes(router: Router<any, {}>) {
    router.get('/admin/status', async ctx => {
        ctx.set('Cache-Control', 'no-store');
        const row = await KV.findOne({where: {key: ADMIN_PWD_KEY}, attributes: ['value']});
        ctx.body = {enabled: !!row?.value};
    });

    router.post('/admin/address', async ctx => {
        ctx.set('Cache-Control', 'no-store');
        const row = await KV.findOne({where: {key: ADMIN_PWD_KEY}, attributes: ['value']});
        if (!row?.value) {
            throw new Errors.PermissionError('管理查询未启用');
        }
        const supplied = ctx.get('X-Admin-Password');
        const expectedHash = crypto.createHash('sha256').update(row.value).digest();
        const suppliedHash = crypto.createHash('sha256').update(supplied).digest();
        if (!supplied || !crypto.timingSafeEqual(expectedHash, suppliedHash)) {
            throw new Errors.PermissionError('密码错误');
        }

        const parsed = parseAddress((ctx.request.body as any)?.address);
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
