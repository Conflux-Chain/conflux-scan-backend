"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EpochDataChecker = void 0;
const Epoch_1 = require("../../stat/model/Epoch");
const FullBlock_1 = require("../../stat/model/FullBlock");
const CfxTransfer_1 = require("../../stat/model/CfxTransfer");
const Erc20Transfer_1 = require("../../stat/model/Erc20Transfer");
const Erc721Transfer_1 = require("../../stat/model/Erc721Transfer");
const Erc1155Transfer_1 = require("../../stat/model/Erc1155Transfer");
const HexMap_1 = require("../../stat/model/HexMap");
const Compare_1 = require("./Compare");
const CursorStore_1 = require("./CursorStore");
const Monitor_1 = require("../../stat/monitor/Monitor");
const TokenTool_1 = require("../../stat/service/tool/TokenTool");
const CfxTransferSync_1 = require("../../stat/CfxTransferSync");
const AddrTransfer_1 = require("../../stat/model/AddrTransfer");
const NftTransfer_1 = require("../../stat/model/NftTransfer");
const NftTransfer_2 = require("../../stat/model/NftTransfer");
const TraceCreateContract_1 = require("../../stat/model/TraceCreateContract");
const NameTag_1 = require("../../stat/model/NameTag");
const CensorItem_1 = require("../../stat/model/CensorItem");
const Epoch_2 = require("../../stat/model/Epoch");
const Control_1 = require("./Control");
const KV_1 = require("../../stat/model/KV");
class EpochDataChecker {
    constructor(cfx, config) {
        this.cfx = cfx;
        this.config = config;
        this.cursors = new CursorStore_1.CursorStore();
        this.tokenTool = new TokenTool_1.TokenTool(cfx);
    }
    async latestFinalized() {
        return Number(await this.cfx.getEpochNumber('latest_finalized'));
    }
    async initialize(latest) {
        const initial = Math.max(0, latest - 100000);
        if (await this.cursors.get('forward') === null)
            await this.cursors.set('forward', initial);
        if (await this.cursors.get('backward') === null)
            await this.cursors.set('backward', initial);
    }
    async run(direction) {
        if (await this.cursors.paused(direction)) {
            console.log(`[epoch-checker] ${direction} paused`);
            return;
        }
        const latest = await this.latestFinalized();
        const cursor = await this.cursors.get(direction);
        console.log(`[epoch-checker] ${direction} latest=${latest} cursor=${cursor}`);
        if (cursor === null)
            return;
        if (direction === 'forward' && cursor > latest)
            return;
        if (direction === 'backward' && cursor < 0)
            return;
        // The newest finalized epoch must already be represented in the DB.
        // This catches a stopped production container separately from a row diff.
        if (direction === 'forward') {
            const ready = await Epoch_1.Epoch.findOne({ where: { epoch: latest }, raw: true });
            const block = await FullBlock_1.FullBlock.findOne({ where: { epoch: latest }, raw: true });
            if (!ready || !block)
                return this.fail(direction, latest, 'latest finalized epoch is not fully in database');
        }
        const differences = await this.checkEpoch(cursor);
        if (differences.length)
            return this.fail(direction, cursor, JSON.stringify(differences.slice(0, 20)));
        const next = direction === 'forward' ? cursor + 1 : cursor - 1;
        await this.cursors.set(direction, next);
        console.log(`[epoch-checker] ${direction} epoch=${cursor} matched; cursor=${next}`);
    }
    async fail(direction, epoch, reason) {
        await this.cursors.pause(direction);
        await KV_1.KV.upsert({ key: Control_1.LAST_ERROR, value: JSON.stringify({ direction, epoch, reason, at: new Date().toISOString() }) });
        await Monitor_1.dingMsg(`[${this.config.serverTag}] epoch data checker ${direction} paused at epoch ${epoch}: ${reason}`, this.config.dingTalkToken);
        console.error(`epoch data checker ${direction} paused at ${epoch}: ${reason}`);
    }
    async checkEpoch(epoch) {
        const differences = [];
        const rpcPivot = await this.cfx.getBlockByEpochNumber(epoch);
        const dbEpoch = await Epoch_1.Epoch.findOne({ where: { epoch }, raw: true });
        if (!rpcPivot || !dbEpoch) {
            differences.push({ kind: 'missing', key: `epoch:${epoch}`, expected: rpcPivot ? 'db row' : 'rpc row' });
            return differences;
        }
        if (String(dbEpoch.pivotHash).toLowerCase() !== String(rpcPivot.hash).toLowerCase()) {
            differences.push({ kind: 'field', key: `epoch:${epoch}.pivotHash`, expected: rpcPivot.hash, actual: dbEpoch.pivotHash });
        }
        const rpcTimestamp = Math.floor(Number(rpcPivot.timestamp));
        const dbTimestamp = Math.floor(new Date(dbEpoch.timestamp).getTime() / 1000);
        if (rpcTimestamp !== dbTimestamp)
            differences.push({ kind: 'field', key: `epoch:${epoch}.timestamp`, expected: rpcTimestamp, actual: dbTimestamp });
        return differences.concat(await this.checkBlocks(epoch, rpcPivot), await this.checkCfxTransfers(epoch, rpcPivot), await this.checkTokenTransfers(epoch, rpcPivot), await this.checkDerivedData(epoch));
    }
    async checkBlocks(epoch, rpcPivot) {
        const rpcBlocks = await this.cfx.getBlocksByEpochNumber(epoch) || [];
        const dbBlocks = await FullBlock_1.FullBlock.findAll({ where: { epoch }, order: [['position', 'asc']], raw: true });
        const expected = [];
        for (let position = 0; position < rpcBlocks.length; position++) {
            const block = await this.cfx.getBlockByHash(rpcBlocks[position], false);
            if (!block)
                continue;
            expected.push({ epoch, position, hash: block.hash, pivot: block.hash === rpcPivot.hash,
                difficulty: String(block.difficulty || 0), txCount: (block.transactions || []).length });
        }
        const actual = dbBlocks.map(row => ({ ...row, difficulty: String(row.difficulty || 0) }));
        return Compare_1.compareRows(expected, actual, row => `${row.epoch}:${row.position}`, ['hash', 'pivot', 'difficulty', 'txCount']);
    }
    async id(address) {
        const id = await HexMap_1.getAddrId(address, -1);
        return id === undefined ? -1 : Number(id);
    }
    async checkTokenTransfers(epoch, pivot) {
        const receipts = await this.cfx.getEpochReceiptsByPivotBlockHash(pivot.hash) || [];
        const expected = [];
        for (let blockIndex = 0; blockIndex < receipts.length; blockIndex++) {
            for (const receipt of receipts[blockIndex] || []) {
                if (receipt.outcomeStatus !== undefined && receipt.outcomeStatus !== 0 && receipt.outcomeStatus !== 1)
                    continue;
                for (const log of receipt.logs || []) {
                    const common = { epoch, blockIndex, txIndex: Number(receipt.transactionIndex || 0),
                        txLogIndex: Number(log.logIndex || 0), contractId: await this.id(log.address),
                        fromId: -1, toId: -1, createdAt: new Date(Number(pivot.timestamp) * 1000) };
                    const e20 = this.tokenTool.decodeERC20TransferPlus(log, true);
                    const e721 = this.tokenTool.decodeERC721Transfer(log, true);
                    const e1155 = this.tokenTool.decodeERC1155TransferArrayPlus(log);
                    if (e20)
                        expected.push({ ...common, fromId: await this.id(e20.from), toId: await this.id(e20.to), value: String(e20.value), _type: 'erc20' });
                    else if (e721)
                        expected.push({ ...common, fromId: await this.id(e721.from), toId: await this.id(e721.to), tokenId: String(e721.tokenId), _type: 'erc721' });
                    else if (e1155?.length)
                        for (const item of e1155)
                            expected.push({ ...common, fromId: await this.id(item.from), toId: await this.id(item.to), tokenId: String(item.tokenId), value: String(item.value), batchIndex: item.batchIndex, _type: 'erc1155' });
                }
            }
        }
        const models = [
            ['erc20', Erc20Transfer_1.Erc20Transfer], ['erc721', Erc721Transfer_1.Erc721Transfer], ['erc1155', Erc1155Transfer_1.Erc1155Transfer]
        ];
        const result = [];
        for (const [type, model] of models) {
            const actual = await model.findAll({ where: { epoch }, raw: true });
            const e = expected.filter(row => row._type === type);
            const fields = type === 'erc20' ? ['contractId', 'fromId', 'toId', 'value'] : type === 'erc721' ? ['contractId', 'fromId', 'toId', 'tokenId'] : ['contractId', 'fromId', 'toId', 'tokenId', 'value', 'batchIndex'];
            result.push(...Compare_1.compareRows(e, actual, row => `${row.blockIndex}:${row.txIndex}:${row.txLogIndex}:${row.batchIndex || 0}`, fields));
        }
        return result;
    }
    async checkCfxTransfers(epoch, pivot) {
        const hashes = await this.cfx.getBlocksByEpochNumber(epoch) || [];
        const expected = [];
        for (let blockIndex = 0; blockIndex < hashes.length; blockIndex++) {
            const traced = await this.cfx.traceBlock(hashes[blockIndex]);
            for (const tx of traced?.transactionTraces || []) {
                for (let traceIndex = 0; traceIndex < (tx.traces || []).length; traceIndex++) {
                    const transfer = CfxTransferSync_1.getCfxTransfer(tx.traces[traceIndex]);
                    if (!transfer)
                        continue;
                    expected.push({ epoch, blockIndex, txIndex: Number(tx.transactionPosition || 0), txLogIndex: traceIndex,
                        fromId: await this.id(transfer.from), toId: await this.id(transfer.to), value: String(transfer.value), type: transfer.type });
                }
            }
        }
        const actual = await CfxTransfer_1.CfxTransfer.findAll({ where: { epoch }, raw: true });
        return Compare_1.compareRows(expected, actual, row => `${row.blockIndex}:${row.txIndex}:${row.txLogIndex}`, ['fromId', 'toId', 'value', 'type']);
    }
    /** Validate all secondary tables written by EpochSync against the primary
     * rows for this epoch. This is deliberately relational and read-only: it
     * detects partial writes without replaying metadata side effects. */
    async checkDerivedData(epoch) {
        const out = [];
        const tx = await FullBlock_1.FullTransaction.findAll({ where: { epoch }, raw: true });
        const cfx = await CfxTransfer_1.CfxTransfer.findAll({ where: { epoch }, raw: true });
        const t20 = await Erc20Transfer_1.Erc20Transfer.findAll({ where: { epoch }, raw: true });
        const t721 = await Erc721Transfer_1.Erc721Transfer.findAll({ where: { epoch }, raw: true });
        const t1155 = await Erc1155Transfer_1.Erc1155Transfer.findAll({ where: { epoch }, raw: true });
        const token = [...t20, ...t721, ...t1155];
        const source = [...tx, ...cfx, ...token];
        const addr = await AddrTransfer_1.AddressTransfer.findAll({ where: { epoch }, raw: true });
        const expectedAddr = source.reduce((n, row) => n + (row.fromId !== undefined ? 1 : 0) + (row.toId && row.toId !== row.fromId ? 1 : 0), 0);
        if (addr.length !== expectedAddr)
            out.push({ kind: 'count', key: `address_transfer:${epoch}`, expected: expectedAddr, actual: addr.length });
        const addrIds = await AddrTransfer_1.EpochAddressIds.findAll({ where: { epoch }, raw: true });
        const ids = new Set();
        addr.forEach((row) => ids.add(Number(row.addressId)));
        if (addrIds.length !== ids.size)
            out.push({ kind: 'count', key: `epoch_address_ids:${epoch}`, expected: ids.size, actual: addrIds.length });
        const nft = await NftTransfer_1.NftTransfer.findAll({ where: { epoch }, raw: true });
        const expectedNft = t721.length + t1155.length;
        if (nft.length !== expectedNft)
            out.push({ kind: 'count', key: `nft_transfer:${epoch}`, expected: expectedNft, actual: nft.length });
        const addrNft = await NftTransfer_2.AddressNftTransfer.findAll({ where: { epoch }, raw: true });
        if (addrNft.length < expectedNft || addrNft.length > expectedNft * 2)
            out.push({ kind: 'count', key: `address_nft_transfer:${epoch}`, expected: `${expectedNft}..${expectedNft * 2}`, actual: addrNft.length });
        const censor = await CensorItem_1.CensorItem.count({ where: { epochNumber: epoch } });
        if (censor !== 0 && censor !== tx.length)
            out.push({ kind: 'count', key: `censor_item:${epoch}`, expected: tx.length, actual: censor });
        // These tables are event driven. Ensure every row points at this epoch
        // and never contains an impossible future epoch after a partial write.
        for (const [name, model, field] of [['contract_destroy', TraceCreateContract_1.ContractDestroy, 'epochNumber'], ['name_tag', NameTag_1.NameTag, 'epoch'], ['vote_params', Epoch_2.VoteParams, 'epoch']]) {
            const rows = await model.findAll({ where: { [field]: epoch }, raw: true });
            if (rows.some(row => Number(row[field]) !== epoch))
                out.push({ kind: 'field', key: `${name}:${epoch}` });
        }
        return out;
    }
}
exports.EpochDataChecker = EpochDataChecker;
