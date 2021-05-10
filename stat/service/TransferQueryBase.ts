// @ts-ignore
import {format} from "js-conflux-sdk";
import {Op} from "sequelize"
import {Hex40Map, Hex64Map} from "../model/HexMap";
import {ContractInfo} from "../model/ContractInfo";
import {Token} from "../model/Token";
const CONST = require('./common/constant');

export abstract class TransferQueryBase {
    protected app;

    protected constructor(app: any) {
        this.app = app;
    }

    private async hex40IdMap(hex40Array: Array<string>): Promise<Map<string, number>>{
        const result = await Hex40Map.findAll({
            where: {hex: { [Op.in]: hex40Array}},
        })
        const hex40IdMap = new Map<string, number>()
        result.forEach(hex40=>{
            hex40IdMap.set(hex40.hex, hex40.id)
        })
        return hex40IdMap;
    }

    private async idHex40Map(idArray: Array<number>): Promise<Map<number, string>>{
        const result = await Hex40Map.findAll({
            where: {id: { [Op.in]: idArray}},
        })
        const idHex40Map = new Map<number, string>()
        result.forEach(hex40=>{
            idHex40Map.set(hex40.id, hex40.hex)
        })
        return idHex40Map;
    }

    private async idHex64Map(idArray: Array<number>): Promise<Map<number, string>>{
        const result = await Hex64Map.findAll({
            where: {id: { [Op.in]: idArray}},
        })
        const idHex64Map = new Map<number, string>()
        result.forEach(hex64=>{
            idHex64Map.set(hex64.id, hex64.hex)
        })
        return idHex64Map;
    }

    private buildQueryOptions({accountAddressId, minTimestamp, maxTimestamp, opponentAddressId, transactionHash, tokenId,
                                      txType, skip, limit}){
        const{ logger } = this.app;
        // page
        const options: any = {offset: skip, limit};
        // condition
        const conditionArray = [];
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
        if(tokenId) {
            conditionArray.push({tokenId: tokenId.toString()});
        }
        if(txType && accountAddressId){
            if(txType === CONST.TX_TYPE.IN){
                conditionArray.push({toId: accountAddressId});
            } else if(txType === CONST.TX_TYPE.OUT){
                conditionArray.push({fromId: accountAddressId});
            } else{
                const conditionTypeAll = {};
                conditionTypeAll[Op.or] = [{toId: accountAddressId}, {fromId: accountAddressId}];
                conditionArray.push(conditionTypeAll);
            }
        }
        if(conditionArray.length === 1){
            options.where = conditionArray[0];
        }
        if(conditionArray.length > 1){
            options.where = {};
            options.where[Op.and] = conditionArray;
        }
        // order
        options.order = [['createdAt', 'DESC']];
        logger?.info({src: `${this.getTransferType()}----------`, 'options': JSON.stringify(options)});
        return options;
    }

    public abstract getTransferType(): string;
    public abstract buildQueryFields(): any;
    public abstract doQuery(options: any): Promise<any>;
    public abstract processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>,
                                       contractInfoMap: Map<number, object>, tokenInfoMap: Map<number, object>): Promise<any>;

    public async listTransfer({accountAddress, minTimestamp, maxTimestamp, opponentAddress, transactionHash, tokenId,
                                     txType = CONST.TX_TYPE.ALL, status, skip = 0, limit = 10}) {
        const{ logger } = this.app;

        // parameter
        if(txType === CONST.TX_TYPE.FAIL || status === 1){
            return {total: 0, list: []};
        }
        const addressArray = [accountAddress, opponentAddress].filter(Boolean)
            .map(item => {const hex40 = format.hexAddress(item);return hex40.substr(2);});
        const addressMap = addressArray?.length > 0 ? await this.hex40IdMap(addressArray) : undefined;
        const accountAddressId = addressMap?.get(accountAddress ? format.hexAddress(accountAddress).substr(2) : undefined);
        const opponentAddressId = addressMap?.get(opponentAddress ? format.hexAddress(opponentAddress).substr(2) : undefined);

        // field
        const options = this.buildQueryOptions({accountAddressId, minTimestamp, maxTimestamp, opponentAddressId
            , transactionHash, tokenId, txType, skip, limit});
        options.attributes = this.buildQueryFields();

        // query
        const page = await this.doQuery(options);
        const list = [];
        if(page && page.rows){
            const hex40IdSet = new Set<number>();
            const hex64IdSet = new Set<number>();
            const contractHexIdSet = new Set<number>();
            const tokenHexIdSet = new Set<number>();
            page.rows.forEach( item => {
                const row = item.toJSON();
                hex40IdSet.add(row['from']);
                hex40IdSet.add(row['to']);
                hex40IdSet.add(row['address']);
                hex64IdSet.add(row['transactionHash']);
                contractHexIdSet.add(row['from']);
                contractHexIdSet.add(row['to']);
                tokenHexIdSet.add(row['address']);
                list.push(row);
            });
            const hex40Map = await this.idHex40Map(Array.from(hex40IdSet));
            const hex64Map = await this.idHex64Map(Array.from(hex64IdSet));

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

            // token
            const tokenInfoMap = new Map();
            const tokenHexIdArray = Array.from(tokenHexIdSet).filter(Boolean).map(id => Number(id));
            if(tokenHexIdArray.length > 0){
                const tokenInfoArray = await Token.findAll({
                    attributes: ['base32', 'name', 'symbol'],
                    where: {hex40id: { [Op.in]: tokenHexIdArray}}
                });
                tokenInfoArray.forEach(tokenInfo=>{
                    tokenInfoMap.set(tokenInfo.hex40id , { address: tokenInfo.base32, name: tokenInfo.name, symbol: tokenInfo.symbol });
                })
            }

            // fields mapping
            list.forEach(row=>{
                row['fromContractInfo'] = contractInfoMap.get(row['from']);
                row['toContractInfo'] = contractInfoMap.get(row['to']);
                row['transactionHash'] = `0x${hex64Map.get(row['transactionHash'])}`;
                row['from'] = format.address(`0x${hex40Map.get(row['from'])}`, this.app?.networkId);
                row['to'] = format.address(`0x${hex40Map.get(row['to'])}`, this.app?.networkId);
                row['timestamp'] = row['timestamp'].getTime() / 1000;
                row['syncTimestamp'] = row['timestamp'];
                this.processQueryResult(row, hex40Map, hex64Map, contractInfoMap, tokenInfoMap);
            })
        }
        const result = {total: page?.count, list};
        logger?.info({src: `${this.getTransferType()}----------`, 'result': JSON.stringify(result)});
        return result;
    }
}
