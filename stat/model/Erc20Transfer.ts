import {QueryTypes, DataTypes, Model, Op, Sequelize} from "sequelize";
import {makeIdV} from "./HexMap";
import {Erc721Transfer} from "./Erc721Transfer";
import {Erc1155Transfer} from "./Erc1155Transfer";
import {createTable} from "../service/DBProvider";
import {Epoch} from "./Epoch";
import {sqlLogFn} from "./Utils";
export interface IContractUser {
    id?: number
    contractId: number
    fromId: number
    toId: number
    epoch: number
}
// alter table contract_user add column epoch bigint unsigned not null default 0;
// used to update total supply and holder. records is deleted after processing.
export class ContractUser extends Model<IContractUser> implements IContractUser {
    id:number
    contractId: number
    fromId: number
    toId: number
    epoch: number
    static register(seq:Sequelize) {
        ContractUser.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), autoIncrement: true, primaryKey: true},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
        }, {
            sequelize: seq, tableName: 'contract_user',
            timestamps: false,
        })
    }
}
export interface ITokenTransfer {
    createdAt: Date
    blockIndex: number;
    txIndex: number;
    txLogIndex: number
    epoch: number
    contractId: number
    fromId: number
    toId: number
}

export interface IErc20Transfer extends ITokenTransfer{
    id?: number
    value: string
}

