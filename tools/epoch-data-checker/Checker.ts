import {Conflux} from 'js-conflux-sdk';
import {Op} from 'sequelize';
import {Epoch} from '../../stat/model/Epoch';
import {FullBlock, FullTransaction} from '../../stat/model/FullBlock';
import {CfxTransfer} from '../../stat/model/CfxTransfer';
import {Erc20Transfer} from '../../stat/model/Erc20Transfer';
import {Erc721Transfer} from '../../stat/model/Erc721Transfer';
import {Erc1155Transfer} from '../../stat/model/Erc1155Transfer';
import {getAddrId} from '../../stat/model/HexMap';
import {compareRows, Difference} from './Compare';
import {CursorStore} from './CursorStore';
import {dingMsg} from '../../stat/monitor/Monitor';
import {StatConfig} from '../../stat/config/StatConfig';
import {TokenTool} from '../../stat/service/tool/TokenTool';
import {getCfxTransfer} from '../../stat/CfxTransferSync';

export type Direction = 'forward'|'backward';

export class EpochDataChecker {
    private readonly cursors = new CursorStore();
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
        if (await this.cursors.paused(direction)) return;
        const latest = await this.latestFinalized();
        const cursor = await this.cursors.get(direction);
        if (cursor === null) return;
        if (direction === 'forward' && cursor > latest) return;
        if (direction === 'backward' && cursor < 0) return;

        // The newest finalized epoch must already be represented in the DB.
        // This catches a stopped production container separately from a row diff.
        if (direction === 'forward') {
            const ready = await Epoch.findOne({where: {epoch: latest}, raw: true});
            const block = await FullBlock.findOne({where: {epoch: latest}, raw: true});
            if (!ready || !block) return this.fail(direction, latest, 'latest finalized epoch is not fully in database');
        }

        const differences = await this.checkEpoch(cursor);
        if (differences.length) return this.fail(direction, cursor, JSON.stringify(differences.slice(0, 20)));
        await this.cursors.set(direction, direction === 'forward' ? cursor + 1 : cursor - 1);
    }

    private async fail(direction: Direction, epoch: number, reason: string) {
        await this.cursors.pause(direction);
        await dingMsg(`[${this.config.serverTag}] epoch data checker ${direction} paused at epoch ${epoch}: ${reason}`, this.config.dingTalkToken);
        console.error(`epoch data checker ${direction} paused at ${epoch}: ${reason}`);
    }

    async checkEpoch(epoch: number): Promise<Difference[]> {
        const differences: Difference[] = [];
        const rpcPivot: any = await this.cfx.getBlockByEpochNumber(epoch);
        const dbEpoch: any = await Epoch.findOne({where: {epoch}, raw: true});
        if (!rpcPivot || !dbEpoch) {
            differences.push({kind: 'missing', key: `epoch:${epoch}`, expected: rpcPivot ? 'db row' : 'rpc row'});
            return differences;
        }
        if (String(dbEpoch.pivotHash).toLowerCase() !== String(rpcPivot.hash).toLowerCase()) {
            differences.push({kind: 'field', key: `epoch:${epoch}.pivotHash`, expected: rpcPivot.hash, actual: dbEpoch.pivotHash});
        }
        const rpcTimestamp = Math.floor(Number(rpcPivot.timestamp));
        const dbTimestamp = Math.floor(new Date(dbEpoch.timestamp).getTime() / 1000);
        if (rpcTimestamp !== dbTimestamp) differences.push({kind: 'field', key: `epoch:${epoch}.timestamp`, expected: rpcTimestamp, actual: dbTimestamp});
        return differences.concat(await this.checkBlocks(epoch, rpcPivot), await this.checkCfxTransfers(epoch, rpcPivot), await this.checkTokenTransfers(epoch, rpcPivot));
    }

    private async checkBlocks(epoch: number, rpcPivot: any): Promise<Difference[]> {
        const rpcBlocks: any[] = await this.cfx.getBlocksByEpochNumber(epoch) || [];
        const dbBlocks: any[] = await FullBlock.findAll({where: {epoch}, order: [['position', 'asc']], raw: true});
        const expected = [];
        for (let position = 0; position < rpcBlocks.length; position++) {
            const block = await this.cfx.getBlockByHash(rpcBlocks[position], false);
            if (!block) continue;
            expected.push({epoch, position, hash: block.hash, pivot: block.hash === rpcPivot.hash,
                difficulty: String(block.difficulty || 0), txCount: (block.transactions || []).length});
        }
        const actual = dbBlocks.map(row => ({...row, difficulty: String(row.difficulty || 0)}));
        return compareRows(expected, actual, row => `${row.epoch}:${row.position}`, ['hash', 'pivot', 'difficulty', 'txCount']);
    }

    private async id(address: string): Promise<number> {
        const id = await getAddrId(address, -1);
        return id === undefined ? -1 : Number(id);
    }

    private async checkTokenTransfers(epoch: number, pivot: any): Promise<Difference[]> {
        const receipts: any[][] = await (this.cfx as any).getEpochReceiptsByPivotBlockHash(pivot.hash) || [];
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
        for (const [type, model] of models) {
            const actual = await model.findAll({where: {epoch}, raw: true});
            const e = expected.filter(row => row._type === type);
            const fields = type === 'erc20' ? ['contractId','fromId','toId','value'] : type === 'erc721' ? ['contractId','fromId','toId','tokenId'] : ['contractId','fromId','toId','tokenId','value','batchIndex'];
            result.push(...compareRows(e, actual, row => `${row.blockIndex}:${row.txIndex}:${row.txLogIndex}:${row.batchIndex || 0}`, fields));
        }
        return result;
    }

    private async checkCfxTransfers(epoch: number, pivot: any): Promise<Difference[]> {
        const hashes: any[] = await this.cfx.getBlocksByEpochNumber(epoch) || [];
        const expected: any[] = [];
        for (let blockIndex = 0; blockIndex < hashes.length; blockIndex++) {
            const traced: any = await (this.cfx as any).traceBlock(hashes[blockIndex]);
            for (const tx of traced?.transactionTraces || []) {
                for (let traceIndex = 0; traceIndex < (tx.traces || []).length; traceIndex++) {
                    const transfer: any = getCfxTransfer(tx.traces[traceIndex]);
                    if (!transfer) continue;
                    expected.push({epoch, blockIndex, txIndex: Number(tx.transactionPosition || 0), txLogIndex: traceIndex,
                        fromId: await this.id(transfer.from), toId: await this.id(transfer.to), value: String(transfer.value), type: transfer.type});
                }
            }
        }
        const actual = await CfxTransfer.findAll({where: {epoch}, raw: true});
        return compareRows(expected, actual, row => `${row.blockIndex}:${row.txIndex}:${row.txLogIndex}`, ['fromId','toId','value','type']);
    }
}
