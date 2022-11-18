import {ethers} from "ethers";
import {redirectLog} from "./config/LoggerConfig";
import {
    Transaction,
    Model,
    DataTypes, QueryTypes,
    Sequelize,
    Op,
} from "sequelize";
import {Conflux} from "js-conflux-sdk";
import {
    aggregateTransfer,
    buildErc20Transfer, buildTransferList2address, ContractUser,
} from "./model/Erc20Transfer";
import {AddressErc1155Transfer, Erc1155Transfer, IErc1155Transfer} from "./model/Erc1155Transfer";
import {regExitHook, sleep} from "./service/tool/ProcessTool";
import {ITaskCursor, startSyncEvent, SyncHandler, TaskTemplate} from "./EventSync";

export interface ISlotChange {
    // event SlotChanged(uint256 indexed _tokenId, uint256 indexed _oldSlot, uint256 indexed _newSlot);
    tokenId: string; oldSlot: string; newSlot:string;
}
export interface ISlot3525 {
    id?:number; contractId: number; slot: string;
}
export interface ITokenSlot3525 {
    id?:number; contractId: number; tokenId:string; slot: string;  ownerId: number;
    createdAt: Date; updatedAt: Date;
}
export class Slot3525 extends Model<ISlot3525> implements ISlot3525 {
    id?:number; contractId: number; slot: string;
    static register(seq: Sequelize) {
        Slot3525.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            slot: {type: DataTypes.STRING(78), allowNull: false},
        }, {
            sequelize: seq, tableName: 'slot_3525',
            timestamps: false,
            indexes: [
                {name: "idx_c_slot", fields: ["contractId", "slot", ], unique: true},
                {name: "idx_c_t", fields: ["contractId", {name:"id", order: "DESC"}]},
            ]
        })
    }
}
export class TokenSlot3525 extends Model<ITokenSlot3525> implements ITokenSlot3525 {
    id?:number; contractId: number; tokenId:string; slot: string; ownerId: number;
    createdAt: Date; updatedAt: Date;
    static register(seq: Sequelize) {
        TokenSlot3525.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            ownerId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            tokenId: {type: DataTypes.STRING(78), allowNull: false},
            slot: {type: DataTypes.STRING(78), allowNull: false, defaultValue: ''},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
        }, {
            sequelize: seq, tableName: 'token_slot_3525',
            timestamps: false,
            indexes: [
                {name: "idx_c_token", fields: ["contractId", "tokenId",], unique: true},
                {name: "idx_c_slot", fields: ["contractId", "slot"]}, // query token under slot
            ]
        })
    }
}
export interface IEvent3525 extends IErc1155Transfer {
    // event TransferValue(uint256 indexed _fromTokenId, uint256 indexed _toTokenId, uint256 _value);
    // id: number;
    // contractId: number;
    event: string; // TransferValue, Transfer, SlotChanged
    /*fromId:   number; */fromTokenId: string;
    /*toId:     number; */toTokenId:   string;
    slot:     string;
    // value:    string; // or old slot for SlotChanged
}
export class Event3525 extends Model<IEvent3525> implements IEvent3525 {
    id?: number;
    epoch: number; createdAt: Date; contractId: number; blockIndex: number; txIndex: number;
    txLogIndex: number; fromId: number; toId: number; value: string;
    tokenId:string; event: string; slot:     string; fromTokenId: string; toTokenId:   string;
    static register(seq:Sequelize) {
        Event3525.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            event: {type: DataTypes.STRING("TransferValue".length), allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            blockIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txIndex: {type: DataTypes.INTEGER, allowNull: false},
            txLogIndex: {type: DataTypes.INTEGER, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.STRING(78), allowNull: true, defaultValue: ""},
            tokenId: {type: DataTypes.STRING(78), allowNull: true, defaultValue: ""},
            fromTokenId: {type: DataTypes.STRING(78), allowNull: true, defaultValue: ""},
            toTokenId: {type: DataTypes.STRING(78), allowNull: true, defaultValue: ""},
            slot: {type: DataTypes.STRING(78), allowNull: true, defaultValue: ""},
        }, {
            sequelize: seq, tableName: 'event_3525',
            indexes: [
                {name: 'idx_contract', fields:[{name: 'contractId'}, {name: "id", order: 'DESC'}]}, // query by contract, order by id desc
                {name: 'uk', fields: ["epoch",'blockIndex','txIndex','txLogIndex']},
            ]
        })
    }
}
export interface IAddrEvent3525 {
    id?: number;
    addrId: number;
    refId: number;
    epoch: number;
}
export class AddrEvent3525 extends Model<IAddrEvent3525> implements IAddrEvent3525 {
    id?: number;
    addrId: number;
    refId: number; epoch: number;
    static register(seq: Sequelize) {
        AddrEvent3525.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            addrId: {type: DataTypes.BIGINT, allowNull: false},
            refId: {type: DataTypes.BIGINT, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
        }, {
            sequelize: seq, tableName: 'addr_event_3525',
            timestamps: false,
            indexes: [
                {name: "idx_addr_id", fields: ["addrId", {name:"id", order: "DESC"}]},
                {name: "idx_epoch", fields: ["epoch"]},
            ]
        })
    }
}
export interface IParsedEvent3525 {
    event, from, to, _tokenId, _oldSlot, _newSlot, _fromTokenId, toTokenId, _value
}
export function build3525interface() {
    const {abi} = require('../../common/contracts/build/contracts/IERC3525.json')
    return new ethers.utils.Interface(abi);
}
const bigNumberProps = ["tokenId", "slot", "_oldSlot", "_newSlot", "fromTokenId", "toTokenId", "value"];

