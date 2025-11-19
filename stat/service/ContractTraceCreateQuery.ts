// @ts-ignore
import {format} from "js-conflux-sdk";
import {Hex40Map, idHex40Map, hex40IdMap} from "../model/HexMap";
import {TraceCreateContract} from "../model/TraceCreateContract";
import {Op, QueryTypes} from "sequelize";
import {FullTransaction} from "../model/FullBlock";
import {fmtAddr, StatApp} from "../StatApp";
import {CONST} from "./common/constant"

const lodash = require('lodash');

export class ContractTraceCreateQuery{
    protected app

    constructor(app: any) {
        this.app = app
    }

    async query(address: string) {
        const{cfx} = this.app
        const hex = format.hexAddress(address)
        const addr = await Hex40Map.findOne({where: {hex: hex.substr(2)}})
        if(!addr){
            return {msg: `get create trace, no contract ${address} found`}
        }

        let trace: any
        if((trace = this.getInternalGenesisTrace(hex)) && trace) {
            return trace
        }

        trace = await TraceCreateContract.sequelize.query(`
            select 
                t.epochNumber,
                t.blockTime,
                t.txHash,
                h.hex as caller
            from trace_create_contract t  
            join hex40 h on t.from = h.id 
            where t.to = ?
        `, {
            type: QueryTypes.SELECT,
            replacements: [addr.id]
        }).then((list) => (list?.length ? list[0] : null))
        if(!trace){
            return {msg: `get create trace, no create trace found for contract ${address}`}
        }

        // use EOA from as contract creator, not the trace caller.
        const transactionHash = `0x${trace.txHash}`
        let contractCreator = await FullTransaction.sequelize.query(`
            select h.hex as address from full_tx t  
            join hex40 h on t.fromId = h.id 
            where t.hash = ?
        `, {
            type: QueryTypes.SELECT,
            replacements: [transactionHash]
        }).then((list: any[]) => (list?.length ? `0x${list[0].address}` : null))
        if(!contractCreator) {
            const tx = await cfx.getTransactionByHash(transactionHash)
            if (tx) {
                contractCreator = format.hexAddress(tx.from)
            }
        }

        let contractFactory = ''
        const traceCaller = `0x${trace.caller}`
        if(traceCaller !== contractCreator) {
            contractFactory = traceCaller
        }

        return {
            address: fmtAddr(address, StatApp.networkId),
            epochNumber: trace.epochNumber,
            transactionHash,
            from: fmtAddr(contractCreator, StatApp.networkId),
            contractFactory: fmtAddr(contractFactory, StatApp.networkId),
            timestamp: trace.blockTime
        }
    }

    private MAX_CONTRACTS = 100

    public async list(addressArray) {
        if(!addressArray){
            return []
        }

        if(addressArray){
            if (!lodash.isArray(addressArray)) {
                addressArray = [addressArray]
            }
            if(addressArray?.length > this.MAX_CONTRACTS) {
                throw Error(`Contract addresses up to ${this.MAX_CONTRACTS} at a time`)
            }
        }

        const hexArray = addressArray.map(addr => format.hexAddress(addr))
        const map = await hex40IdMap(hexArray.map(hex => hex.substr(2)))
        if(!map.size) {
            return []
        }

        const internalGenesisTraces = hexArray
            .map(hex => this.getInternalGenesisTrace(hex))
            .filter(Boolean)
        if(internalGenesisTraces?.length === map.size) {
            return internalGenesisTraces
        }

        let list: any[] = await TraceCreateContract.findAll({
            attributes: [
                ['to', 'address'],
                'epochNumber',
                ['txHash', 'transactionHash'],
                'from',
                ['blockTime', 'timestamp']
            ],
            where: {to: {[Op.in]: [...map.values()]}},
            raw: true
        })

        if(internalGenesisTraces?.length){
            list = [...list, ...internalGenesisTraces]
        }

        if(list?.length){
            const ids = new Set<number>()
            list.forEach(row => {
                row['from'] && ids.add(row['from'])
                ids.add(row['address'])
            })
            const map = await idHex40Map(Array.from(ids), true)
            list.forEach(row=>{
                row['address'] = fmtAddr(map.get(row['address']), StatApp.networkId)
                row['from'] && (row['from'] = fmtAddr(map.get(row['from']), StatApp.networkId))
                row['transactionHash'] = `0x${row['transactionHash']}`
            })
        }

        return list
    }

    private getInternalGenesisTrace(address){
        const hex = format.hexAddress(address)
        const isInternal = CONST.INTERNAL_CONTRACT_ALL.includes(hex)
        const isGenesis = CONST.GENESIS_CONTRACT.includes(hex)
        if(!(isInternal || isGenesis)) {
            return null
        }

        let transactionHash = null
        let from = null
        if(isGenesis) {
            transactionHash = CONST.GENESIS_ADDR_CONTRACT_MAP[hex].txHash[StatApp.networkId] || null
            from = CONST.GENESIS_ADDRESS
        }

        return {
            address: fmtAddr(hex, StatApp.networkId),
            epochNumber: 0,
            transactionHash,
            from: fmtAddr(from, StatApp.networkId),
            contractFactory: null,
            timestamp: 0
        }
    }
}
