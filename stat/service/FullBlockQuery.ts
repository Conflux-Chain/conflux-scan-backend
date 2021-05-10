// @ts-ignore
import {format} from "js-conflux-sdk";
import {Op} from "sequelize"
import {FullBlock, FullTransaction} from "../model/FullBlock";
import {ContractInfo} from "../model/ContractInfo";
import {Hex40Map} from "../model/HexMap";
const CONST = require('./common/constant');

export class FullBlockQuery {
    protected app;

    protected constructor(app: any) {
        this.app = app;
    }

    public async listBlock({epochNumber, blockHash, minTimestamp, maxTimestamp, miner, skip = 0, limit = 10}) {
        const{ logger } = this.app;
        // parse para
        let minerId;
        if(miner){
            const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(miner).substr(2)}})
            minerId = hex40?.id
        }
        // attributes
        const options: any = {offset: skip, limit};
        options.attributes = [
            ['epoch', 'epochNumber'],
            'hash',
            ['minerId', 'miner'],
            'gasLimit',
            'difficulty',
            ['createdAt', 'timestamp'],
            ['txCount', 'transactionCount'],
            ['executedTxnCount', 'executedTransactionCount'],
            'avgGasPrice',
            ['position', 'blockIndex'],
            ['pivot', 'pivotHash'],
            'gasUsed',
            'totalReward',
        ];
        // where
        const conditionArray = [];
        if(minerId){
            conditionArray.push({minerId});
        }
        if(minTimestamp && maxTimestamp) {
            conditionArray.push({ [Op.and]: [{createdAt: { [Op.gte]: new Date(minTimestamp * 1000)}},
                    {createdAt: { [Op.lt]: new Date(maxTimestamp * 1000)}}]});
        }
        if(blockHash){
            conditionArray.push({hash: blockHash});
        }
        if(epochNumber){
            conditionArray.push({epoch: epochNumber});
        }
        if(conditionArray.length === 1){
            options.where = conditionArray[0];
        }
        if(conditionArray.length > 1){
            options.where = {[Op.and]: conditionArray};
        }
        // order
        options.order = [['createdAt', 'DESC']];
        // query
        const page = await FullBlock.findAndCountAll(options);
        const list = [];
        if(page && page.rows){
            const hex40IdSet = new Set<number>();
            page.rows.forEach( item => {
                const row = item.toJSON();
                hex40IdSet.add(row['miner']);
                list.push(row);
            });
            const hex40Array = await Hex40Map.findAll({
                where: {
                    id: { [Op.in]: Array.from(hex40IdSet)}
                },
            })
            const hex40Map = new Map<number, string>()
            hex40Array.forEach(hex40=>{
                hex40Map.set(hex40.id, hex40.hex)
            })
            // fields mapping
            list.forEach(row=>{
                const minerId = row['miner'];
                if(minerId && hex40Map.get(minerId)){
                    row['miner'] = format.address(`0x${hex40Map.get(minerId)}`, this.app?.networkId);
                }
                const timestampInSec =  row['timestamp'].getTime() / 1000;
                row['timestamp'] = timestampInSec;
                row['syncTimestamp'] = timestampInSec;
                row['pivotHash'] = row['pivotHash'] ? row['hash'] : undefined;
            })
        }
        const result = {total: page?.count, list};
        logger?.info({src: `fullblockquery------------`, 'result': JSON.stringify(result)});
        return result;
    }

    public async listTransaction({blockHash, accountAddress, minTimestamp, maxTimestamp, opponentAddress, transactionHash,
                                     txType, status, skip = 0, limit = 10}) {
        const{ logger } = this.app;
        // parse para
        let accountAddressId;
        let opponentAddressId;
        if(accountAddress){
            const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(accountAddress).substr(2)}})
            accountAddressId = hex40?.id
        }
        if(opponentAddress){
            const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(opponentAddress).substr(2)}})
            opponentAddressId = hex40?.id
        }
        // attributes
        const options: any = {offset: skip, limit};
        options.attributes = [
            ['epoch', 'epochNumber'],
            ['blockPosition', 'blockHash'],
            ['txPosition', 'transactionIndex'],
            'nonce',
            'hash',
            ['fromId', 'from'],
            ['toId', 'to'],
            ['dripValue', 'value'],
            'gasPrice',
            'gas',
            ['createdAt', 'timestamp'],
            'status',
            ['contractCreatedId', 'contractCreated'],
        ];
        // where
        const conditionArray = [];
        if(blockHash){
            const block = await FullBlock.findOne({
                where: { hash: blockHash},
            });
            conditionArray.push({epoch: block?.epoch});
            conditionArray.push({blockPosition: block?.position});
        } else{
            if(minTimestamp && maxTimestamp) {
                conditionArray.push({ [Op.and]: [{createdAt: { [Op.gte]: new Date(minTimestamp * 1000)}},
                        {createdAt: { [Op.lt]: new Date(maxTimestamp * 1000)}}]});
            }
            if(opponentAddressId){
                const conditionOpponent = {};
                conditionOpponent[Op.or] = [{toId: opponentAddressId}, {fromId: opponentAddressId}];
                conditionArray.push(conditionOpponent);
            }
            if(transactionHash) {
                conditionArray.push({hash: transactionHash});
            }
            if(txType && accountAddressId){
                if(txType === CONST.TX_TYPE.IN){
                    conditionArray.push({toId: accountAddressId});
                } else if(txType === CONST.TX_TYPE.OUT){
                    conditionArray.push({fromId: accountAddressId});
                }  else if(txType === CONST.TX_TYPE.FAIL || status === CONST.TX_STATUS.FAILED){
                    conditionArray.push({
                        [Op.and]: [
                            {[Op.or]: [{toId: accountAddressId}, {fromId: accountAddressId}]},
                            {status: CONST.TX_STATUS.FAILED},
                        ]
                    });
                } else{
                    conditionArray.push({[Op.or]: [{toId: accountAddressId}, {fromId: accountAddressId}]});
                }
            }
        }
        if(conditionArray.length === 1){
            options.where = conditionArray[0];
        }
        if(conditionArray.length > 1){
            options.where = {[Op.and]: conditionArray};
        }
        // order
        options.order = [['createdAt', 'DESC']];
        // query
        const page = await FullTransaction.findAndCountAll(options);
        const list = [];
        if(page && page.rows){
            const txHashArray = [];
            const hex40IdSet = new Set<number>();
            const contractHexIdSet = new Set<number>();
            page.rows.forEach( item => {
                const row = item.toJSON();
                txHashArray.push(row['hash']);
                hex40IdSet.add(row['from']);
                hex40IdSet.add(row['to']);
                hex40IdSet.add(row['contractCreated']);
                contractHexIdSet.add(row['to']);
                logger?.info({src: `fullTransactionQuery------------`, 'row': JSON.stringify(row)});
                list.push(row);
            });
            const hex40Array = await Hex40Map.findAll({
                where: {id: { [Op.in]: Array.from(hex40IdSet)}},
            })
            const hex40Map = new Map<number, string>()
            hex40Array.forEach(hex40=>{
                hex40Map.set(hex40.id, hex40.hex)
            })
            // contract
            const contractInfoMap = new Map();
            const contractHexIdArray = Array.from(contractHexIdSet)
                .filter(id => hex40Map.get(id)?.startsWith('8'));
            if(contractHexIdArray.length > 0){
                const contractInfoArray = await ContractInfo.findAll({
                    where: {hexId: { [Op.in]: contractHexIdArray}}, order: [['epoch', 'ASC']]
                });
                contractInfoArray.forEach(contractInfo=>{
                    contractInfoMap.set(contractInfo.hexId , { address: contractInfo.base32, name: contractInfo.name });
                })
            }
            // receipt
            const receiptInfoMap = new Map();
            const sdk = this?.app?.confluxSDK || this?.app?.cfx;
            await Promise.all(txHashArray.map(async (txHash) => {
                if(sdk){
                    const receipt = await sdk.getTransactionReceipt(txHash);
                    receiptInfoMap.set(txHash, {gasFee: receipt?.gasFee, txExecErrorMsg: receipt?.txExecErrorMsg});
                }
            }));
            // fields mapping
            list.forEach(row=>{
                row['contractInfo'] = contractInfoMap.get(row['to']);
                row['from'] = format.address(`0x${hex40Map.get(row['from'])}`, this.app?.networkId);
                row['to'] = row['to'] ? format.address(`0x${hex40Map.get(row['to'])}`, this.app?.networkId) : null;
                if(hex40Map.get(row['contractCreated'])){
                    row['contractCreated'] = format.address(`0x${hex40Map.get(row['contractCreated'])}`, this.app?.networkId);
                }
                const timestampInSec =  row['timestamp'].getTime() / 1000;
                row['timestamp'] = timestampInSec;
                row['syncTimestamp'] = timestampInSec;
                const receipt = receiptInfoMap.get(row.hash);
                row['gasFee'] = receipt?.gasFee;
                row['txExecErrorMsg'] = receipt?.txExecErrorMsg;
                row['blockHash'] = row['blockHash'].toString();
                row['nonce'] = row['nonce'].toString();
            })
        }
        const result = {total: page?.count, list};
        logger?.info({src: `fullTransactionQuery------------`, 'result': JSON.stringify(result)});
        return result;
    }
}
