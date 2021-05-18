// @ts-ignore
import {format} from "js-conflux-sdk";
import {Op} from "sequelize"
import {FullBlock, FullTransaction, AddressTransactionIndex, pagingFullBlock, pagingFullTx} from "../model/FullBlock";
import {ContractInfo} from "../model/ContractInfo";
import {Hex40Map} from "../model/HexMap";
import {KEY_FULL_BLOCK_COUNT, KEY_FULL_TX_COUNT, KV} from "../model/KV";
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
        } else{
            const pagedCondition = await this.buildPagedBlockOptions(skip);
            if(pagedCondition) {
                conditionArray.push(pagedCondition.where);
                options.offset = pagedCondition.skip;
            }
        }
        if(conditionArray.length === 1){
            options.where = conditionArray[0];
        }
        if(conditionArray.length > 1){
            options.where = {[Op.and]: conditionArray};
        }
        // order
        options.order = [['epoch', 'DESC'], ['position', 'DESC']];
        // query
        let rawList;
        let count;
        if(minerId){
            const page = await FullBlock.findAndCountAll(options);
            rawList = page?.rows;
            count = page.count;
        } else{
            rawList = await FullBlock.findAll(options);
            count = await KV.getNumber(KEY_FULL_BLOCK_COUNT);
        }
        const list = [];
        if(rawList){
            const hex40IdSet = new Set<number>();
            rawList.forEach( item => {
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
        const result = {total: count ? count : 0, list};
        // logger?.info({src: `fullblockquery------------`, 'result': JSON.stringify(result)});
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
        }
        if(accountAddressId){
            conditionArray.push({addressId: accountAddressId});
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
        } else{
            const pagedCondition = await this.buildPagedTxOptions(skip);
            if(pagedCondition) {
                conditionArray.push(pagedCondition.where);
                options.offset = pagedCondition.skip;
            }
        }
        if(conditionArray.length === 1){
            options.where = conditionArray[0];
        }
        if(conditionArray.length > 1){
            options.where = {[Op.and]: conditionArray};
        }
        // order
        options.order = [['epoch', 'DESC'], ['blockPosition', 'DESC'], ['txPosition', 'DESC']];
        // query
        let rawList;
        let count;
        if(accountAddressId){
            const page = await AddressTransactionIndex.findAndCountAll(options);
            rawList = page?.rows;
            count = page?.count;
        } else if(blockHash){
            const page = await FullTransaction.findAndCountAll(options);
            rawList = page?.rows;
            count = page?.count;
        } else{
            rawList = await FullTransaction.findAll(options);
            count = await KV.getNumber(KEY_FULL_TX_COUNT);
        }
        const list = [];
        if(rawList){
            const txHashArray = [];
            const hex40IdSet = new Set<number>();
            const contractHexIdSet = new Set<number>();
            rawList.forEach( item => {
                const row = item.toJSON();
                txHashArray.push(row['hash']);
                hex40IdSet.add(row['from']);
                hex40IdSet.add(row['to']);
                hex40IdSet.add(row['contractCreated']);
                contractHexIdSet.add(row['to']);
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
        const result = {total: count ? count : 0, list};
        // logger?.info({src: `fullTransactionQuery------------`, 'result': JSON.stringify(result)});
        return result;
    }

    private async buildPagedBlockOptions(skip){
        const{ logger } = this.app;

        const pagedCondition: any = {};
        const blockPage = await pagingFullBlock(skip, logger);
        /** How to use the result:
         if (result.id === Infinity) : query without condition;
         else : query with epoch and position condition.
         SQL:
         select * from t
         where epoch < result.epoch or (epoch = result.epoch and position < result.position)
         order by epoch desc, position desc
         limit result.skip, N
         */
        if(blockPage?.id !== Infinity){
             pagedCondition.where = {
                [Op.or]: [
                    {epoch: {[Op.lt]: blockPage.epoch}},
                    {[Op.and]: [
                            {epoch: blockPage.epoch},
                            {position: {[Op.lt]: blockPage.position}},
                        ]},
                ]
            };
            pagedCondition.skip = blockPage.skip;
        }
        return pagedCondition;
    }

    private async buildPagedTxOptions(skip){
        const pagedCondition: any = {};
        const txPage = await pagingFullTx(skip);
        if(txPage?.id !== Infinity){
            pagedCondition.where = {
                [Op.or]: [
                    {epoch: {[Op.lt]: txPage.epoch}},
                    {[Op.and]: [
                            {epoch: txPage.epoch},
                            {blockPosition: {[Op.lt]: txPage.blockPosition}},
                        ]},
                    {[Op.and]: [
                            {epoch: txPage.epoch},
                            {blockPosition: txPage.blockPosition},
                            {txPosition: {[Op.lt]: txPage.txPosition}},
                        ]},
                ]
            };
            pagedCondition.skip = txPage.skip;
        }
        return pagedCondition;
    }
}
