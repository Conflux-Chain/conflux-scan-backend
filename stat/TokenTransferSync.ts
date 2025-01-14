import {redirectLog} from "./config/LoggerConfig";
import {getTokenTool, IEpochTask,} from "./service/UniqueAddressStat";
import {DatabaseError, DataTypes, Model, Op, Sequelize, Transaction, UniqueConstraintError} from "sequelize";
import {init} from "./service/tool/FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {initCfxSdk} from "./service/common/utils";
import {Measure} from "./service/common/Measure";
import {TransactionReceipt} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {TokenTool} from "./service/tool/TokenTool";
import {
    AddressErc20Transfer,
    aggregateTransfer,
    buildErc20Transfer,
    buildTransferList2address,
    ContractUser,
    Erc20Transfer,
} from "./model/Erc20Transfer";
import {AddressErc721Transfer, buildErc721Transfer, Erc721Transfer} from "./model/Erc721Transfer";
import {AddressErc1155Transfer, Erc1155Transfer} from "./model/Erc1155Transfer";
import {KV, UNIFORM_APPROVAL_EPOCH} from "./model/KV";
import {CheckPivotHashError} from "./service/common/PreLoader";
import {regExitHook, sleep} from "./service/tool/ProcessTool";
import {NftMint, Token} from "./model/Token";
import {FullBlock, FullTransaction, loadMaxBlockEpoch} from "./model/FullBlock";
import {updateTransferCountReal} from "./StreamSync";
import {dingMsg} from "./monitor/Monitor";
import {ConfigInstance, FirstBlockNo} from "./config/StatConfig";
import {loadBlocksByEpoch, loadTxsByEpoch} from "./service/FullBlockService";
import {ApprovalRelation, batchSaveApproval, buildRelation, TaskEpochApproval, TokenApproval} from "./ApprovalSync";
import {EpochHashCfxTransfer, loadParentHash} from "./CfxTransferSync";
import {PreloadMap} from "./service/SyncBase";
import {BatchTokenTransfer} from "./service/BatchDBTx";
import {LogFetcher} from "./service/tool/LogFetcher";

export interface IEpochHashTokenTransfer {
    epoch:number
    hash:string
}
// used to find parent hash when popping
export class EpochHashTokenTransfer extends Model<IEpochHashTokenTransfer>
implements IEpochHashTokenTransfer{
    epoch:number
    hash:string
    static register(seq: Sequelize) {
        EpochHashTokenTransfer.init({
            epoch : {type: DataTypes.BIGINT({unsigned: true}), primaryKey: true},
            hash: {type: DataTypes.CHAR(66), allowNull: false},
        },{
            sequelize: seq, tableName: 'epoch_hash_token_transfer_3',
            updatedAt: false,
        })
    }
}

export function decodeTransferFromReceipts(receipts2d:TransactionReceipt[][],tokenTool: TokenTool,
                                    dt:Date) {
    const result = {t20:[],t721:[],t1155:[], approvals:[]}
    function push(arr:any[], transfer, blockIdx, tx:TransactionReceipt, txLogIndex, txPos) {
        transfer['epoch'] = tx.epochNumber;
        transfer['transactionIndex'] = txPos;//tx.index;
        transfer['transactionLogIndex'] = txLogIndex;
        transfer['blockIndex'] = blockIdx;
        transfer['createdAt'] = dt;
        arr.push(transfer)
    }
    let blockIdx = -1;
    for (let receiptsInBlock of receipts2d) {
        blockIdx ++
        let txPos = -1; // match with the logic in TransactionSync.
        for (let txReceipt of receiptsInBlock) {
            if (txReceipt.outcomeStatus === 0) {
                txPos ++ // inc for status 0
            } else if (txReceipt.outcomeStatus === 1) {
                txPos ++ // inc for status 1 (failed)
                continue;
            } else { // null: not executed; 2: skipped.
                continue;
            }

            let txLogIndex = -1; // epoch receipts do not have transactionLogIndex, but get logs DO.
            for (let log of txReceipt.logs) {
                txLogIndex ++
                if (log.topics.length < 3) {
                    continue;
                }
                const {topics: [, t1, t2, ]} = log;
                if (t1 === undefined || t2 === undefined) {
                    continue
                }
                let transfer;
                if ((transfer = tokenTool.decodeERC20TransferPlus(log, false))) {
                    push(result.t20, transfer, blockIdx, txReceipt, txLogIndex, txPos)
                } else if ((transfer = tokenTool.decodeERC721Transfer(log, false))) {
                    push(result.t721, transfer, blockIdx, txReceipt, txLogIndex, txPos);
                } else if ((transfer = tokenTool.decodeERC1155TransferArrayPlus(log)) && transfer.length) {
                    transfer.forEach(e=>{
                        push(result.t1155, e, blockIdx, txReceipt, txLogIndex, txPos);
                    })
                } else if ((transfer = tokenTool.decode721_1155_ApprovalForAll(log, false))) {
                    push(result.approvals, transfer, blockIdx, txReceipt, txLogIndex, txPos)
                } else if ((transfer = tokenTool.decodeERC721_ERC20Approval(log, false))) {
                    push(result.approvals, transfer, blockIdx, txReceipt, txLogIndex, txPos);
                }
            }
        }
    }
    return result;
}

