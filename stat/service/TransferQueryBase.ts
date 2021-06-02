// @ts-ignore
import {format} from "js-conflux-sdk";
import {Op} from "sequelize"
import {Hex64Map, hex40IdMap, idHex40Map, idHex64Map, Hex40Map} from "../model/HexMap";
import {ContractInfo} from "../model/ContractInfo";
import {Token} from "../model/Token";
const CONST = require('./common/constant');

export abstract class TransferQueryBase {
    protected app;

    protected constructor(app: any) {
        this.app = app;
    }

    private buildQueryOptions({accountAddressId, addressId, minTimestamp, maxTimestamp, opponentAddressId, transactionHashId,
                                  tokenId, txType, skip, limit}){
        const{ logger } = this.app;
        // page
        const queryOptions: any = {offset: skip, limit, raw: true};
        // condition
        const conditionArray = [];
        if(accountAddressId){
            conditionArray.push({addressId: accountAddressId});
        }
        if(addressId){
            conditionArray.push({contractId: addressId});
        }
        if(minTimestamp && maxTimestamp) {
            conditionArray.push({ [Op.and]: [{createdAt: { [Op.gte]: new Date(minTimestamp * 1000)}},
                    {createdAt: { [Op.lt]: new Date(maxTimestamp * 1000)}}]});
        }
        if(opponentAddressId){
            conditionArray.push({[Op.or]: [{toId: opponentAddressId}, {fromId: opponentAddressId}]});
        }
        if(transactionHashId) {
            conditionArray.push({txHashId: transactionHashId});
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
                conditionArray.push({[Op.or]: [{toId: accountAddressId}, {fromId: accountAddressId}]});
            }
        }
        if(conditionArray.length === 1){
            queryOptions.where = conditionArray[0];
        }
        if(conditionArray.length > 1){
            queryOptions.where = {};
            queryOptions.where[Op.and] = conditionArray;
        }
        // order
        queryOptions.order = [['epoch', 'DESC']];
        if(accountAddressId !== undefined){
            queryOptions.order.push(['tracePos', 'DESC']);
        }
        if(addressId !== undefined){
            queryOptions.order.push(['createdAt', 'DESC']);
        }

        return queryOptions;
    }

    public abstract getTransferType(): string;
    public abstract buildQueryFields(): any;
    public abstract doQuery(options: any, queryOptions: any): Promise<any>;
    public abstract processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>,
                                       contractInfoMap: object, tokenInfoMap: object): Promise<any>;

    public async listTransfer(options) {
        const{ logger } = this.app;
        const {accountAddress, address, minTimestamp, maxTimestamp, opponentAddress, transactionHash, tokenId,
            txType , status, skip = 0, limit = 10} = options;

        // parameter
        if(txType === CONST.TX_TYPE.FAIL || status === 1){
            return {total: 0, list: []};
        }
        const accountAddressHex = accountAddress && format.hexAddress(accountAddress).substr(2);
        const addressHex = address && format.hexAddress(address).substr(2);
        const opponentAddressHex = opponentAddress && format.hexAddress(opponentAddress).substr(2);
        const addressArray = [accountAddressHex, addressHex, opponentAddressHex].filter(Boolean);
        const addressMap = addressArray?.length > 0 ? await hex40IdMap(addressArray) : undefined;
        const accountAddressId = addressMap?.get(accountAddressHex);
        const addressId = addressMap?.get(addressHex);
        const opponentAddressId = addressMap?.get(opponentAddressHex);
        let transactionHashId;
        if(transactionHash){
            const hex64 = await Hex64Map.findOne({where: {hex: transactionHash.substr(2)}});
            transactionHashId = hex64?.id;
        }

        // queryOptions
        const queryOptions = this.buildQueryOptions({accountAddressId, addressId, minTimestamp, maxTimestamp, opponentAddressId,
            transactionHashId, tokenId, txType, skip, limit});
        queryOptions.attributes = this.buildQueryFields();

        // query
        const page = await this.doQuery(options, queryOptions);
        const list = [];
        if(page?.rows){
            const hex40IdSet = new Set<number>();
            const hex64IdSet = new Set<number>();
            page.rows.forEach( row => {
                hex40IdSet.add(row['from']);
                hex40IdSet.add(row['to']);
                hex40IdSet.add(row['address']);
                hex64IdSet.add(row['transactionHash']);
                list.push(row);
            });
            const hex40Map = await idHex40Map(Array.from(hex40IdSet));
            const hex64Map = await idHex64Map(Array.from(hex64IdSet));
            const contractHexIdArray = Array.from(hex40IdSet)
                .filter(id => hex40Map.get(id)?.startsWith('8'));

            // contract and token
            const contractInfoMap = {};
            const tokenInfoMap = {};
            if(contractHexIdArray.length > 0){
                const contractInfoArray = await ContractInfo.findAll({
                    where: {hexId: { [Op.in]: contractHexIdArray}}, order: [['epoch', 'ASC']]
                });
                contractInfoArray?.forEach(contractInfo=>{
                    contractInfoMap[contractInfo.hexId] = { address: contractInfo.base32, name: contractInfo.name };
                })
                const tokenInfoArray = await Token.findAll({
                    attributes: ['base32', 'name', 'symbol'],
                    where: {hex40id: { [Op.in]: contractHexIdArray}}
                });
                tokenInfoArray?.forEach(tokenInfo=>{
                    tokenInfoMap[tokenInfo.hex40id] = { address: tokenInfo.base32, name: tokenInfo.name, symbol: tokenInfo.symbol };
                })
            }

            // fields mapping
            list.forEach(row=>{
                row['fromContractInfo'] = contractInfoMap[row['from']];
                row['toContractInfo'] = contractInfoMap[row['to']];
                row['fromTokenInfo'] = tokenInfoMap[row['from']];
                row['toTokenInfo'] = tokenInfoMap[row['to']];
                row['transactionHash'] = `0x${hex64Map.get(row['transactionHash'])}`;
                row['from'] = format.address(`0x${hex40Map.get(row['from'])}`, this.app?.networkId);
                row['to'] = format.address(`0x${hex40Map.get(row['to'])}`, this.app?.networkId);
                row['timestamp'] = row['timestamp'].getTime() / 1000;
                row['syncTimestamp'] = row['timestamp'];
                this.processQueryResult(row, hex40Map, hex64Map, contractInfoMap, tokenInfoMap);
            })
        }
        const result = {total: page?.count || 0, list};
        return result;
    }
}
