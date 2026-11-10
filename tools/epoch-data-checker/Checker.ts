import {Conflux, format} from 'js-conflux-sdk';
import {Op} from 'sequelize';
import {Epoch} from '../../stat/model/Epoch';
import {AddressTransactionIndex, FullBlock, FullTransaction} from '../../stat/model/FullBlock';
import {CfxTransfer} from '../../stat/model/CfxTransfer';
import {Erc20Transfer} from '../../stat/model/Erc20Transfer';
import {Erc721Transfer} from '../../stat/model/Erc721Transfer';
import {Erc1155Transfer} from '../../stat/model/Erc1155Transfer';
import {getAddrId, Hex40Map} from '../../stat/model/HexMap';
import {compareRows, Difference, normalize} from './Compare';
import {CursorStore} from './CursorStore';
import {dingMsg} from '../../stat/monitor/Monitor';
import {StatConfig} from '../../stat/config/StatConfig';
import {TokenTool} from '../../stat/service/tool/TokenTool';
import {getCfxTransfer} from '../../stat/CfxTransferSync';
import {AddressTransfer, EpochAddressIds} from '../../stat/model/AddrTransfer';
import {NftTransfer} from '../../stat/model/NftTransfer';
import {AddressNftTransfer} from '../../stat/model/NftTransfer';
import {ContractDestroy} from '../../stat/model/TraceCreateContract';
import {NameTag} from '../../stat/model/NameTag';
import {CensorItem} from '../../stat/model/CensorItem';
import {VoteParams} from '../../stat/model/Epoch';
import {LAST_ERROR, RATE_BACKWARD, RATE_FORWARD} from './Control';
import {KV} from '../../stat/model/KV';
import {PruneInfo, PruneType} from '../../stat/model/PruneInfo';
import {StatApp} from '../../stat/StatApp';
import * as fs from 'fs';
import * as path from 'path';

export type Direction = 'forward'|'backward';
export interface EpochCheckResult {
    differences: Difference[];
    timings: Record<string, number>;
    detail?: string;
}

interface DerivedCheckResult {
    differences: Difference[];
    detail: string;
}

function escapeHtml(value: any): string {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}

function transferTypeLabel(value: any): string {
    const labels: Record<string, string> = {
        '10': 'transaction', '20': 'ERC20', '21': 'ERC721', '55': 'ERC1155',
        '101': 'CFX call', '102': 'CFX create', '103': 'CFX gas payment',
        '104': 'CFX storage collateral', '105': 'CFX sponsor gas',
        '106': 'CFX sponsor collateral', '107': 'CFX staking', '108': 'CFX balance',
    };
    const key = String(value ?? '');
    return labels[key] ? `${key} (${labels[key]})` : key;
}

export class EpochDataChecker {
    private readonly cursors = new CursorStore();
    private readonly addressIdCache = new Map<string, Promise<number>>();
    private readonly epochRows = new Map<string, Promise<any[]>>();
    private readonly progress = new Map<Direction, {lastLog: number, count: number, startedAt: number}>();
    private readonly verbose = process.env.EPOCH_CHECKER_VERBOSE === '1';
    private readonly tokenTool: TokenTool;
    constructor(private readonly cfx: Conflux, private readonly config: StatConfig) {
        this.tokenTool = new TokenTool(cfx);
    }

    async latestFinalized(): Promise<number> {
        return Number(await this.cfx.getEpochNumber('latest_finalized'));
    }

    async initialize(latest: number) {
        const initial = Math.max(0, latest - 100000);
        if (await this.cursors.get('forward') === null) await this.cursors.set('forward', initial);
        if (await this.cursors.get('backward') === null) await this.cursors.set('backward', initial);
    }