function decodeOneLog(parser, log) {
    let event: any;
    try {
        event = parser.parseLog(log);
    } catch (e) {
        if (e.message.includes("no matching event")) {
        } else {
            throw e;
        }
    }
    if (event) {
        const {
            name, args: {
                _from, _to, _tokenId,  // transfer
                _oldSlot, _newSlot, // _tokenId, slot changed
                _fromTokenId, _toTokenId, _value, // transfer value
            }
        } = event;
        const parsed = {
            address: log.address,
            event: name,
            from: _from,
            to: _to,
            tokenId: _tokenId,
            slot: _newSlot,
            _newSlot,
            _oldSlot, // not saved in db
            fromTokenId: _fromTokenId,
            toTokenId: _toTokenId,
            value: _value || _oldSlot || ""
        }
        bigNumberProps.filter(k => parsed[k]).forEach(k => parsed[k] = parsed[k].toString())
        return parsed
    }
    return null;
}

export function decode3525logs(logs:any[], parser: ethers.utils.Interface) : IParsedEvent3525[]{
    const result = []
    for(let log of logs) {
        let parsed = decodeOneLog(parser, log);
        if (parsed) {
            result.push(parsed)
        }
    }
    return result;
}
async function testParseLog(rpc) {
    let tx = '0xf8c0c910a92f6eed0b46d2033c7f9c7e1277212b2fc3ca647133a9c351323f9b'
    let cfx = new Conflux({url: rpc})
    let {logs} = await cfx.getTransactionReceipt(tx)
    let events = decode3525logs(logs, build3525interface());
    console.log(`events`, events)
}
class Event3525handler implements SyncHandler {
    parser: any;
    constructor() {
        this.parser = build3525interface();
    }

    popAction(epoch, dbTx): Promise<any> {
        return Promise.all([
            Event3525.destroy({where: {epoch}, transaction: dbTx}),
            AddrEvent3525.destroy({where: {epoch}, transaction: dbTx}),
        ])
    }

    logParser(log): { key; parsed } {
        return {key: 'events', parsed: decodeOneLog(this.parser, log)};
    }

    prepareData(): any {
        return {events:[], slots: {}, tokens: {}}
    }
    postProcess(data, dt:Date, epoch): Promise<any> {
        const {events, slots, tokens} = data;
        return new Promise<any>(async r=>{
            for(let e of events) {
                await buildErc20Transfer(e, dt)
            }
            // collect slot change
            for(let e of events) {
                const {event, slot, contractId, tokenId, toId} = e;
                if (event === 'SlotChanged') {
                    slots[`${contractId}_${slot}`] = {contractId, slot};

                    const former = tokens[`${contractId}_${tokenId}`] || {contractId, tokenId, ownerId: 0, createdAt: dt, updatedAt: dt}
                    tokens[`${contractId}_${tokenId}`] = {...former, slot}
                } else if (e.event === 'Transfer') {
                    const former = tokens[`${contractId}_${tokenId}`] || {contractId, tokenId, slot: '', createdAt: dt, updatedAt: dt}
                    tokens[`${contractId}_${tokenId}`] = {...former, ownerId: toId}
                }
            }
            r(data);
        })
    }

