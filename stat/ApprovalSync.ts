import {redirectLog} from "./config/LoggerConfig";
import {
    getTokenTool,
    IEpochTask,
} from "./service/UniqueAddressStat";
import {
    Transaction,
    Model,
    DataTypes,
    Sequelize,
    Op,
    UniqueConstraintError,
    ModelStatic,
    DatabaseError, QueryTypes,
} from "sequelize";
import {init} from "./service/tool/FixDailyTokenStat";
import {Conflux, format} from "js-conflux-sdk";
import {patchHttpProvider} from "./service/common/utils";
import {Measure} from "./service/common/Measure";
import {TransactionReceipt} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {TokenTool} from "./service/tool/TokenTool";
import {
    AddressErc20Transfer,
    aggregateTransfer,
    buildErc20Transfer, buildTransferList2address, ContractUser,
    Erc20Transfer, IErc20Transfer, T_ERC20_TRANSFER,
} from "./model/Erc20Transfer";
import {AddressErc721Transfer, buildErc721Transfer, Erc721Transfer} from "./model/Erc721Transfer";
import {AddressErc1155Transfer, Erc1155Transfer} from "./model/Erc1155Transfer";
import {KV} from "./model/KV";
import {CheckPivotHashError, PreLoader} from "./service/common/PreLoader";
import {regExitHook, sleep} from "./service/tool/ProcessTool";
import {NftMint, Token} from "./model/Token";
import {PruneNotifier} from "./service/prune/PruneNotifier";
import {PruneType} from "./model/PruneInfo";
import {RedisWrap} from "./service/RedisWrap";
import {FullBlock, FullTransaction} from "./model/FullBlock";
import {updateTransferCountReal} from "./StreamSync";
import {dingMsg} from "./monitor/Monitor";
import {EpochHashTokenTransfer, fetchTask, finishTask, joinTask, waitParentHashDB} from "./TokenTransferSync";
import {buildHexSet, buildIdMap, getAddrId, idHex40Map, makeIdV, mapProp} from "./model/HexMap";
import {StatApp} from "./StatApp";
import {ContractInfo} from "./model/ContractInfo";
import {CONST} from "./service/common/constant";
import {TokenBalance} from "./model/Balance";
import {patchApprovalList} from "./service/tool/ApprovalTool";
//
export interface ITokenApproval extends IErc20Transfer {
    type: string // Approval or ApprovalForAll
}
// main table
export class TokenApproval extends Model<ITokenApproval> implements ITokenApproval {
    id?: number
    epoch: number
    createdAt: Date
    contractId: number
    blockIndex: number
    txIndex: number
    txLogIndex: number
    fromId: number
    toId: number
    // for erc20, it's amount; for erc721 and erc1155 with `ApproveForAll`, it's (1/0)
    // for erc721 with `Approval`, it's token id.
    value: string
    type: string // Approval or ApprovalForAll
    static register(seq: Sequelize) {
        TokenApproval.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            blockIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txIndex: {type: DataTypes.INTEGER, allowNull: false},
            txLogIndex: {type: DataTypes.INTEGER, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.STRING(78), allowNull: false},
            type: {type: DataTypes.STRING('ApprovalForAll'.length), allowNull: false},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: 'token_approval',
            indexes: [
               {
                    name: 'idx_epoch',
                    fields: [{name: 'epoch', order: "DESC"}]
                },
                // query by from, with type , contract, value,
                // that is , approval issues from, contract, token id
                {name: 'idx_from', fields: ['fromId','type',
                        'contractId','value','epoch','id']}
            ],
        })
    }
}
// unique relation between owner and spender on contract
export interface IApprovalRelation {
    id?:number
    epoch: number
    contractId: number
    blockIndex: number
    txIndex: number
    fromId: number
    toId: number
    value:string
    type: string // Approval or ApprovalForAll
    updatedAt:Date
}
export class ApprovalRelation extends Model<IApprovalRelation> implements ApprovalRelation {
    id?:number
    epoch: number
    contractId: number
    blockIndex: number
    txIndex: number
    fromId: number
    toId: number
    // for erc20, it's amount; for erc721 and erc1155 with `ApproveForAll`, it's (1/0)
    // for erc721 with `Approval`, it's token id.
    value:string
    type: string // Approval or ApprovalForAll
    updatedAt:Date
    static register(seq: Sequelize) {
        ApprovalRelation.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            blockIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txIndex: {type: DataTypes.INTEGER, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.STRING(78), allowNull: false},
            type: {type: DataTypes.STRING('ApprovalForAll'.length), allowNull: false},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: 'approval_relation',
            indexes: [
                {
                    name: 'idx_',
                    fields: [
                        {name: 'fromId',}, // query by owner
                        {name: 'toId',},
                        {name: 'contractId',},
                        {name: 'type',},
                        ], unique: true,
                },
            ],
        })
    }
    static context = {
        zeroAddrId: 0, initialized: false,
    }
    static async queryApprovalOfAccount({account, tokenType = '', byTokenId, cfx}) {
        if (!ApprovalRelation.context.initialized) {
            ApprovalRelation.context.zeroAddrId =
                await makeIdV(CONST.ZERO_ADDRESS)
            ApprovalRelation.context.initialized = true;
        }
        const id = await getAddrId(account);
        if (!id) {
            return {total: 0, list:[], message: 'account not found'};
        }
        return this.queryApprovalOfAccountId({account, fromId: id, tokenType, byTokenId, cfx});
    }
    static async queryApprovalOfAccountId({account, fromId, tokenType, byTokenId, cfx}) {
        let relation = ApprovalRelation.getTableName();
        const token = Token.getTableName();
        const tx = FullTransaction.getTableName();
        const replacements = []
        if (byTokenId && tokenType === 'ERC721') {
            const approvalT = TokenApproval.getTableName();
            const value = '`value`';
            relation = ` (
              select dt.*, dt.createdAt as updatedAt from ${approvalT} dt join (  
                select max(id) as id, contractId, ${value}  from ${approvalT} ap
                where ap.fromId=? and ap.type='Approval'
                group by contractId, ${value}
              ) maxId on maxId.id = dt.id
            ) 
            `
            replacements.push(fromId);
        }
        const tokeTypeCondition = tokenType ? "and t.type=?" : "";
        const zeroId = ApprovalRelation.context.zeroAddrId;
        const sql = `
            select tx.hash, r.updatedAt, r.contractId, r.toId, r.value, r.type approvalType, ifnull(tkb.balance,"0") as balance,
            t.name, t.symbol, t.iconUrl, t.type, t.decimals, t.base32
            from ${relation} r 
            join ${token} t on r.contractId=t.hex40id ${tokeTypeCondition}
            left join ${tx} tx on r.epoch = tx.epoch and r.blockIndex = tx.blockPosition and r.txIndex = tx.txPosition
            left join ${TokenBalance.getTableName()} tkb on tkb.contractId=r.contractId and tkb.addressId = r.fromId
            where r.fromId = ? and r.toId <> ${zeroId} order by r.epoch desc limit 10000
        `;
        if (tokeTypeCondition) {
            replacements.push(tokenType);
        }
        replacements.push(fromId);
        let countSql = `select count(*) as count ${sql.substr(sql.indexOf('from '))}`;
        console.log(`count sql is `, countSql)
        const total = await ApprovalRelation.sequelize.query(
            countSql,
            {replacements, raw: true, type: QueryTypes.SELECT,}
        ).then(([row])=>row["count"])

        let list:any[] = await ApprovalRelation.sequelize.query(
            sql, {replacements, raw: true, type: QueryTypes.SELECT,
                logging: console.log,
            }
        )
        // const {rows:list, count:total} = await ApprovalRelation.findAndCountAll({
        //     raw:true, where: {fromId}})
        const ids = buildHexSet(null, list, 'toId', 'contractId')
        const hexMap = await idHex40Map([...ids], true)
        mapProp(hexMap, list, 'toId', 'to')
        mapProp(hexMap, list, 'contractId', 'contract')
        const contractNameMap = await ContractInfo.findAll({
            attributes:['hexId','name'], raw: true,
            where: {hexId:{[Op.in]:list.map(row=>row.toId)}}
        }).then(infos=>{
            const map = {}
            infos.forEach(i=>map[`${i.hexId}`] = i)
            return map;
        })
        list = await patchApprovalList({account, list, cfx})
        list.forEach(row=>{
            const {name, symbol, type, base32, decimals, iconUrl} = row;
            ['name', 'symbol', 'type', 'base32', 'decimals', 'iconUrl'].forEach(k=>delete row[k]);
            row['tokenInfo'] = {name, symbol, type, base32, decimals, iconUrl};
            row['spenderName'] = (contractNameMap[`${row.toId}`])?.name || '';
            ['id','epoch','contractId','blockIndex','txIndex','fromId', 'toId']
                .forEach(k=>delete row[k])
        });
        if(StatApp.isEVM) {
            list.forEach(row=>{
                row["spender"] = format.address(row["to"], StatApp.networkId || 1029)
                delete row['to'];
                if (row['tokenInfo']) {
                    row['tokenInfo']["base32"] = format.address(row['tokenInfo']["base32"], StatApp.networkId || 1029)
                }
            })
        } else{
            list.forEach(row=>{
                row["spender"] = format.address(row["to"], StatApp.networkId || 1029)
                delete row['to'];
                row["contract"] = format.address(row["contract"], StatApp.networkId || 1029)
            })
        }
        return {total, list};
    }
}
export interface IEpochApproval extends IEpochTask {
    cursor:number
    checkPivot?: boolean
}
export class TaskEpochApproval extends Model<IEpochApproval> implements IEpochApproval{
    epoch: number
    range: number
    createdAt: Date
    updatedAt: Date
    finished: boolean