    async run(direction: Direction): Promise<void> {
        // The outer loop reports the terminal paused state once. Do not emit
        // a line on every interval while a direction remains paused.
        if (await this.cursors.paused(direction)) return;
        const latest = await this.latestFinalized();
        const cursor = await this.cursors.get(direction);
        if (cursor === null) return;
        if (direction === 'forward' && cursor > latest) return;
        if (direction === 'backward' && cursor < 0) return;

        // The newest finalized epoch must already be represented in the DB.
        // This catches a stopped production container separately from a row diff.
        if (direction === 'forward') {
            const [ready, block] = await Promise.all([
                Epoch.findOne({where: {epoch: latest}, raw: true}),
                FullBlock.findOne({where: {epoch: latest}, raw: true}),
            ]);
            if (!ready || !block) return this.fail(direction, latest, 'latest finalized epoch is not fully in database');
        }

        const result = await this.checkEpoch(cursor, latest);
        if (result.differences.length) return this.fail(direction, cursor, this.formatDifferences(result.differences.slice(0, 20)));
        const next = direction === 'forward' ? cursor + 1 : cursor - 1;
        await this.cursors.set(direction, next);
        const t = result.timings;
        const now = Date.now();
        const progress = this.progress.get(direction) || {lastLog: 0, count: 0, startedAt: now};
        progress.count++;
        if (this.verbose || progress.count === 1 || now - progress.lastLog >= 5000) {
            const elapsed = now - progress.startedAt;
            const rate = elapsed >= 1000 ? progress.count * 1000 / elapsed : 0;
            const rateKey = direction === 'forward' ? RATE_FORWARD : RATE_BACKWARD;
            if (rate > 0) void KV.upsert({key: rateKey, value: rate.toFixed(3)});
            const detail = this.verbose && t.total < 1000
                ? ` epoch=${t.epoch} blocks=${t.blocks} cfx=${t.cfx} token=${t.token} derived=${t.derived}${result.detail ? ` ${result.detail}` : ''}`
                : '';
            console.log(`[epoch-checker] ${direction.padEnd(8)} epoch=${cursor} matched; cursor=${next} ` +
                `completed=${progress.count} rate=${rate > 0 ? `${rate.toFixed(2)}/s` : '-' } ms=${t.total}${detail}`);
            progress.lastLog = now;
        }
        this.progress.set(direction, progress);
    }

    private async fail(direction: Direction, epoch: number, reason: string) {
        await this.cursors.pause(direction);
        await KV.upsert({key: LAST_ERROR, value: JSON.stringify({direction, epoch, reason, at: new Date().toISOString()})});
        await dingMsg(`[${this.config.serverTag}] epoch data checker ${direction} paused at epoch ${epoch}: ${reason}`, this.config.dingTalkToken);
        console.error(`epoch data checker ${direction} paused at ${epoch}: ${reason}`);
    }

    private formatDifferences(differences: Difference[]): string {
        return differences.map((difference: any) => {
            const detail = String(difference.detail || '');
            const report = detail.match(/(?:^| )report=(\/[^ ]+)/)?.[1];
            const diagnostic = detail.split('address_transfer_diagnostic=')[1];
            const lines = [`${difference.key}: 预期 ${difference.expected}，实际 ${difference.actual}`];
            if (report) lines.push(`报告：${report}`);
            if (diagnostic) {
                try {
                    const parsed = JSON.parse(diagnostic);
                    for (const row of parsed.missing || []) {
                        lines.push(`缺失：${row.source || 'transfer'} type=${transferTypeLabel(row.type)} 地址=${row.address || '-'} (id=${row.addressId}) amount=${row.amount ?? '-'} 位置=${row.blockIndex ?? '-'}:${row.txIndex ?? '-'}:${row.txLogIndex ?? '-'} 交易=${row.txHash || '-'}`);
                    }
                    if (parsed.actualAddresses?.length) {
                        lines.push(`实际地址：${parsed.actualAddresses.map((row: any) => `${row.address || '-'} (id=${row.addressId})`).join('、')}`);
                    }
                } catch (_) {
                    lines.push(detail);
                }
            } else if (detail) {
                lines.push(detail);
            }
            return lines.join('\n');
        }).join('\n');
    }