export interface IAddressErc20Transfer extends ITokenTransfer{
    addressId:number
    value: string
}
export const T_ADDRESS_ERC20TRANSFER = 'address_erc20transfer_3'
const ADDRESS_ERC20TRANSFER_SQL = `
    CREATE table if not exists ${T_ADDRESS_ERC20TRANSFER} (
  \`addressId\` bigint unsigned NOT NULL,
  \`epoch\` bigint unsigned NOT NULL,
  \`contractId\` bigint unsigned NOT NULL,
  \`blockIndex\` int unsigned NOT NULL,
  \`txIndex\` mediumint unsigned NOT NULL,
  \`txLogIndex\` mediumint unsigned NOT NULL,
  \`createdAt\` datetime NOT NULL,
  \`fromId\` bigint unsigned NOT NULL,
  \`toId\` bigint unsigned NOT NULL,
  \`value\` varchar(78) NOT NULL DEFAULT '0',
  PRIMARY KEY (\`addressId\`,\`epoch\`,\`blockIndex\` desc, txIndex desc, txLogIndex desc),
    KEY idx_addr_epoch ( addressId, epoch desc)
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
export function buildTransferList2address(list:any[]) : any[] {
    const result : any[] = []
    list.forEach(row=>{
        // fromId 1 is zero address
        // see createZeroAddress()
        if (row.fromId != 1){
            result.push({...row, addressId: row.fromId})
        }
        if (row.fromId !== row.toId) {
            result.push({...row, addressId: row.toId})
        }
    })
    return result
}

export class AddressErc20Transfer extends Model<IAddressErc20Transfer> implements IAddressErc20Transfer {
    addressId:number
    epoch: number
    createdAt: Date
    contractId: number
    blockIndex: number
    txIndex: number
    txLogIndex: number
    fromId: number
    toId: number
    value: string
    static register(seq: Sequelize) {
        AddressErc20Transfer.init({
            addressId: {type: DataTypes.BIGINT, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            blockIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txIndex: {type: DataTypes.INTEGER, allowNull: false},
            txLogIndex: {type: DataTypes.INTEGER, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.STRING(78), allowNull: false},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ADDRESS_ERC20TRANSFER,
            indexes: [
            ],
        })
    }
}

export const T_ERC20_TRANSFER = "erc20transfer_3"

export class Erc20Transfer extends Model<IErc20Transfer> implements IErc20Transfer {
    id?: number
    epoch: number
    createdAt: Date
    contractId: number
    blockIndex: number
    txIndex: number
    txLogIndex: number
    fromId: number
    toId: number
    value: string
    static register(seq: Sequelize) {
        Erc20Transfer.init({
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
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ERC20_TRANSFER,
            indexes: [
                {
                    name: 'idx_contractId_epoch',
                    fields: ['contractId','epoch']
                },
                {
                    name: 'idx_epoch',
                    fields: [{name: 'epoch', order: "DESC"}]
                },
            ],
        })
    }
}

export async function buildErc20Transfer(obj, date) {
    const [fromId, toId, contractId] = await Promise.all([
        makeIdV(obj.from, undefined, {dt:date}),
        makeIdV(obj.to, undefined, {dt:date}),
        makeIdV(obj.address, undefined, {dt:date}),
    ])
    obj['txIndex'] = obj.transactionIndex;
    obj['contractId'] = contractId
    obj['fromId'] = fromId
    obj['toId'] = toId
    obj.value = obj.value.toString()
    obj.txLogIndex = obj.transactionLogIndex;
    // let erc20Transfer:IErc20Transfer = {
    //     blockIndex: obj.blockIndex, //
    //     txIndex: obj.transactionIndex,
    //     contractId: contractId,
    //     fromId: fromId,
    //     toId: toId,
    //     value: (obj.value || 0).toString(),
    //     createdAt: date,
    //     epoch: obj.epochNumber,
    //     txLogIndex: obj.transactionLogIndex,
    // };
    // return erc20Transfer
}
export function aggregateTransfer(array: any[], overwrite = false) {
    if (!array.length) {
        return []
    }
    const keyArr = []
    const map = new Map<string, any>();
    const transStr = typeof array[0].value === 'string'
    for (const obj of array) {
        if (transStr) {
            obj.value = BigInt(obj.value)
        }
        const key = `${obj.transactionHash || obj.transactionIndex}_${obj.address}_${obj.from}_${obj.to}`
        let pre = map.get(key);
        if (!pre) {
            pre = obj;
            map.set(key, pre)
            keyArr.push(key)
            continue
        }
        if (overwrite) {
            pre.value = obj.value;
        } else {
            pre.value += obj.value;
        }
    }
    const result = []
    keyArr.forEach(k=>{
        const agg = map.get(k);
        if (agg.value) {
            // only reserve record with value > 0
            if (transStr) {
                agg.value = agg.value.toString();
            }
            result.push(agg)
        }
    })
    return result;
}


// stat over the chain.
export const T_DAILY_TOKEN_TXN = 'daily_token_txn'
export interface IDailyTokenTxn {
    id?:number
    txnCount:number
    userCount:number
    day:Date
    type: string // erc20 erc721 erc777 erc1155
    createdAt: Date
}
export class DailyTokenTxn extends Model<IDailyTokenTxn> implements IDailyTokenTxn{
    id?:number
    txnCount:number
    userCount:number
    day:Date
    type: string
    createdAt: Date
    static register(seq){
        DailyTokenTxn.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            txnCount: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            userCount: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            day: {type: DataTypes.DATEONLY, allowNull: false},
            type: {type: DataTypes.STRING(8), allowNull: false},
            createdAt: {type: DataTypes.DATE},
        },{
            tableName: T_DAILY_TOKEN_TXN,
            sequelize: seq,
            indexes:[
                {name: 'idx_day_type', unique:true, fields: [{name: 'day', order: "DESC"},{name: 'type'}]}
            ]
        })
    }
}
export async function calcAllTokenUniqueUser(startT:Date, endT:Date) : Promise<[number, number]> {
    const [start, end] = await Promise.all([startT, endT].map(t=>{
        return Epoch.findOne({where: {timestamp:{[Op.lte]:t}}, order:[['timestamp','desc']]}).then(res=>res?.epoch ?? 0);
    }));
    if (start == 0 || end == 0) {
        return [0, 0];
    }
    const transferCount = await Promise.all([Erc20Transfer, Erc721Transfer, Erc1155Transfer].map(t=>{
        // @ts-ignore
        return t.count(
          {where: {epoch: {[Op.between]: [start, end]}}, logging: sqlLogFn(`all token transfer count: `), benchmark: true}
        ).then(res=> res as unknown as number);
    })).then(arr=>arr.reduce((a,b)=>a+b));
    const sqlInner = [Erc20Transfer, Erc721Transfer, Erc1155Transfer].map(
        token=>`select fromId from ${token.getTableName()} where epoch between ? and ?
            union select toId from ${token.getTableName()} where epoch between ? and ?`
    ).join(' union ');
    const replace = [
        start, end, start, end,
        start, end, start, end,
        // start, end, start, end,
        start, end, start, end,
    ]
    const sql = `select count(*) as cnt from (
        ${sqlInner}
    ) t`
    const userCnt = await Erc20Transfer.sequelize.query(sql,
        {type:QueryTypes.SELECT, replacements: replace,
        logging: sqlLogFn('all token transfer user:'), benchmark: true
        }
    ).then(arr=>{
        return Number(arr[0]['cnt'])
    })
    return [transferCount, userCnt]
}

export const TOKEN_TYPE_ALL_4 = '_ALL_4'