export async function cfxSafeEpochReceipts(cfx: Conflux, epoch: number, pivotHash: string = '') : Promise<TransactionReceipt[][]> {
    if (ConfigInstance.noCoreSpace) {
        return cfx.getEpochReceipts(epoch);
    }
    if (!pivotHash) {
        pivotHash = await cfx.getBlockByEpochNumber(epoch).then(pivotBlock=> {
            if (!pivotBlock) {
                return '';
            }
            if (pivotBlock.epochNumber != epoch) {
                console.log(`properties mismatch , pivotBlock epoch ${pivotBlock.epochNumber} != wanted ${epoch}`);
                return '';
            }
            return pivotBlock.hash;
        });
        if (!pivotHash) {
            return [];
        }
    }
    return cfx.getEpochReceiptsByPivotBlockHash(pivotHash).then(res=>{
        if (res === null && epoch === 0) {
            console.log(`epoch 0 with null receipts.`)
            res = []
        }
        return res || [];
    }).catch(err=>{
        if (!err.message?.includes('Unknown block number')) {
            console.log(` get EpochReceipts fail, epoch ${epoch}:`, err)
        }
        return []
    })
}

export async function loadEpoch(epoch: number, cfx: Conflux) {
    const tx = await FullBlock.sequelize.transaction();
        // load blocks and txs from db instead of rpc
    const [dbBlocks, dbTxArr, parentDbBlock] = await Promise.all([
                loadBlocksByEpoch(epoch, tx),
                loadTxsByEpoch(epoch, tx),
                FullBlock.findOne({where: {epoch: epoch-1}, transaction: tx})
            ]).finally(()=>tx.rollback());
    if (dbBlocks.length < 1) {
        return {code: 404}
    }
    const blockHashes = dbBlocks.map(b=>b.hash);
    const block = dbBlocks[dbBlocks.length-1];
    const pivotHash = block.hash;
    const receipts = await cfxSafeEpochReceipts(cfx, epoch, pivotHash);
    await validate(epoch, dbBlocks, receipts, dbTxArr);


    // simulatePivotSwitch(epoch, 3)
    const dt = dbBlocks[dbBlocks.length-1].createdAt;
    return {pivotTime: dt, receipts, blockHashes, parentDbBlock, pivotHash, code: 0}
}