    async checkEpoch(epoch: number, latestFinalized?: number): Promise<EpochCheckResult> {
        const started = Date.now();
        const differences: Difference[] = [];
        const epochStarted = Date.now();
        const [rpcPivot, dbEpoch]: [any, any] = await Promise.all([
            this.cfx.getBlockByEpochNumber(epoch),
            Epoch.findOne({where: {epoch}, raw: true}),
        ]);
        const timings: Record<string, number> = {epoch: Date.now() - epochStarted};
        if (!rpcPivot || !dbEpoch) {
            differences.push({kind: 'missing', key: `epoch:${epoch}`, expected: rpcPivot ? 'db row' : 'rpc row'});
            timings.total = Date.now() - started;
            return {differences, timings};
        }
        if (normalize(dbEpoch.pivotHash) !== normalize(rpcPivot.hash)) {
            differences.push({kind: 'field', key: `epoch:${epoch}.pivotHash`, expected: rpcPivot.hash, actual: dbEpoch.pivotHash});
        }
        const rpcTimestamp = Math.floor(Number(rpcPivot.timestamp));
        const dbTimestamp = Math.floor(new Date(dbEpoch.timestamp).getTime() / 1000);
        if (rpcTimestamp !== dbTimestamp) differences.push({kind: 'field', key: `epoch:${epoch}.timestamp`, expected: rpcTimestamp, actual: dbTimestamp});
        const stages = await Promise.all([
            this.timed('blocks', () => this.checkBlocks(epoch, rpcPivot)),
            this.timed('cfx', () => this.checkCfxTransfers(epoch, rpcPivot)),
            this.timed('token', () => this.checkTokenTransfers(epoch, rpcPivot)),
            this.timed('derived', () => this.checkDerivedData(epoch, latestFinalized)),
        ]);
        for (const stage of stages) timings[stage.name] = stage.ms;
        timings.total = Date.now() - started;
        const derived = stages[3].value as DerivedCheckResult;
        return {
            differences: differences.concat(stages[0].value, stages[1].value, stages[2].value, derived.differences),
            timings,
            detail: derived.detail,
        };
    }

    private async timed<T>(name: string, fn: () => Promise<T>): Promise<{name: string, ms: number, value: T}> {
        const started = Date.now();
        const value = await fn();
        return {name, ms: Date.now() - started, value};
    }

    private rows(model: any, name: string, epoch: number): Promise<any[]> {
        const key = `${name}:${epoch}`;
        const cached = this.epochRows.get(key);
        if (cached) return cached;
        const pending = model.findAll({where: {epoch}, raw: true}).catch(error => {
            this.epochRows.delete(key);
            throw error;
        });
        this.epochRows.set(key, pending);
        // Keep the cache bounded. Entries are only an optimization for the
        // concurrent checks of the same epoch and must not grow indefinitely.
        while (this.epochRows.size > 200) this.epochRows.delete(this.epochRows.keys().next().value);
        return pending;
    }

    private async checkBlocks(epoch: number, rpcPivot: any): Promise<Difference[]> {
        const [rpcBlocks, dbBlocks]: [any[], any[]] = await Promise.all([
            this.cfx.getBlocksByEpochNumber(epoch).then(rows => rows || []),
            FullBlock.findAll({where: {epoch}, order: [['position', 'asc']], raw: true}),
        ]);
        const expected = [];
        const blocks = await Promise.all(rpcBlocks.map(hash => this.cfx.getBlockByHash(hash, false)));
        for (let position = 0; position < blocks.length; position++) {
            const block = blocks[position];
            if (!block) continue;
            expected.push({epoch, position, hash: block.hash, pivot: block.hash === rpcPivot.hash,
                difficulty: String(block.difficulty || 0), txCount: (block.transactions || []).length});
        }
        const actual = dbBlocks.map(row => ({...row, difficulty: String(row.difficulty || 0)}));
        return compareRows(expected, actual, row => `block:${row.epoch}:${row.position}`, ['hash', 'pivot', 'difficulty', 'txCount']);
    }

    private async id(address: string): Promise<number> {
        const key = String(address).toLowerCase();
        let pending = this.addressIdCache.get(key);
        if (!pending) {
            pending = getAddrId(address, -1).then(id => id === undefined ? -1 : Number(id));
            this.addressIdCache.set(key, pending);
        }
        return pending;
    }