    cursor: number;
    static register(seq: Sequelize) {
        TaskEpochApproval.init({
            epoch: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true},
            cursor: {type: DataTypes.BIGINT, allowNull: false},
            range: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
            finished: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
        },{
            sequelize: seq, tableName: 'task_approval',
        })
    }
}

function decodeApprovalFromReceipts(receipts2d:TransactionReceipt[][],tokenTool: TokenTool,
                                    dt:Date, blockHashes:string[]) {
    const result = {approvals:[]}
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
            if (txReceipt.blockHash !== blockHashes[blockIdx]) {
                throw new Error(`tx receipt has mismatch block hash, epoch ${txReceipt.epochNumber
                }, ${txReceipt.blockHash
                } vs block hashes ${blockHashes[blockIdx]}`)
            }
            let txLogIndex = -1;
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
                if ((transfer = tokenTool.decode721_1155_ApprovalForAll(log, false))) {
                    push(result.approvals, transfer, blockIdx, txReceipt, txLogIndex, txPos)
                } else if ((transfer = tokenTool.decodeERC721_ERC20Approval(log, false))) {
                    push(result.approvals, transfer, blockIdx, txReceipt, txLogIndex, txPos);
                }
            }
        }
    }
    return result;
}
async function batchSaveApproval(mainModel,
                                 // addrModel,
                                 arr,
                                 // dataForAddr,
                                 dbTx) {
    return Promise.all([
        mainModel.bulkCreate(arr, {transaction: dbTx}),
        // addrModel.bulkCreate(dataForAddr, {transaction: dbTx}),
    ])
}