export async function validate(epoch:number, dbBlocks:FullBlock[], receipts:TransactionReceipt[][], dbTxArr: FullTransaction[]) {
    if (epoch === 0) {
        return;
    }
    if (receipts === null) {
        throw new Error(`[epoch=${epoch}]validate, null receipts`);
    }
    if (dbBlocks.length !== receipts.length) {
        throw new Error(`[epoch=${epoch}]validate, mismatch length (blocks ${dbBlocks.length}, receipts ${receipts.length})`);
    }
    let dbTxPos = 0
    for (const [blockIndex, block] of dbBlocks.entries()) {
        const rcptOfBlock = receipts[blockIndex];
        for (const [txIndex, tx] of rcptOfBlock.entries()) {
            if (tx.outcomeStatus != 0 && tx.outcomeStatus != 1) {
                continue
            }
            if (tx.blockHash != block.hash) {
                throw new Error(`epoch ${epoch}, db block hash ${block.hash} != receipt block hash ${tx.blockHash}`)
            }
            const dbTx = dbTxArr[dbTxPos ++];
            if (!dbTx) {
                throw new Error(`epoch ${epoch} , miss db tx ${tx.transactionHash}`)
            }
            if (dbTx.hash != tx.transactionHash) {
                throw new Error(`epoch ${epoch} , db tx hash ${dbTx.hash} != receipt tx hash ${tx.transactionHash}`)
            }
            if (tx.epochNumber != epoch) {
                throw new Error(`epoch ${epoch} != receipt ${tx.epochNumber} `)
            }
        }
    }
    if (dbTxPos != dbTxArr.length) {
        throw new Error(`epoch ${epoch} , db has more tx than epochReceipt , ${dbTxPos} / ${dbTxArr.length}  `)
    }
}
async function batchSaveTransfer(mainModel, addrModel, arr, dataForAddr, dbTx) {
    return Promise.all([
        mainModel.bulkCreate(arr, {transaction: dbTx}),
        addrModel.bulkCreate(dataForAddr, {transaction: dbTx}),
        ContractUser.bulkCreate(arr, {transaction: dbTx}),
    ])
}