    private async checkTokenTransfers(epoch: number, pivot: any): Promise<Difference[]> {
        const [receipts, actualByType]: [any[][], any[][]] = await Promise.all([
            (this.cfx as any).getEpochReceiptsByPivotBlockHash(pivot.hash).then(rows => rows || []),
            Promise.all([Erc20Transfer, Erc721Transfer, Erc1155Transfer].map((model: any, index) =>
                this.rows(model, ['erc20', 'erc721', 'erc1155'][index], epoch))),
        ]);
        const expected: any[] = [];
        for (let blockIndex = 0; blockIndex < receipts.length; blockIndex++) {
            // Match TokenTransferSync.decodeTransferFromReceipts exactly:
            // txPos counts only outcome 0/1 receipts, while log position is
            // the receipt-local log order (not the RPC logIndex field).
            let txPos = -1;
            for (const receipt of receipts[blockIndex] || []) {
                if (receipt.outcomeStatus === 0) txPos++;
                else if (receipt.outcomeStatus === 1) { txPos++; continue; }
                else continue;
                let txLogIndex = -1;
                for (const log of receipt.logs || []) {
                    txLogIndex++;
                    if ((log.topics || []).length < 3 || !log.topics[1] || !log.topics[2]) continue;
                    const e20: any = this.tokenTool.decodeERC20TransferPlus(log, true);
                    const e721: any = this.tokenTool.decodeERC721Transfer(log, true);
                    const e1155: any[] = this.tokenTool.decodeERC1155TransferArrayPlus(log);
                    const nonZero1155 = e1155?.filter(item => String(item.value) !== '0') || [];
                    if ((!e20 || String(e20.value) === '0') && !e721 && !nonZero1155.length) continue;
                    const common: any = {epoch, blockIndex, txIndex: txPos,
                        txLogIndex, contractId: await this.id(log.address),
                        fromId: -1, toId: -1, createdAt: new Date(Number(pivot.timestamp) * 1000)};
                    if (e20 && String(e20.value) !== '0') expected.push({...common, fromId: await this.id(e20.from), toId: await this.id(e20.to), value: String(e20.value), _type: 'erc20'});
                    else if (e721) expected.push({...common, fromId: await this.id(e721.from), toId: await this.id(e721.to), tokenId: String(e721.tokenId), _type: 'erc721'});
                    else if (nonZero1155.length) for (const item of nonZero1155) expected.push({...common, fromId: await this.id(item.from), toId: await this.id(item.to), tokenId: String(item.tokenId), value: String(item.value), batchIndex: item.batchIndex, _type: 'erc1155'});
                }
            }
        }
        const models: any[] = [
            ['erc20', Erc20Transfer], ['erc721', Erc721Transfer], ['erc1155', Erc1155Transfer]
        ];
        const result: Difference[] = [];
        for (let i = 0; i < models.length; i++) {
            const [type] = models[i];
            const actual = actualByType[i];
            const e = expected.filter(row => row._type === type);
            const fields = type === 'erc20' ? ['contractId','fromId','toId','value'] : type === 'erc721' ? ['contractId','fromId','toId','tokenId'] : ['contractId','fromId','toId','tokenId','value'];
            const keyOf = type === 'erc1155'
                ? (row: any) => `${type}_transfer:${row.epoch}:${row.blockIndex}:${row.txIndex}:${row.txLogIndex}:${row.tokenId}`
                : (row: any) => `${type}_transfer:${row.epoch}:${row.blockIndex}:${row.txIndex}:${row.txLogIndex}`;
            result.push(...compareRows(e, actual, keyOf, fields));
        }
        return result;
    }

    private async checkCfxTransfers(epoch: number, pivot: any): Promise<Difference[]> {
        const [hashes, actual, txRows]: [any[], any[], any[]] = await Promise.all([
            this.cfx.getBlocksByEpochNumber(epoch).then(rows => rows || []),
            this.rows(CfxTransfer, 'cfx', epoch),
            this.rows(FullTransaction, 'tx', epoch),
        ]);
        const txStatus = new Map<string, number>();
        txRows.forEach(row => txStatus.set(`${Number(row.blockPosition)}:${Number(row.txPosition)}`, Number(row.status)));
        const expected: any[] = [];
        const traces = await Promise.all(hashes.map(hash => (this.cfx as any).traceBlock(hash)));
        for (let blockIndex = 0; blockIndex < traces.length; blockIndex++) {
            const traced: any = traces[blockIndex];
            for (const tx of traced?.transactionTraces || []) {
                const txPosition = Number(tx.transactionPosition || 0);
                // CfxTransferSync only processes successful transactions and
                // valid traces. Failed transactions can still expose traces
                // through RPC, but they must not create cfx_transfer rows.
                if (txStatus.get(`${blockIndex}:${txPosition}`) !== 0) continue;
                for (let traceIndex = 0; traceIndex < (tx.traces || []).length; traceIndex++) {
                    if (tx.traces[traceIndex]?.valid === false) continue;
                    const transfer: any = getCfxTransfer(tx.traces[traceIndex]);
                    if (!transfer) continue;
                    expected.push({epoch, blockIndex, txIndex: txPosition, txLogIndex: traceIndex,
                        fromId: await this.id(transfer.from), toId: await this.id(transfer.to), value: String(transfer.value), type: transfer.type});
                }
            }
        }
        return compareRows(expected, actual, row => `cfx_transfer:${row.epoch}:${row.blockIndex}:${row.txIndex}:${row.txLogIndex}`, ['fromId','toId','value','type']);
    }