const measure = new Measure()
const dumpPerRound = parseInt(process.env.ROUND || '1000')
async function run(cfx:Conflux, task:IEpochApproval, endFn:()=>void) {
    const fromEpoch = task.cursor+1;
    const stopBeforeEpoch = task.epoch + task.range
    const taskBegin = task.epoch;
    const {tokenTool} = getTokenTool(cfx)
    // parentHash, also indicates whether checking parent hash.
    let parentHash = await waitParentHashDB(task, task.cursor, EpochHashTokenTransfer) // reuse token transfer's epoch hash
    async function buildApproval(arr:any[], fn, dt) {
        const contractIds = new Set<number>()
        const addrIds = new Set<number>()
        for (let e of arr) {
            await fn(e, dt)
            contractIds.add(e.contractId)
            addrIds.add(e.fromId)
            addrIds.add(e.toId)
        }
        return {contractIds: [...contractIds], addrIds: [...addrIds]}
    }
    function buildRelation(list, arr) {
        list.forEach(t=>{
            t.updatedAt = t.createdAt
            arr.push(t)
        })
    }
    async function fetchAndBuild(epoch: number) {
        const [receipts, blockHashes, block] = await Promise.all([
            cfx.getEpochReceipts(epoch).then(res=>{
                if (res === null && epoch === 0) {
                    res = []
                }
                return res as TransactionReceipt[][];
            }),
            cfx.getBlocksByEpochNumber(epoch),
            cfx.getBlockByEpochNumber(epoch),
        ])
        const pivotHash = block.hash;
        if (pivotHash !== blockHashes[blockHashes.length - 1]) {
            throw new CheckPivotHashError(` epoch ${epoch}, block hash mismatch at epoch ${epoch
            }, from pivot block ${pivotHash}, from block hashes ${blockHashes[blockHashes.length - 1]}`)
        }
        // simulatePivotSwitch(epoch, 3)
        const dt = new Date(block.timestamp * 1000);
        let {approvals} = decodeApprovalFromReceipts(receipts, tokenTool, dt, blockHashes);
        approvals = aggregateTransfer(approvals, true)
        // after all id is cached, it's almost cpu computation.
        const ids20 = await buildApproval(approvals, buildErc20Transfer, dt);
        const relations = []
        buildRelation(approvals, relations)
        // build data out of transaction, reduce tx time.
        // const [a20addr] = [approvals].map(buildTransferList2address)
        return {approvals, relations, ids20, dt, pivotHash, parentHash: block.parentHash}
    }
    const fetchAndBuildTag = 'fetchAndBuild';
    async function processData(epoch, finalData) {
        try {
            await measure.call('save', () => save(epoch, finalData as any, taskBegin))
        } catch (e) {
            console.log(` processData catch it, epoch ${epoch}, ${e.message}`)
            return Promise.reject(e)
        }
        if (parentHash) { // checking mode.
            parentHash = finalData['pivotHash'];
        }
        return finalData;
    }
    let epoch = fromEpoch;
    async function localPop(ep) {
        /**
         epoch    : current epoch should be processed, but failed because pivot switch,
         epoch - 1: previous/parent epoch, with pivot hash != (parentHash of current epoch), pop it.
         epoch - 2: after (epoch - 1) is popped, it will be the top element on the stack. use its pivot
                    hash as 'parentHash'.
         */
        console.log(` local pop ${ep}`)
        await pop(ep, taskBegin)
        epoch = ep
        console.log(` set cursor to ${epoch}`)
        parentHash = await waitParentHashDB(task, ep - 1, EpochHashTokenTransfer)
        console.log(` local pop ${ep} end -`)
        return ep
    }
    const loader = new PreLoader(cfx, fetchAndBuild, 3, stopBeforeEpoch);
    loader.preLoadSize = 10;
    // should not higher than block/tx sync, otherwise the transaction hash may not be found.
    let maxEpochOfBlock = 0;
    async function updateMaxDbEpoch() {
        const maxE = await FullBlock.max('epoch')
        if (typeof maxE !== 'number') {
            console.log(` FullTransaction is empty. ${new Date().toISOString()}`)
            return;
        }
        maxEpochOfBlock = maxE;
        console.log(` update max epoch of block to ${maxE} `)
    }
    await updateMaxDbEpoch()
    let firstWait = true
    async function repeat() {
        return repeat0().catch(err=>{
            console.log(` repeat error : `, err)
        })
    }
    async function repeat0() {
        if (epoch>maxEpochOfBlock) {
            await updateMaxDbEpoch();
            setTimeout(repeat, 5_000)
            return;
        }
        let {action, data} = await measure.call('epoch', ()=>loader.get(epoch));
        let delay = 0
        switch (action) {
            case "ok":
                try {
                    if (data instanceof CheckPivotHashError) {
                        console.log(` checking pivot hash error, ${data.message}`);
                        await  localPop(epoch - 1)
                        delay = 10_000
                        break;
                    } else if (parentHash && data.parentHash !== parentHash) {
                        console.log(` before save check, parent hash not match, on hand epoch ${epoch
                        } with PH ${data.parentHash} != ${parentHash} (parent)`)
                        await  localPop(epoch - 1)
                        delay = 10_000
                        break;
                    } else if (data instanceof Error) {
                        console.log(` error at epoch ${epoch}`, data)
                        delay = 10_000;
                        break;
                    }
                    await processData(epoch, data);
                    if (epoch % dumpPerRound === 0) {
                        console.log(` sync transfer sample log, at epoch ${epoch}`);
                        measure.dump(` ------ sync transfer metrics: `, 1, 'epoch', fetchAndBuildTag, 'save');
                    }
                    epoch ++
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
                    const failMsg = `process epoch fail at ${epoch}, task start epoch ${taskBegin}, `;
                    console.log(failMsg, e)
                    await notifyError(failMsg, e);
                    process.exit(1)
                }
                break;
            case "wait":
                if (firstWait) {
                    firstWait = false
                }else {
                    delay = 5_000;
                }
                break;
            case "pop":
                break;
        }
        if (epoch < stopBeforeEpoch) {
            setTimeout(repeat, delay)
        } else {
            await finishTask(taskBegin, TaskEpochApproval);
            endFn()
        }
    }
    repeat().then()
}

