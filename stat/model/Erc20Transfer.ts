import {QueryTypes, DataTypes, Model, Op, Sequelize} from "sequelize";
import {batchBuildId, Hex64Map, makeId} from "./HexMap";
import {Erc721Transfer} from "./Erc721Transfer";
import {Erc777Transfer} from "./Erc777Transfer";
import {Erc1155Transfer} from "./Erc1155Transfer";
import {createTable} from "../service/DBProvider";
import {ERC20_TRANSFER_Q, ERC777_TRANSFER_Q, RedisWrap} from "../service/RedisWrap";
import {StatApp} from "../StatApp";

export interface ITokenTransfer {
    createdAt: Date
}

export interface IErc20Transfer extends ITokenTransfer{
    id?: number
    epoch: number
    txHashId: number
    contractId: number
    fromId: number
    toId: number
    value: string
}

export interface IAddressErc20Transfer {
    addressId:number
    epoch: number
    tracePos: number
    txHashId: number
    createdAt: Date
    contractId: number
    fromId: number
    toId: number
    value: string
}
export const T_ADDRESS_ERC20TRANSFER = 'address_erc20_transfer'
const ADDRESS_ERC20TRANSFER_SQL = `
    CREATE table if not exists ${T_ADDRESS_ERC20TRANSFER} (
  \`addressId\` bigint unsigned NOT NULL,
  \`epoch\` bigint unsigned NOT NULL,
  \`tracePos\` int unsigned NOT NULL,
  \`contractId\` bigint unsigned NOT NULL,
  \`txHashId\` bigint unsigned NOT NULL,
  \`createdAt\` datetime NOT NULL,
  \`fromId\` bigint unsigned NOT NULL,
  \`toId\` bigint unsigned NOT NULL,
  \`value\` varchar(78) NOT NULL DEFAULT '0',
  PRIMARY KEY (\`addressId\`,\`epoch\`,\`tracePos\`),
  KEY \`idx_datetime\` (\`createdAt\`),
  KEY \`idx_epoch\` (\`epoch\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
partition by hash (addressId)
   PARTITIONS 97;
`

export async function createAddressErc20TransferTable(seq:Sequelize) {
    return createTable(seq, ADDRESS_ERC20TRANSFER_SQL).then(()=>{
        return AddressErc20Transfer.register(seq)
    }).then(()=>{
        AddressErc20Transfer.removeAttribute("id")
    }).catch(err=>{
        console.log(`createAddressErc20TransferTable fail, sql ${ADDRESS_ERC20TRANSFER_SQL}:`, err)
        process.exit(9)
    })
}
export function build20transferList2address(list:any[]) : IAddressErc20Transfer[] {
    const result : any[] = []
    let idx = 0
    list.forEach(row=>{
        result.push(buildAddress20transfer(row, row.fromId, idx))
        if (row.fromId !== row.toId) {
            result.push(buildAddress20transfer(row, row.toId, idx+1))
        }
        idx += 10
    })
    return result
}
function buildAddress20transfer(row:any, addrId:number, pos:number) : any {
    return {
        addressId: addrId,
        tracePos: pos,
        contractId: row.contractId, createdAt: row.createdAt, epoch: row.epoch, fromId: row.fromId,
        toId: row.toId, txHashId: row.txHashId, value: row.value,
        tokenId: row.tokenId,
    }
}
export class AddressErc20Transfer extends Model<IAddressErc20Transfer> implements IAddressErc20Transfer {
    addressId:number
    epoch: number
    tracePos: number //Need it to make primary key unique.
    createdAt: Date
    contractId: number
    txHashId: number
    fromId: number
    toId: number
    value: string
    static register(seq: Sequelize) {
        AddressErc20Transfer.init({
            addressId: {type: DataTypes.BIGINT, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            tracePos: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            txHashId: {type: DataTypes.BIGINT, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.STRING(78), allowNull: false},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ADDRESS_ERC20TRANSFER,
            indexes: [
                {
                    name: 'idx_epoch',
                    fields: [{name: 'epoch', order: "DESC"}]
                },
                {
                    name: 'idx_datetime',
                    fields: [{name: 'createdAt', order: "DESC"}]
                },
            ],
        })
    }
}

export const T_ERC20_TRANSFER = "erc20transfer"

export class Erc20Transfer extends Model<IErc20Transfer> implements IErc20Transfer {
    id?: number
    epoch: number
    createdAt: Date
    contractId: number
    txHashId: number
    fromId: number
    toId: number
    value: string
    static register(seq: Sequelize) {
        Erc20Transfer.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            txHashId: {type: DataTypes.BIGINT, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.STRING(78), allowNull: false},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ERC20_TRANSFER,
            indexes: [
                {
                    name: 'idx_contract_id',
                    fields: ['contractId']
                },
                {
                    name: 'idx_epoch',
                    fields: [{name: 'epoch', order: "DESC"}]
                },
                {
                    name: 'idx_datetime',
                    fields: [{name: 'createdAt', order: "DESC"}]
                },
            ],
        })
    }
}