    buildForAddr(arr:Event3525[]) : IAddrEvent3525[] {
        const result:IAddrEvent3525[] = []
        for(let e of arr) {
            if (e.fromId > 0) {
                result.push({id: 0, addrId: e.fromId, refId: e.id, epoch: e.epoch})
            }
            if (e.toId > 0 && e.toId !== e.fromId) {
                result.push({id: 0, addrId: e.toId, refId: e.id, epoch: e.epoch})
            }
        }
        return result;
    }

    save(epoch: number, {pivotHash, events, slots, tokens}, taskBegin: number): Promise<void> {
        const slotArr = Object.keys(slots).map(k=>slots[k]);
        // build token id beans
        const fields = ['contractId','tokenId', 'slot', 'ownerId','createdAt', 'updatedAt'];
        const placeHolderStr = `(${fields.map(()=>'?').join(',')})`
        const tokenArr = Object.keys(tokens).map(k=>tokens[k]);
        const arrPlaceHolder = tokenArr.map(()=>placeHolderStr).join(',')
        const values = []
        tokenArr.forEach(t=>{
            fields.forEach(k=>{
                values.push(t[k])
            })
        })

        const fullSql = `insert into ${TokenSlot3525.getTableName()} (${fields.join(',')}) values ${arrPlaceHolder
        } ON DUPLICATE KEY UPDATE ownerId=if(values(ownerId) = 0, ownerId, values(ownerId)) , ${''
        } slot=if(values(slot)='', slot, values(slot)), updatedAt=values(updatedAt);`

        return Event3525.sequelize.transaction(async (dbTx)=>{
            return Promise.all([
                Event3525.bulkCreate(events, {
                    transaction: dbTx,
                    updateOnDuplicate:["event","contractId","fromId","toId","slot","tokenId","fromTokenId", "toTokenId", "value"]}
                    )
                    .then((arr)=>{
                        return AddrEvent3525.bulkCreate(this.buildForAddr(arr),
                            {transaction: dbTx})
                    }), // will auto id be filled ?
                Slot3525.bulkCreate(slotArr, {
                    ignoreDuplicates: true, transaction: dbTx,
                }),
                new Promise(async r=>{
                    if (values.length) {
                        TokenSlot3525.sequelize.query({query: fullSql, values},
                            {transaction: dbTx, type: QueryTypes.UPSERT, logging: console.log})
                            .then(r)
                    } else {
                        r(0)
                    }
                }),
                TaskEvent3525.update(
                    {cursor: epoch, },
                    {where:{epoch:taskBegin}, transaction:dbTx})
            ])
        }).then()
    }

    needCheckMaxEpoch(): boolean {
        return false;
    }

}
export class TaskEvent3525 extends TaskTemplate {
    static register(seq: Sequelize) {
        TaskTemplate.registerTemplate(TaskEvent3525, seq, 'task_event_3525')
    }
}
async function sync() {
    redirectLog()
    regExitHook()
    // cfxUrl: useConfigRpc
    // fromEpoch:
    // -1 : use former unfinished task; exclude mode.
    // N  : use task N if it's not finished, fallback to *.
    // *  : auto create based on max task.
    const handler = new Event3525handler();
    const [, , cmd, cfxUrl, fromEpoch, taskLen] = process.argv
    startSyncEvent(cfxUrl, TaskEvent3525, handler, fromEpoch, taskLen).then().catch(err => {
        console.log(`${process.argv[1]}\n`, err)
        process.exit(1)
    });
}
async function main() {
    const [,,cmd, arg1] = process.argv
    if (cmd === 'testParseLog') {
        await testParseLog(arg1)
    } else if (cmd === 'sync') {
        await sync();
    }
    console.log(`done`);
}
if (module === require.main) {
    main().then()
}


// node /Users/kang/work/conflux-scan-statistics/stat/dist/T3525Sync.js sync http://net8889eth.confluxrpc.com/cfxbridge -1 1000
// node /Users/kang/work/conflux-scan-statistics/stat/dist/T3525Sync.js sync https://evmtestnet.confluxscan.net/rpcv2 99952425 1000
// node /Users/kang/work/conflux-scan-statistics/stat/dist/T3525Sync.js sync https://evmtestnet.confluxscan.net/rpcv2 99952425 2