async function save(epoch:number, {pivotHash, approvals, relations}, taskBegin:number) {
    return KV.sequelize.transaction(dbTx=>{
        return Promise.all([
            batchSaveApproval(TokenApproval, approvals, dbTx),
            ApprovalRelation.bulkCreate(relations, {transaction: dbTx,
                updateOnDuplicate:["updatedAt","epoch","blockIndex","txIndex", "value"],
            }),
            TaskEpochApproval.update(
                {cursor: epoch, },
                {where:{epoch:taskBegin}, transaction:dbTx})
                // .then(res=>{
                //     console.log(` update cursor, epoch ${epoch} result `, res)
                // })
        ])
    })
}
const MAIN_MODELS = [TokenApproval]
async function pop(epoch:number, taskBegin: number) {
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
        MAIN_MODELS.map(prepare)
    )
    async function popAction(mainModel, addrIdArr, dbTx) {
        if (addrIdArr.length === 0) {
            return 'empty';
        }
        return Promise.all([
            mainModel.destroy({where: {epoch}, transaction:dbTx}).then((cnt)=>`M:${cnt}`),
        ]);
    }
    async function popTaskCursor(dbTx: Transaction) {
        // cursor could less than the start epoch of this task. doesn't matter.
        // there should be only one task under execution.
        return TaskEpochApproval.update({cursor: epoch - 1},
            {where: {epoch: taskBegin}, limit: 1, transaction:dbTx}
            )
    }
    return TaskEpochApproval.sequelize.transaction(dbTx=>{
        return Promise.all([
            popAction(TokenApproval, popRef[0], dbTx).then(res=>`approvals ${res}`),
            popTaskCursor(dbTx).then((cnt)=>`CURSOR ${cnt}`),
        ])
    }).then(res=>{
        console.log(` pop done. epoch ${epoch}, ${JSON.stringify(res)}`)
        return res;
    })
}
async function setCheckPivot(task:IEpochApproval, cfx:Conflux, len:number) {
    const stateEpoch = await cfx.getEpochNumber('latest_state')
    const checkPivot = stateEpoch - task.epoch < len * 2 || FORCE_CHECK_PIVOT
    task.checkPivot = checkPivot;
}

