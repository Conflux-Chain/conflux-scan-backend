import {Conflux} from 'js-conflux-sdk';
import {Op} from 'sequelize';
import {Epoch} from '../../stat/model/Epoch';
import {FullBlock, FullTransaction} from '../../stat/model/FullBlock';
import {CfxTransfer} from '../../stat/model/CfxTransfer';
import {Erc20Transfer} from '../../stat/model/Erc20Transfer';
import {Erc721Transfer} from '../../stat/model/Erc721Transfer';
import {Erc1155Transfer} from '../../stat/model/Erc1155Transfer';
import {getAddrId} from '../../stat/model/HexMap';
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
import {LAST_ERROR} from './Control';
import {KV} from '../../stat/model/KV';

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

export class EpochDataChecker {
    private readonly cursors = new CursorStore();
    private readonly addressIdCache = new Map<string, Promise<number>>();
    private readonly epochRows = new Map<string, Promise<any[]>>();
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
        if (await this.cursors.paused(direction)) { console.log(`[epoch-checker] ${direction} paused`); return; }
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
        if (result.differences.length) return this.fail(direction, cursor, JSON.stringify(result.differences.slice(0, 20)));
        const next = direction === 'forward' ? cursor + 1 : cursor - 1;
        await this.cursors.set(direction, next);
        const t = result.timings;
        console.log(`[epoch-checker] ${direction.padEnd(8)} epoch=${cursor} matched; cursor=${next} ` +
            `ms=${t.total} epoch=${t.epoch} blocks=${t.blocks} cfx=${t.cfx} token=${t.token} derived=${t.derived}` +
            (result.detail ? ` ${result.detail}` : ''));
    }

    private async fail(direction: Direction, epoch: number, reason: string) {
        await this.cursors.pause(direction);
        await KV.upsert({key: LAST_ERROR, value: JSON.stringify({direction, epoch, reason, at: new Date().toISOString()})});
        await dingMsg(`[${this.config.serverTag}] epoch data checker ${direction} paused at epoch ${epoch}: ${reason}`, this.config.dingTalkToken);
        console.error(`epoch data checker ${direction} paused at ${epoch}: ${reason}`);
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
        return compareRows(expected, actual, row => `${row.epoch}:${row.position}`, ['hash', 'pivot', 'difficulty', 'txCount']);
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
            for (const receipt of receipts[blockIndex] || []) {
                if (receipt.outcomeStatus !== undefined && receipt.outcomeStatus !== 0 && receipt.outcomeStatus !== 1) continue;
                for (const log of receipt.logs || []) {
                    const common: any = {epoch, blockIndex, txIndex: Number(receipt.transactionIndex || 0),
                        txLogIndex: Number(log.logIndex || 0), contractId: await this.id(log.address),
                        fromId: -1, toId: -1, createdAt: new Date(Number(pivot.timestamp) * 1000)};
                    const e20: any = this.tokenTool.decodeERC20TransferPlus(log, true);
                    const e721: any = this.tokenTool.decodeERC721Transfer(log, true);
                    const e1155: any[] = this.tokenTool.decodeERC1155TransferArrayPlus(log);
                    if (e20) expected.push({...common, fromId: await this.id(e20.from), toId: await this.id(e20.to), value: String(e20.value), _type: 'erc20'});
                    else if (e721) expected.push({...common, fromId: await this.id(e721.from), toId: await this.id(e721.to), tokenId: String(e721.tokenId), _type: 'erc721'});
                    else if (e1155?.length) for (const item of e1155) expected.push({...common, fromId: await this.id(item.from), toId: await this.id(item.to), tokenId: String(item.tokenId), value: String(item.value), batchIndex: item.batchIndex, _type: 'erc1155'});
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
            const fields = type === 'erc20' ? ['contractId','fromId','toId','value'] : type === 'erc721' ? ['contractId','fromId','toId','tokenId'] : ['contractId','fromId','toId','tokenId','value','batchIndex'];
            result.push(...compareRows(e, actual, row => `${row.blockIndex}:${row.txIndex}:${row.txLogIndex}:${row.batchIndex || 0}`, fields));
        }
        return result;
    }

    private async checkCfxTransfers(epoch: number, pivot: any): Promise<Difference[]> {
        const [hashes, actual]: [any[], any[]] = await Promise.all([
            this.cfx.getBlocksByEpochNumber(epoch).then(rows => rows || []),
            this.rows(CfxTransfer, 'cfx', epoch),
        ]);
        const expected: any[] = [];
        const traces = await Promise.all(hashes.map(hash => (this.cfx as any).traceBlock(hash)));
        for (let blockIndex = 0; blockIndex < traces.length; blockIndex++) {
            const traced: any = traces[blockIndex];
            for (const tx of traced?.transactionTraces || []) {
                for (let traceIndex = 0; traceIndex < (tx.traces || []).length; traceIndex++) {
                    const transfer: any = getCfxTransfer(tx.traces[traceIndex]);
                    if (!transfer) continue;
                    expected.push({epoch, blockIndex, txIndex: Number(tx.transactionPosition || 0), txLogIndex: traceIndex,
                        fromId: await this.id(transfer.from), toId: await this.id(transfer.to), value: String(transfer.value), type: transfer.type});
                }
            }
        }
        return compareRows(expected, actual, row => `${row.blockIndex}:${row.txIndex}:${row.txLogIndex}`, ['fromId','toId','value','type']);
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
        const source = [...tx, ...cfx, ...token];
        const addressIds = Array.from(new Set(source.flatMap((row: any) =>
            [row.fromId, row.toId].filter(id => id !== undefined && id !== null).map(id => Number(id)))));
        const addressWhere = addressIds.length ? {epoch, addressId: {[Op.in]: addressIds}} : {epoch: -1};
        const [addrQ, addrIdsQ, nftQ, addrNftQ, censorQ, eventsQ] = await Promise.all([
            this.timed('address_transfer', () => AddressTransfer.findAll({where: addressWhere, raw: true})),
            this.timed('epoch_address_ids', () => latestFinalized === undefined || epoch >= latestFinalized - 1000
                ? EpochAddressIds.findAll({where: {epoch}, raw: true})
                : Promise.resolve([])),
            this.timed('nft_transfer', () => NftTransfer.findAll({where: {epoch}, raw: true})),
            this.timed('address_nft_transfer', () => AddressNftTransfer.findAll({where: addressWhere, raw: true})),
            this.timed('censor_item', () => CensorItem.findAll({where: {epochNumber: epoch}, raw: true})),
            this.timed('events', () => Promise.all([
                ContractDestroy.findAll({where: {epochNumber: epoch}, raw: true}),
                NameTag.findAll({where: {epoch}, raw: true}),
                VoteParams.findAll({where: {epoch}, raw: true}),
            ])),
        ]);
        const addr = addrQ.value;
        const addrIds = addrIdsQ.value;
        const nft = nftQ.value;
        const addrNft = addrNftQ.value;
        const censorRows = censorQ.value;
        const eventRows = eventsQ.value;
        const expectedAddr = source.reduce((n: number, row: any) => n + (row.fromId !== undefined ? 1 : 0) + (row.toId && row.toId !== row.fromId ? 1 : 0), 0);
        if (addr.length !== expectedAddr) out.push({kind: 'count', key: `address_transfer:${epoch}`, expected: expectedAddr, actual: addr.length});
        const ids = new Set<number>();
        addr.forEach((row: any) => ids.add(Number(row.addressId)));
        // EpochSync evicts this helper table below latest_finalized - 1000.
        // Do not report normal retention cleanup as historical data loss.
        if (latestFinalized === undefined || epoch >= latestFinalized - 1000) {
            if (addrIds.length !== ids.size) out.push({kind: 'count', key: `epoch_address_ids:${epoch}`, expected: ids.size, actual: addrIds.length});
        }
        const expectedNft = t721.length + t1155.length;
        if (nft.length !== expectedNft) out.push({kind: 'count', key: `nft_transfer:${epoch}`, expected: expectedNft, actual: nft.length});
        if (addrNft.length < expectedNft || addrNft.length > expectedNft * 2) out.push({kind: 'count', key: `address_nft_transfer:${epoch}`, expected: `${expectedNft}..${expectedNft * 2}`, actual: addrNft.length});
        if (censorRows.length !== 0 && censorRows.length !== tx.length) out.push({kind: 'count', key: `censor_item:${epoch}`, expected: tx.length, actual: censorRows.length});
        // These tables are event driven. Ensure every row points at this epoch
        // and never contains an impossible future epoch after a partial write.
        const eventDefs = [['contract_destroy', 'epochNumber'], ['name_tag', 'epoch'], ['vote_params', 'epoch']];
        for (let i = 0; i < eventDefs.length; i++) {
            const [name, field] = eventDefs[i];
            const rows: any[] = eventRows[i];
            if (rows.some(row => Number(row[field]) !== epoch)) out.push({kind: 'field', key: `${name}:${epoch}`});
        }
        const eventCount = eventRows.reduce((sum: number, rows: any[]) => sum + rows.length, 0);
        const detail = `[derived rows tx=${tx.length} cfx=${cfx.length} erc20=${t20.length} erc721=${t721.length} erc1155=${t1155.length} ` +
            `address_transfer=${addr.length} epoch_address_ids=${addrIds.length} nft_transfer=${nft.length} ` +
            `address_nft_transfer=${addrNft.length} censor_item=${censorRows.length} events=${eventCount}; ` +
            `ms source=${sourceMs} address_transfer=${addrQ.ms} epoch_address_ids=${addrIdsQ.ms} nft_transfer=${nftQ.ms} ` +
            `address_nft_transfer=${addrNftQ.ms} censor_item=${censorQ.ms} events=${eventsQ.ms}]`;
        return {differences: out, detail};
    }
}
