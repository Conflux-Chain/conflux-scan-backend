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
    DatabaseError, QueryTypes,
} from "sequelize";
import {init} from "./service/tool/FixDailyTokenStat";
import {Conflux, format} from "js-conflux-sdk";
import {initCfxSdk} from "./service/common/utils";
import {Measure} from "./service/common/Measure";
import {TransactionReceipt} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {TokenTool} from "./service/tool/TokenTool";
import {
    aggregateTransfer,
    buildErc20Transfer,
    IErc20Transfer,
} from "./model/Erc20Transfer";
import {KV, UNIFORM_APPROVAL_EPOCH} from "./model/KV";
import {CheckPivotHashError, PreLoader} from "./service/common/PreLoader";
import {regExitHook, sleep} from "./service/tool/ProcessTool";
import {Token} from "./model/Token";
import {FullTransaction, loadMaxBlockEpoch} from "./model/FullBlock";
import {dingMsg} from "./monitor/Monitor";
import {EpochHashTokenTransfer, fetchTask, finishTask, waitParentHashDB} from "./TokenTransferSync";
import {buildHexSet, getAddrId, idHex40Map, makeIdV, mapProp} from "./model/HexMap";
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
// it was merged into token transfer sync.
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
        if(tokenType) {
            tokenType = tokenType.replace('CRC', 'ERC');
        }
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
        const total = await ApprovalRelation.sequelize.query(
            countSql,
            {replacements, raw: true, type: QueryTypes.SELECT,}
        ).then(([row])=>row["count"])

        let list:any[] = await ApprovalRelation.sequelize.query(
            sql, {replacements, raw: true, type: QueryTypes.SELECT}
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
            let {name, symbol, type, base32, decimals, iconUrl} = row;
            ['name', 'symbol', 'type', 'base32', 'decimals', 'iconUrl'].forEach(k=>delete row[k]);
            row['tokenInfo'] = {name, symbol, type, base32, decimals, iconUrl};
            row['spenderName'] = (contractNameMap[`${row.toId}`])?.name || '';
            ['id','epoch','contractId','blockIndex','txIndex','fromId', 'toId']
                .forEach(k=>delete row[k])
        });
        if(StatApp.isEVM) {
            list.forEach(row=>{
                row['spender'] = row['to'];
                if (row['tokenInfo']) {
                    row['tokenInfo']["hex"] = format.hexAddress(row['tokenInfo']["base32"]);
                    row['tokenInfo']["base32"] = row['tokenInfo']["base32"];
                }
            })
        } else{
            list.forEach(row=>{
                row["spender"] = format.address(row["to"], StatApp.networkId || 1029)
                row["contract"] = format.address(row["contract"], StatApp.networkId || 1029)
            })
        }
        return {total:Math.min(list.length, Number(total)), list};
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
export async function batchSaveApproval(mainModel,
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
export function buildRelation(list, arr) {
	list.forEach(t=>{
		t.updatedAt = t.createdAt
		arr.push(t)
	})
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
        console.log(`Approval-SYNC  pop done. epoch ${epoch}, ${JSON.stringify(res)}`)
        return res;
    })
}
async function setCheckPivot(task:IEpochApproval, cfx:Conflux, len:number) {
    const stateEpoch = await cfx.getEpochNumber('latest_state')
    const checkPivot = stateEpoch - task.epoch < len * 2 || FORCE_CHECK_PIVOT
    task.checkPivot = checkPivot;
}

async function test() {
    const [,,cmd,arg1, arg2] = process.argv;
    if (cmd === 'testQuery') {
        await init();
        const cfx = new Conflux({url: arg2})
        await ApprovalRelation.queryApprovalOfAccount({
            account: arg1, tokenType:'', byTokenId: false, cfx})
            .then(({list})=>{
                console.log(`Approval-SYNC total ${0}`, list)
            })
        process.exit();
    }
}
const FORCE_CHECK_PIVOT = Boolean(process.env.FORCE_CHECK_PIVOT)
if (module === require.main) {
    main().then()
}

// 721 1030 0xf31216bd4c532effff0a8c397d21c4f931e6c3b23620328693dd91f10d500245 epoch 5371609
// 20  1030 0x00a5164cc7b88758ad8d087387cc4015b07d073c4ff2b9abcafb934fca66ce53 epoch 62237
