import {ethers} from "ethers";
import {redirectLog} from "./config/LoggerConfig";
import {
    Transaction,
    Model,
    DataTypes,
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
            ]
        })
    }
}
export interface IAddrEvent3525 {
    id?: number;
    addrId: number;
    refId: number;
}
export class AddrEvent3525 extends Model<IAddrEvent3525> implements IAddrEvent3525 {
    id?: number;
    addrId: number;
    refId: number;
    static register(seq: Sequelize) {
        AddrEvent3525.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            addrId: {type: DataTypes.BIGINT, allowNull: false},
            refId: {type: DataTypes.BIGINT, allowNull: false},
        }, {
            sequelize: seq, tableName: 'addr_event_3525',
            timestamps: false,
            indexes: [
                {name: "idx_addr_id", fields: ["addrId"]},
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
const bigNumberProps = ["tokenId", "_oldSlot", "_newSlot", "_fromTokenId", "_toTokenId", "value"];

function decodeOneLog(parser, log) {
    let event = parser.parseLog(log)
    if (event) {
        const {
            name, args: {
                _from, _to, _tokenId,  // transfer
                _oldSlot, _newSlot, // _tokenId, slot changed
                _fromTokenId, _toTokenId, _value, // transfer value
            }
        } = event;
        const parsed = {
            event: name,
            from: _from,
            to: _to,
            tokenId: _tokenId,
            _oldSlot,
            _newSlot,
            _fromTokenId,
            _toTokenId,
            value: _value
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
    prepareData(): any {
        return {events:[]}
    }
    parser: any;
    constructor() {
        this.parser = build3525interface();
    }
    logParser(log): { key; parsed } {
        return {key: 'events', parsed: decodeOneLog(this.parser, log)};
    }

    popAction(dbTx): Promise<void> {
        return Promise.resolve(undefined);
    }

    postProcess(data, dt:Date, epoch): Promise<any> {
        const {events, } = data;
        return new Promise<any>(async r=>{
            for(let e of events) {
                await buildErc20Transfer(e, dt)
            }
            r(data);
        })
    }

    save(epoch: number, {pivotHash, events}, taskBegin: number): Promise<void> {
        return Event3525.sequelize.transaction(async (dbTx)=>{
            return Promise.all([
                Event3525.bulkCreate(events, {transaction: dbTx}), // will auto id be filled ?
                // AddrEvent3525.bulkCreate(addrEvents)
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