let notifyError:Function
// noinspection DuplicatedCode
async function setup(cfxUrl:string, fromEpoch = '30495000', taskLen = '3000') {
    const config = await init();
    notifyError = async (msg, err)=>{
        return dingMsg(`[${config.serverTag}] Approval-SYNC ${msg}: ${err}`, config.dingTalkToken)
    }
    console.log(`--------------------`)

    const cfxOp = cfxUrl === 'useConfigRpc' ? (config.tokenTransferRpc || config.conflux) : {url: cfxUrl}
    let cfx = new Conflux(cfxOp)
    patchHttpProvider(cfx, cfxOp)
    const st = await cfx.getStatus()
    console.log(` ${process.argv[1]} \n ------- network ${st.networkId} ${cfxOp.url} --------`)
    return runTask(cfx, parseInt(fromEpoch), parseInt(taskLen))
}
// noinspection DuplicatedCode
async function runTask(cfx:Conflux, fromEpoch:number = 0, len) {
    const task = await fetchTask(len, fromEpoch, cfx, TaskEpochApproval)
    console.log(` start approval task, [${task.epoch}, ${task.range+task.epoch}), len ${task.range
    }, cursor/first epoch ${task.cursor + 1}`)
    if (fromEpoch === -1) {
        // -1 means 'continue unfinished task',
        // switch to normal(support multiple) after the first task is picked up.
        fromEpoch = 1
    }
    await new Promise(r=>{
        run(cfx, task, ()=>{
            r(0)
        })
    })
    if (len === 0) {
        console.log(`length parameter is zero, quit.`)
        process.exit(0)
    } else {
        setTimeout(() => runTask(cfx, fromEpoch, len), 0)
    }
}
async function test() {
    const [,,cmd,arg1, arg2] = process.argv;
    if (cmd === 'testQuery') {
        await init();
        const cfx = new Conflux({url: arg2})
        await ApprovalRelation.queryApprovalOfAccount({
            account: arg1, tokenType:'', byTokenId: false, cfx})
            .then(({list})=>{
                console.log(`total ${0}`, list)
            })
        process.exit();
    }
}
const FORCE_CHECK_PIVOT = Boolean(process.env.FORCE_CHECK_PIVOT)
if (module === require.main) {
    main().then()
}
async function main() {
    await test()
    redirectLog()
    regExitHook()
    // cfxUrl: useConfigRpc
    // fromEpoch:
    // -1 : use former unfinished task; exclude mode.
    // N  : use task N if it's not finished, fallback to *.
    // *  : auto create based on max task.
    const [, , cfxUrl, fromEpoch, taskLen] = process.argv
    setup(cfxUrl, fromEpoch, taskLen).then().catch(err => {
        console.log(`${process.argv[1]}\n`, err)
        process.exit(1)
    });
}
// 721 1030 0xf31216bd4c532effff0a8c397d21c4f931e6c3b23620328693dd91f10d500245 epoch 5371609
// 20  1030 0x00a5164cc7b88758ad8d087387cc4015b07d073c4ff2b9abcafb934fca66ce53 epoch 62237