const simulateSwitchEpochs = new Set<number>();
function simulatePivotSwitch(epoch:number, mod) {
    if (epoch % mod !== 0) {
        return
    }
    if (simulateSwitchEpochs.has(epoch)) {
        return
    }
    simulateSwitchEpochs.add(epoch);
    throw new CheckPivotHashError(`simulate pivot switch ${epoch}.`)
}
const measure = new Measure()
const batchData = new BatchTokenTransfer()
async function run(cfx:Conflux, preFinished: number) {
	const fromEpoch = preFinished + 1;
    const {tokenTool} = getTokenTool(cfx)
    let parentHash = await loadParentHash(fromEpoch, preFinished, EpochHashTokenTransfer);
    async function buildTransfer(arr:any[], fn, dt) {
        for (let e of arr) {
            await fn(e, dt)
        }
    }
    function buildNfts(list, arr) {
        list.forEach(t=>{
            t.updatedAt = t.createdAt
            arr.push(t)
        })
    }
    async function fetchAndBuild(epoch: number) {
        const {pivotTime: dt, receipts, blockHashes, parentDbBlock, pivotHash, code} = await loadEpoch(epoch, cfx);
        if (code != 0) {
            return {code}
        }
        const info = decodeTransferFromReceipts(receipts, tokenTool, dt);
        return buildTransferInfo(dt, info, pivotHash, parentDbBlock?.hash);
    }
    async function buildTransferInfo(dt: Date, info, pivotHash: string, parentHash: string) {
        let {t20:t20raw, t721, t1155, approvals} = info;
        const t20 = aggregateTransfer(t20raw)
        approvals = aggregateTransfer(approvals, true);
        const relations = []
        buildRelation(approvals, relations)
        // after all id is cached, it's almost cpu computation.
        await buildTransfer(t20, buildErc20Transfer, dt);
        await buildTransfer(t721, buildErc721Transfer, dt);
        await buildTransfer(t1155, buildErc721Transfer, dt);
        await buildTransfer(approvals, buildErc20Transfer, dt);
        const nfts = []
        buildNfts(t721, nfts)
        buildNfts(t1155, nfts)
        // build data out of transaction, reduce tx time.
        const [t20addr, t721addr, t1155addr] = [t20, t721, t1155].map(buildTransferList2address)
        return {code: 0, t20, t20addr, t721, t721addr, t1155, t1155addr, nfts, approvals, relations, dt, pivotHash, parentHash}
    }
    async function processData(epoch, finalData) {
        try {
            await measure.call('save', () => save(epoch, finalData as any))
        } catch (e) {
            console.log(` processData catch it, epoch ${epoch}, ${e.message}`)
            return Promise.reject(e)
        }
        parentHash = finalData['pivotHash'];
        return finalData;
    }
    let epoch = fromEpoch;
    async function localPop(ep: number) {
        if (batchData.batchSize > 0) {
            console.log(`${__filename} batch size is ${batchData.batchSize} but re-org detected. epoch ${epoch}`)
            // restart
            process.exit(0)
        }
        /**
         epoch    : current epoch should be processed, but failed because pivot switch,
         epoch - 1: previous/parent epoch, with pivot hash != (parentHash of current epoch), pop it.
         epoch - 2: after (epoch - 1) is popped, it will be the top element on the stack. use its pivot
                    hash as 'parentHash'.
         */
        console.log(` local pop ${ep}`)
        await pop(ep)
        epoch = ep
        parentHash = await loadParentHash(fromEpoch, ep - 1, EpochHashCfxTransfer)
        console.log(` set cursor to ${epoch} local pop ${ep} end -`)
        return ep
    }
    const loader0 = new PreloadMap(fetchAndBuild, batchData.initialTaskCount);
    const stateEpoch = await cfx.getEpochNumber('latest_state')
    // should not higher than block/tx sync, otherwise the transaction hash may not be found.
    let maxEpochOfBlock = 0;
    async function updateMaxDbEpoch() {
        const maxE = await loadMaxBlockEpoch()
        if (typeof maxE !== 'number') {
            console.log(` FullTransaction is empty. ${new Date().toISOString()}`)
            return;
        }
        maxEpochOfBlock = maxE;
        console.log(` update max epoch of block to ${maxE} `)
    }
    await updateMaxDbEpoch()
    let dataFn = e=>loader0.pop(e);
    let useGetLogs = false;
    if (ConfigInstance.useGetLogs && stateEpoch - epoch > 10_000) {
        useGetLogs = true;
        const fetcher = new LogFetcher(cfx, fromEpoch, 1_000);
        fetcher.extBuilder = buildTransferInfo;
        fetcher.building().then()
        dataFn = e=>fetcher.next(e);
        loader0.startNext = ()=>{};
    } else if (batchData.enableByGap(epoch, stateEpoch)) {
        loader0.initTasks(epoch, Math.min(batchData.initialTaskCount, maxEpochOfBlock - fromEpoch));
    }
    async function repeat() {
        return repeat0().catch(err=>{
            console.log(` repeat error at epoch ${epoch}: `, err)
            setTimeout(repeat, 5_000)
        })
    }
    let lastDump = Date.now();
    async function repeat0() {
        if (epoch>maxEpochOfBlock) {
            await updateMaxDbEpoch();
            await EpochHashTokenTransfer.destroy({where: {epoch: {[Op.lt]: epoch - 10_000}}, limit: 5000});
            setTimeout(repeat, 5_000)
            return;
        }
        let action = 'ok'
        let data = await measure.call('fetch', ()=>dataFn(epoch));
        let delay = 0
        switch (action) {
            case "ok":
                try {
                    if (data instanceof CheckPivotHashError) {
                        console.log(` checking pivot hash error, ${data.message}`);
                        await  localPop(epoch - 1)
                        delay = 10_000
                        break;
                    } else if (data instanceof Error) {
                        console.log(` error at epoch ${epoch}`, data)
                        delay = 10_000;
                        break;
                    } else if (data?.parentHash && parentHash && data.parentHash !== parentHash) {
                        console.log(` before save check, parent hash not match, on hand epoch ${epoch
                        } with PH ${data.parentHash} != ${parentHash} (parent)`)
                        await  localPop(epoch - 1)
                        delay = 10_000
                        break;
                    } else if (data.code != 0) {
                        delay = 5_000
                        console.log(`data is incorrect. epoch ${epoch}`, data)
                        break;
                    }
                    await processData(data.toEpoch ?? epoch, data);
                    if (stateEpoch - epoch > batchData.safeCatchupGap) {
                        loader0.startNext()
                    } else if (useGetLogs) {
                        console.log(`should switch to non-get-logs-mod`)
                        await sleep(10_000)
                        process.exit(0)
                    } else {
                        batchData.enable = false
                    }
                    if ( useGetLogs || (epoch % (batchData.enable ? 1000 : 100)) === 0) {
                        const now = Date.now();
                        measure.dump(`${data.toEpoch ?? epoch} Elapsed ${now - lastDump} ${useGetLogs ? "getLogs " : ""}${batchData.enable ? "" : "NO "}batch `, 1, 'save');
                        lastDump = now;
                    }
                    if (useGetLogs) { // use get logs
                        epoch = data.nextEpoch
                    } else {
                        epoch++
                    }
                } catch (e) {
                    if (e instanceof UniqueConstraintError) {
                        console.log(` UniqueConstraintError, epoch ${epoch}, ${e.message}`, e)
                        await sleep(10_000)
                        break;
                    } else if (e instanceof DatabaseError) {
                        const message = ` DatabaseError, epoch ${epoch}, ${e.message}`;
                        console.log(message, e)
                        await sleep(10_000)
                        break;
                    }
                    const failMsg = `process epoch fail at ${epoch}`;
                    console.log(failMsg, e)
                    await notifyError(failMsg, e);
                    process.exit(1)
                }
        }
        setTimeout(repeat, delay)
    }
    repeat().then()
}