    /** Validate all secondary tables written by EpochSync against the primary
     * rows for this epoch. This is deliberately relational and read-only: it
     * detects partial writes without replaying metadata side effects. */
    private async checkDerivedData(epoch: number, latestFinalized?: number): Promise<DerivedCheckResult> {
        const out: Difference[] = [];
        // Load the epoch's source rows first. Address-partitioned tables are
        // keyed by addressId, so querying them by epoch alone scans every
        // partition. We use the source address IDs to make those lookups
        // selective in the second phase.
        const sourceStarted = Date.now();
        const sourceRows: any[] = await Promise.all(([
            this.rows(FullTransaction, 'tx', epoch),
            this.rows(CfxTransfer, 'cfx', epoch),
            this.rows(Erc20Transfer, 'erc20', epoch),
            this.rows(Erc721Transfer, 'erc721', epoch),
            this.rows(Erc1155Transfer, 'erc1155', epoch),
        ] as any[]));
        const sourceMs = Date.now() - sourceStarted;
        const [tx, cfx, t20, t721, t1155] = sourceRows;
        const token = [...t20, ...t721, ...t1155];
        const source = [
            ...tx.map(row => ({...row, _source: 'tx'})),
            ...cfx.map(row => ({...row, _source: 'cfx'})),
            ...t20.map(row => ({...row, _source: 'erc20'})),
            ...t721.map(row => ({...row, _source: 'erc721'})),
            ...t1155.map(row => ({...row, _source: 'erc1155'})),
        ];
        const txAddressIds = Array.from(new Set(tx.flatMap((row: any) =>
            [row.fromId, row.toId].filter(id => id !== undefined && id !== null).map(id => Number(id)))));
        const txAddressWhere = txAddressIds.length ? {epoch, addressId: {[Op.in]: txAddressIds}} : {epoch: -1};
        const addressIds = Array.from(new Set(source.flatMap((row: any) =>
            [row.fromId, row.toId].filter(id => id !== undefined && id !== null).map(id => Number(id)))));
        const addressWhere = addressIds.length ? {epoch, addressId: {[Op.in]: addressIds}} : {epoch: -1};
        const [addrQ, addrIdsQ, txIndexQ, nftQ, addrNftQ, censorQ, eventsQ] = await Promise.all([
            this.timed('address_transfer', () => addressIds.length
                ? AddressTransfer.count({where: addressWhere})
                : Promise.resolve(0)),
            this.timed('epoch_address_ids', () => latestFinalized === undefined || epoch >= latestFinalized - 1000
                ? EpochAddressIds.count({where: {epoch}})
                : Promise.resolve(0)),
            this.timed('address_tx', () => txAddressIds.length
                ? AddressTransactionIndex.count({where: txAddressWhere})
                : Promise.resolve(0)),
            this.timed('nft_transfer', () => NftTransfer.count({where: {epoch}})),
            this.timed('address_nft_transfer', () => addressIds.length
                ? AddressNftTransfer.count({where: addressWhere})
                : Promise.resolve(0)),
            this.timed('censor_item', () => CensorItem.count({where: {epochNumber: epoch}})),
            this.timed('events', () => Promise.all([
                ContractDestroy.count({where: {epochNumber: epoch}}),
                NameTag.count({where: {epoch}}),
                VoteParams.count({where: {epoch}}),
            ])),
        ]);
        const addr = Number(addrQ.value);
        const addrIds = Number(addrIdsQ.value);
        const txIndex = Number(txIndexQ.value);
        const nft = Number(nftQ.value);
        const addrNft = Number(addrNftQ.value);
        const censorRows = Number(censorQ.value);
        const eventRows = eventsQ.value;
        const expectedByAddress = new Map<number, number>();
        for (const row of source) {
            if (row.fromId !== undefined && row.fromId !== null) {
                const id = Number(row.fromId);
                expectedByAddress.set(id, (expectedByAddress.get(id) || 0) + 1);
            }
            if (row.toId && row.toId !== row.fromId) {
                const id = Number(row.toId);
                expectedByAddress.set(id, (expectedByAddress.get(id) || 0) + 1);
            }
        }
        const expectedAddr = Array.from(expectedByAddress.values()).reduce((sum, count) => sum + count, 0);
        const expectedTx = tx.reduce((sum: number, row: any) => sum + 1 + (row.toId !== undefined && row.toId !== null && row.toId !== row.fromId ? 1 : 0), 0);
        let txIndexPruned = 0;
        if (txIndex !== expectedTx) {
            const actualTxRows = txAddressIds.length ? await AddressTransactionIndex.findAll({
                attributes: ['addressId'], where: txAddressWhere, raw: true,
            }) : [];
            const actualByAddress = new Map<number, number>();
            for (const row of actualTxRows as any[]) actualByAddress.set(Number(row.addressId), (actualByAddress.get(Number(row.addressId)) || 0) + 1);
            const pruneRows = txAddressIds.length ? await PruneInfo.findAll({
                attributes: ['addressId', 'epoch'],
                where: {addressId: {[Op.in]: txAddressIds}, type: PruneType.ADDR_TX}, raw: true,
            }) : [];
            const pruneByAddress = new Map<number, number>((pruneRows as any[]).map(row => [Number(row.addressId), Number(row.epoch)]));
            const expectedTxByAddress = new Map<number, number>();
            for (const row of tx) {
                const ids = [row.fromId];
                if (row.toId !== undefined && row.toId !== null && row.toId !== row.fromId) ids.push(row.toId);
                for (const addressId of new Set(ids.map(id => Number(id)))) {
                    expectedTxByAddress.set(addressId, (expectedTxByAddress.get(addressId) || 0) + 1);
                }
            }
            let missingUnpruned = 0;
            for (const [addressId, expected] of expectedTxByAddress) {
                const missing = Math.max(0, expected - (actualByAddress.get(addressId) || 0));
                if (missing && (pruneByAddress.get(addressId) || 0) > epoch) txIndexPruned += missing;
                else missingUnpruned += missing;
            }
            if (missingUnpruned || txIndex > expectedTx) {
                out.push({kind: 'count', key: `address_tx:${epoch}`, expected: expectedTx, actual: txIndex,
                    detail: `missingUnpruned=${missingUnpruned} extra=${Math.max(0, txIndex - expectedTx)} pruned=${txIndexPruned}`});
            }
        }
        let addressTransferPruned = 0;
        let addressDiagnostic = '';
        if (addr !== expectedAddr) {
            // address_transfer is pruned independently per address. A historical
            // source row may therefore legitimately have no derived row. Only
            // suppress a mismatch when every missing row is covered by the
            // address-specific prune cursor; unexpected rows still remain an error.
            const actualRows = addressIds.length
                ? await AddressTransfer.findAll({attributes: ['addressId', 'blockIndex', 'txIndex', 'txLogIndex', 'batchIndex', 'type', 'contractId', 'tokenId', 'value'], where: addressWhere, raw: true})
                : [];
            const actualByAddress = new Map<number, number>();
            for (const row of actualRows as any[]) {
                const id = Number(row.addressId);
                actualByAddress.set(id, (actualByAddress.get(id) || 0) + 1);
            }
            const pruneRows = expectedByAddress.size
                ? await PruneInfo.findAll({
                    attributes: ['addressId', 'epoch'],
                    where: {addressId: {[Op.in]: Array.from(expectedByAddress.keys())}, type: PruneType.ADDR_TRANSFER},
                    raw: true,
                })
                : [];
            const pruneByAddress = new Map<number, number>((pruneRows as any[]).map(row => [Number(row.addressId), Number(row.epoch)]));
            let missingUnpruned = 0;
            for (const [addressId, expectedCount] of expectedByAddress) {
                const missing = Math.max(0, expectedCount - (actualByAddress.get(addressId) || 0));
                if (missing && (pruneByAddress.get(addressId) || 0) > epoch) addressTransferPruned += missing;
                else missingUnpruned += missing;
            }
            const extra = Math.max(0, addr - expectedAddr);
            if (missingUnpruned || extra) {
                const ids = Array.from(expectedByAddress.keys());
                const hexRows = ids.length ? await Hex40Map.findAll({
                    attributes: ['id', 'hex'], where: {id: {[Op.in]: ids}}, raw: true,
                }) : [];
                const isEvm = Boolean((this.config as any).noCoreSpace || StatApp.isEVM);
                const addressById = new Map<number, {hex: string, display: string}>((hexRows as any[]).map(row => {
                    const hex = `0x${row.hex}`;
                    let base32 = hex;
                    try { base32 = format.address(hex, this.cfx.networkId); } catch (_) { /* retain hex */ }
                    return [Number(row.id), {hex, display: isEvm ? hex : base32}];
                }));
                const txRows = sourceRows[0] || [];
                const txHashByPosition = new Map<string, string>(txRows.map((row: any) =>
                    [`${Number(row.blockPosition)}:${Number(row.txPosition)}`, row.hash]).filter((item: any[]) => item[1]));
                const expectedDetails: any[] = [];
                for (const row of source) {
                    const expectedType = row._source === 'tx' ? 10 : row._source === 'erc20' ? 20 : row._source === 'erc721' ? 21 : row._source === 'erc1155' ? 55 : Number(row.type);
                    const addresses: number[] = [];
                    if (row.fromId !== undefined && row.fromId !== null) addresses.push(Number(row.fromId));
                    if (row.toId && row.toId !== row.fromId) addresses.push(Number(row.toId));
                    for (const addressId of addresses) {
                        const present = (actualRows as any[]).some(actual => Number(actual.addressId) === addressId &&
                            Number(actual.blockIndex) === Number(row.blockIndex ?? row.blockPosition) &&
                            Number(actual.txIndex) === Number(row.txIndex ?? row.txPosition) &&
                            Number(actual.txLogIndex || 0) === Number(row.txLogIndex || 0) &&
                            Number(actual.batchIndex || 0) === Number(row.batchIndex || 0) &&
                            Number(actual.type) === expectedType);
                        if (!present) expectedDetails.push({source: row._source || 'transfer', type: expectedType, addressId,
                            address: addressById.get(addressId)?.display || null,
                            addressHex: addressById.get(addressId)?.hex || null,
                            addressUrl: addressById.get(addressId) ? (isEvm ? addressById.get(addressId).hex : addressById.get(addressId).display) : null,
                            amount: row.value ?? row.amount ?? row.dripValue ?? null,
                            blockIndex: row.blockIndex ?? row.blockPosition, txIndex: row.txIndex ?? row.txPosition, txLogIndex: row.txLogIndex || 0,
                            txHash: txHashByPosition.get(`${Number(row.blockIndex ?? row.blockPosition)}:${Number(row.txIndex ?? row.txPosition)}`) || null,
                            pruneCursor: pruneByAddress.get(addressId) || null});
                    }
                }
                const reportDir = path.resolve(process.cwd(), 'public/stat/epoch-checker-reports');
                fs.mkdirSync(reportDir, {recursive: true});
                const reportName = `epoch-${epoch}-${Date.now()}.html`;
                const reportRows = expectedDetails.map(row => {
                    const address = row.addressUrl ? `<a href="/address/${encodeURIComponent(row.addressUrl)}">${escapeHtml(row.address)}</a>` : escapeHtml(row.address);
                    const tx = row.txHash ? `<a href="/tx/${encodeURIComponent(row.txHash)}">${escapeHtml(row.txHash)}</a>` : '-';
                    return `<tr><td>${escapeHtml(row.source)}</td><td>${escapeHtml(transferTypeLabel(row.type))}</td><td>${escapeHtml(row.addressId)}</td><td>${address}</td><td>${escapeHtml(row.amount)}</td><td>${escapeHtml(row.blockIndex)}</td><td>${escapeHtml(row.txIndex)}</td><td>${escapeHtml(row.txLogIndex)}</td><td>${tx}</td><td>${escapeHtml(row.pruneCursor)}</td></tr>`;
                }).join('');
                const actualRowsHtml = (actualRows as any[]).map(row => {
                    const addressInfo = addressById.get(Number(row.addressId));
                    const addressUrl = addressInfo ? (isEvm ? addressInfo.hex : addressInfo.display) : null;
                    const address = addressUrl ? `<a href="/address/${encodeURIComponent(addressUrl)}">${escapeHtml(addressInfo.display)}</a>` : '';
                    return `<tr><td>${escapeHtml(row.addressId)}</td><td>${escapeHtml(transferTypeLabel(row.type))}</td><td>${address}</td><td>${escapeHtml(row.value)}</td><td>${escapeHtml(row.blockIndex)}</td><td>${escapeHtml(row.txIndex)}</td><td>${escapeHtml(row.txLogIndex)}</td></tr>`;
                }).join('');
                const reportHtml = `<!doctype html><meta charset="utf-8"><title>Epoch ${escapeHtml(epoch)} address transfer mismatch</title><style>body{font:14px system-ui;margin:32px;color:#17202a}h1{margin-bottom:4px}.meta{color:#667085;margin-bottom:24px}table{border-collapse:collapse;width:100%;margin:12px 0 28px}th,td{border:1px solid #d0d5dd;padding:7px;text-align:left}th{background:#f2f4f7}code{font-family:ui-monospace,monospace}</style><h1>Epoch ${escapeHtml(epoch)} · address_transfer</h1><div class="meta">expected ${escapeHtml(expectedAddr)} · actual ${escapeHtml(addr)} · missing unpruned ${escapeHtml(missingUnpruned)} · pruned ${escapeHtml(addressTransferPruned)} · extra ${escapeHtml(extra)}</div><p>每条源 transfer 会为 from 和 to（地址不同时）各生成一条 address_transfer。1 条普通交易加 1 条 ERC20 Transfer 事件，可能产生 4 条派生记录。</p><h2>Missing rows</h2><table><tr><th>source</th><th>type</th><th>address ID</th><th>address</th><th>amount</th><th>block</th><th>tx index</th><th>log</th><th>transaction hash</th><th>prune cursor</th></tr>${reportRows || '<tr><td colspan="10">none</td></tr>'}</table><h2>Actual rows selected by source address IDs</h2><table><tr><th>address ID</th><th>type</th><th>address</th><th>amount</th><th>block</th><th>tx index</th><th>log</th></tr>${actualRowsHtml || '<tr><td colspan="7">none</td></tr>'}</table>`;
                fs.writeFileSync(path.join(reportDir, reportName), reportHtml, 'utf8');
                const reportUrl = `/stat/epoch-checker-reports/${reportName}`;
                addressDiagnostic = ` report=${reportUrl} address_transfer_diagnostic=${JSON.stringify({missing: expectedDetails,
                    actualAddresses: Array.from(actualByAddress.keys()).map(id => ({addressId: id, address: addressById.get(id)?.display || null}))})}`;
                out.push({kind: 'count', key: `address_transfer:${epoch}`, expected: expectedAddr,
                    actual: addr, detail: `missingUnpruned=${missingUnpruned} extra=${extra} pruned=${addressTransferPruned}${addressDiagnostic}`});
            }
        }
        const expectedAddressIds = new Set(addressIds).size;
        // EpochSync evicts this helper table below latest_finalized - 1000.
        // Do not report normal retention cleanup as historical data loss.
        if (latestFinalized === undefined || epoch >= latestFinalized - 1000) {
            if (addrIds !== expectedAddressIds) out.push({kind: 'count', key: `epoch_address_ids:${epoch}`, expected: expectedAddressIds, actual: addrIds});
        }
        const expectedNft = t721.length + t1155.length;
        if (nft !== expectedNft) out.push({kind: 'count', key: `nft_transfer:${epoch}`, expected: expectedNft, actual: nft});
        if (addrNft < expectedNft || addrNft > expectedNft * 2) out.push({kind: 'count', key: `address_nft_transfer:${epoch}`, expected: `${expectedNft}..${expectedNft * 2}`, actual: addrNft});
        if (censorRows !== 0 && censorRows !== tx.length) out.push({kind: 'count', key: `censor_item:${epoch}`, expected: tx.length, actual: censorRows});
        // These tables are event driven. Ensure every row points at this epoch
        // and never contains an impossible future epoch after a partial write.
        // Each event query is constrained by its epoch column, so counts are
        // sufficient and avoid transferring full rows from the database.
        const eventCount = eventRows.reduce((sum: number, count: number) => sum + Number(count), 0);
        const detail = `[derived rows tx=${tx.length} cfx=${cfx.length} erc20=${t20.length} erc721=${t721.length} erc1155=${t1155.length} ` +
            `address_transfer=${addr} pruned=${addressTransferPruned} address_tx=${txIndex} txPruned=${txIndexPruned} epoch_address_ids=${addrIds} nft_transfer=${nft} ` + addressDiagnostic +
            `address_nft_transfer=${addrNft} censor_item=${censorRows} events=${eventCount}; ` +
            `ms source=${sourceMs} address_transfer=${addrQ.ms} epoch_address_ids=${addrIdsQ.ms} address_tx=${txIndexQ.ms} nft_transfer=${nftQ.ms} ` +
            `address_nft_transfer=${addrNftQ.ms} censor_item=${censorQ.ms} events=${eventsQ.ms}]`;
        return {differences: out, detail};
    }
}