export async function buildErc20Transfer(obj, date) {
    const [fromId, toId, contractId] = await Promise.all([
        makeId(obj.from, undefined, {dt:date}),
        makeId(obj.to, undefined, {dt:date}),
        makeId(obj.address, undefined, {dt:date}),
        // makeId(obj.transactionHash)
    ])
    if (obj.tokenId !== null && obj.tokenId !== undefined && obj.value === undefined) {
        obj.value = 1
    }
    let erc20Transfer:IErc20Transfer = {
        txHashId: obj.txHashId, //hashID.id,
        contractId: contractId.id,
        fromId: fromId.id,
        toId: toId.id,
        value: (obj.value || 0).toString(),
        createdAt: date,
        epoch: obj.epochNumber,
    };
    return erc20Transfer
}
let logTimes = 10;
export async function batchSaveErc20Transfer(array: any[], seconds) {
    if (!array.length) {
        return;
    }
    let templates = []
    let date = new Date(Number(seconds)*1000)
    let skipCount = 0;
    for (const obj of array) {
        const bean = await buildErc20Transfer(obj, date);
        // 13870862 pos points
        if (bean.contractId === 13870862 && StatApp.networkId === 1029) {
            skipCount ++
            continue;
        }
        templates.push(bean);
    }
    if (logTimes > 0 && skipCount > 0) {
        logTimes --;
        console.log(` skip points contract, count ${skipCount}`)
    }
    if (!templates.length) {
        return;
    }
    // console.log(`---- ${templates.map(o=>o.epoch1).join(",")}`)
    return Promise.all([
        Erc20Transfer.bulkCreate(templates, {
            // benchmark: true, logging:console.log,
        }),
        RedisWrap.sendStreamMessage(templates, ERC20_TRANSFER_Q)
    ]);
}

export async function batchPopErc20Transfer(epoch) {
    return RedisWrap.sendStreamMessage({action:'pop', epoch}, ERC20_TRANSFER_Q)
    // return popPartition(epoch , Erc20Transfer, AddressErc20Transfer)
}

export const T_DAILY_TOKEN_TXN = 'daily_token_txn'
export interface IDailyTokenTxn {
    id?:number
    txnCount:number
    userCount:number
    day:Date
    type: string // erc20 erc721 erc777 erc1155
}
export class DailyTokenTxn extends Model<IDailyTokenTxn> implements IDailyTokenTxn{
    id?:number
    txnCount:number
    userCount:number
    day:Date
    type: string
    static register(seq){
        DailyTokenTxn.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            txnCount: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            userCount: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            day: {type: DataTypes.DATEONLY, allowNull: false},
            type: {type: DataTypes.STRING(8), allowNull: false},
        },{
            tableName: T_DAILY_TOKEN_TXN,
            sequelize: seq,
            indexes:[
                {name: 'idx_day_type', unique:true, fields: [{name: 'day', order: "DESC"},{name: 'type'}]}
            ]
        })
    }
}
export async function calcAllTokenUniqueUser(start:Date, end:Date) : Promise<number> {
    const sqlInner = [Erc20Transfer, Erc721Transfer, Erc777Transfer, Erc1155Transfer].map(
        token=>`select fromId from ${token.getTableName()} where createdAt between ? and ?
            union select toId from ${token.getTableName()} where createdAt between ? and ?`
    ).join(' union ');
    const replace = [
        start, end, start, end,
        start, end, start, end,
        start, end, start, end,
        start, end, start, end,
    ]
    const sql = `select count(*) as cnt from (
        ${sqlInner}
    ) t`
    return Erc20Transfer.sequelize.query(sql,
        {type:QueryTypes.SELECT, replacements: replace,
        // logging: console.log, benchmark: true
        }
    ).then(arr=>{
        return Number(arr[0]['cnt'])
    })
}
export async function rollupDailyTokenTxn(dt:Date, model: any/*Model*/, type:string) {
    dt.setHours(0,0,0,0)
    let end = new Date(dt)
    end.setHours(23,59,59,999)
    if (type === TOKEN_TYPE_ALL_4) {
        const userCount = await calcAllTokenUniqueUser(dt, end)
        return DailyTokenTxn.upsert({
            txnCount: 0, day: dt, type: type.toUpperCase(), userCount,
        })
    }
    let count = await model.count({        where:{
            createdAt: {[Op.between]:[dt, end]}
        }    })
    return DailyTokenTxn.upsert({
        txnCount: count, day: dt, type: type.toUpperCase(), userCount: 0
    })
}
export const TOKEN_TYPE_ALL_4 = '_ALL_4'
export async function rollupDailyTokenTxnCurrentAll() {
    await rollupDailyTokenTxnCurrent(Erc20Transfer, 'erc20')
    await rollupDailyTokenTxnCurrent(Erc721Transfer, 'erc721')
    await rollupDailyTokenTxnCurrent(Erc777Transfer, 'erc777')
    await rollupDailyTokenTxnCurrent(Erc1155Transfer, 'erc1155')
    // all four token unique user.
    await rollupDailyTokenTxnCurrent(undefined, TOKEN_TYPE_ALL_4)
}
export async function rollupDailyTokenTxnCurrent(model, type) {
    const cur = new Date()
    if (cur.getHours() === 0 && cur.getMinutes() < 30) {
        // rollup previous day, time point is an hour ago, calculated time span should be previous day.
        await rollupDailyTokenTxn(new Date(cur.getTime() - 1000*3600), model, type)
    }
    await rollupDailyTokenTxn(cur, model, type);
}

export async function scheduleRollupDailyTokenTxn() {
    await rollupDailyTokenTxnCurrentAll()
    setTimeout(scheduleRollupDailyTokenTxn, 1000*60*10)// ten minutes
}