async function save(epoch:number, data) {
    batchData.enqueue(data, epoch)
    measure.count('addrBeans', data.t20addr.length);
    if (batchData.shouldWaitBatch()) {
        return;
    }
    return KV.sequelize.transaction(dbTx=>{
        return Promise.all([
            batchSaveTransfer(Erc20Transfer, AddressErc20Transfer, batchData.t20, batchData.t20addr, dbTx),
            batchSaveTransfer(Erc721Transfer, AddressErc721Transfer, batchData.t721, batchData.t721addr, dbTx),
            batchSaveTransfer(Erc1155Transfer, AddressErc1155Transfer, batchData.t1155, batchData.t1155addr, dbTx),
            NftMint.bulkCreate(batchData.nfts, {transaction: dbTx,
                updateOnDuplicate:["updatedAt","toId","epoch","blockIndex","txIndex"],
            }),
            EpochHashTokenTransfer.bulkCreate(batchData.epochHash,{transaction: dbTx}),
            saveApprovals(epoch, batchData.approvals, batchData.relations, dbTx)
        ]).then(()=>batchData.reset())
    })
}
async function saveApprovals(epoch: number, approvals, relations, dbTx) {
    if (epoch < uniformApprovalEpoch) {
        return
    }
    return Promise.all([
        batchSaveApproval(TokenApproval, approvals, dbTx),
        ApprovalRelation.bulkCreate(relations, {transaction: dbTx,
                      updateOnDuplicate:["updatedAt","epoch","blockIndex","txIndex", "value"],
                  })
    ])
}
const MAIN_TRANSFER_MODELS = [Erc20Transfer, Erc721Transfer, Erc1155Transfer]
async function pop(epoch:number) {
    async function prepare(model:any) {
        const mainList = await model.findAll({where: {epoch}})
        if (mainList.length === 0) {
            return []
        }
        const addrIds = new Set<number>();
        mainList.forEach(r=>{
            addrIds.add(r.fromId);
            addrIds.add(r.toId);
        })
        return [...addrIds]
    }
    const popRef = await Promise.all(
        MAIN_TRANSFER_MODELS.map(prepare)
    )
    async function popAction(mainModel , partitionModel, addrIdArr, dbTx) {
        // mainModel = Erc20Transfer;
        // partitionModel = AddressErc20Transfer;
        if (addrIdArr.length === 0) {
            return 'empty';
        }
        return Promise.all([
            mainModel.destroy({where: {epoch}, transaction:dbTx}).then((cnt)=>`M:${cnt}`),
            partitionModel.destroy({where: {addressId:{[Op.in]:addrIdArr}, epoch}, transaction:dbTx}).then((cnt)=>`P:${cnt}/${addrIdArr.length}`)
        ]);
    }
    return EpochHashTokenTransfer.sequelize.transaction(dbTx=>{
        return Promise.all([
            popAction(Erc20Transfer, AddressErc20Transfer, popRef[0], dbTx).then(res=>`t20 ${res}`),
            popAction(Erc721Transfer, AddressErc721Transfer, popRef[1], dbTx).then(res=>`t721 ${res}`),
            popAction(Erc1155Transfer, AddressErc1155Transfer, popRef[2], dbTx).then(res=>`t1155 ${res}`),
            EpochHashTokenTransfer.destroy({where: {epoch}, limit: 1, transaction: dbTx}).then((cnt)=>`PH ${cnt}`),
        ])
    }).then(res=>{
        console.log(` pop done. epoch ${epoch}, ${JSON.stringify(res)}`)
        return res;
    })
}

async function updateAllTokenTransferCount(lt = 100_000) {
    const list = await Token.findAll({
        where: {auditResult: true, transfer: {[Op.lt]: lt}},
        attributes: {exclude: ['icon']},
    })
    for (let i = 0; i < list.length; i++) {
        const token = list[i]
        process.stdout.write(`begin update ${token.name} :`)
        await updateTransferCountReal(token)
    }
    await Token.sequelize.close();
    process.exit(0)
}
let notifyError:Function
// noinspection DuplicatedCode
async function setup(cfxUrl:string) {
    const config = await init();
    if (process.argv.includes('updateAllTokenTransferCount')) {
        await updateAllTokenTransferCount()
        await Erc20Transfer.sequelize.close()
        return;
    }
    notifyError = async (msg, err)=>{
        return dingMsg(`[${config.serverTag}] TOKEN-X-SYNC ${msg}: ${err}`, config.dingTalkToken)
    }
    console.log(`--------------------`)

    const confluxOption = cfxUrl === 'useConfigRpc' ? (config.tokenTransferRpc || config.conflux) : {url: cfxUrl}
    let cfx = await initCfxSdk(confluxOption);
    console.log(` ${process.argv[1]} \n ------- network ${cfx.networkId} --------`)

    await makeUniformApprovalEpoch()
    return runTask(cfx)
}

let uniformApprovalEpoch = -1
async function makeUniformApprovalEpoch() {
    let n = await KV.getNumber(UNIFORM_APPROVAL_EPOCH, -1)
    if (n >= 0) {
        uniformApprovalEpoch = n;
        return
    }
    const [tokenTr, apprTask] = await Promise.all([
      EpochHashTokenTransfer.findOne({order:[['epoch', 'desc']]}),
      TaskEpochApproval.findOne({order:[['epoch', 'desc']]})
    ])
    if (!apprTask) {
        // approval sync has not been started
        uniformApprovalEpoch = FirstBlockNo
        return
    }
    const gap = 60;
    let laterEpoch = apprTask.cursor + gap;
    if (tokenTr?.epoch + gap > laterEpoch) {
        laterEpoch = tokenTr.epoch + gap
    }
    await KV.saveNumber(UNIFORM_APPROVAL_EPOCH, laterEpoch, undefined)
    uniformApprovalEpoch = laterEpoch;
    console.log(` make new uniformApprovalEpoch `, uniformApprovalEpoch)
}
// noinspection DuplicatedCode
async function runTask(cfx:Conflux) {
    const hashBean = await EpochHashTokenTransfer.findOne({order:[['epoch','desc']]});
	const preFinished = hashBean?.epoch || FirstBlockNo - 1;
    console.log(` start token transfer task, first epoch ${preFinished + 1}`)
	return run(cfx, preFinished)
}

if (module === require.main) {
    redirectLog()
    regExitHook()
    // fromEpoch:
    // -1 : use former unfinished task; exclude mode.
    // N  : use task N if it's not finished, fallback to *.
    // *  : auto create based on max task.
    const [, , cfxUrl] = process.argv
    setup(cfxUrl).then().catch(err => {
        console.log(`${process.argv[1]}\n`, err)
        process.exit(1)
    });
}
