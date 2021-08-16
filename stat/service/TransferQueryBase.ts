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

    private buildQueryOptions({
                                  minEpochNumber, maxEpochNumber,
                                  transactionHashId, minTimestamp, maxTimestamp,
                                  accountAddressId, addressId, fromAddressId, toAddressId, opponentAddressId,
                                  tokenId, txType, skip, limit
                              }){
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
        if(minEpochNumber && maxEpochNumber) {
            conditionArray.push({ [Op.and]: [{epoch: { [Op.gte]: minEpochNumber}},
                    {epoch: { [Op.lt]: maxEpochNumber}}]});
        }
        if(minTimestamp && maxTimestamp) {
            conditionArray.push({ [Op.and]: [{createdAt: { [Op.gte]: new Date(minTimestamp * 1000)}},
                    {createdAt: { [Op.lt]: new Date(maxTimestamp * 1000)}}]});
        }
        if(fromAddressId) {
            conditionArray.push({fromId: fromAddressId});
        }
        if(toAddressId) {
            conditionArray.push({toId: toAddressId});
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
        if(txType === CONST.TX_TYPE.IN){
            conditionArray.push({toId: accountAddressId});
        } else if(txType === CONST.TX_TYPE.OUT){
            conditionArray.push({fromId: accountAddressId});
        } else{
            conditionArray.push({[Op.or]: [{toId: accountAddressId}, {fromId: accountAddressId}]});
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
    public abstract processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>): Promise<any>;

    public async listTransfer(options) {
        const{ logger } = this.app;
        const {minEpochNumber, maxEpochNumber,
            transactionHash, minTimestamp, maxTimestamp,
            accountAddress, address, fromAddress, toAddress, opponentAddress,
            tokenId, txType , status, skip = 0, limit = 10} = options;

        // parameter
        if(txType === CONST.TX_TYPE.FAIL || status === 1){
            return {total: 0, list: []};
        }
        const addressMap = {};
        await Promise.all([accountAddress, address, fromAddress, toAddress, opponentAddress]
            .map(async ( address ) => {
                if(address){
                    const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(address).substr(2)}})
                    addressMap[address] =  hex40?.id;
                }
            })
        );
        const accountAddressId = addressMap[accountAddress];
        const addressId = addressMap[address];
        const fromAddressId = addressMap[fromAddress];
        const toAddressId = addressMap[toAddress];
        const opponentAddressId = addressMap[opponentAddress];

        let transactionHashId;
        if(transactionHash){
            const hex64 = await Hex64Map.findOne({where: {hex: transactionHash.substr(2)}});
            transactionHashId = hex64?.id;
        }

        // check if address exist
        if((accountAddress !== undefined && accountAddressId === undefined)
            || (address !== undefined && addressId === undefined)
            || (opponentAddress !== undefined && opponentAddressId === undefined)){
            return {total: 0, list: []};
        }

        // queryOptions
        const queryOptions = this.buildQueryOptions({
            minEpochNumber, maxEpochNumber,
            transactionHashId, minTimestamp, maxTimestamp,
            accountAddressId, addressId, fromAddressId, toAddressId, opponentAddressId,
            tokenId, txType, skip, limit
        });
        queryOptions.attributes = this.buildQueryFields();
        if(options.accountAddress !== undefined){
            queryOptions.attributes.push( ['tracePos', 'transactionLogIndex'],);
        } else{
            queryOptions.attributes.push(['id', 'transactionLogIndex']);
        }

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

            // fields mapping
            list.forEach(row=>{
                row['transactionHash'] = `0x${hex64Map.get(row['transactionHash'])}`;
                row['from'] = format.address(`0x${hex40Map.get(row['from'])}`, this.app?.networkId);
                row['to'] = format.address(`0x${hex40Map.get(row['to'])}`, this.app?.networkId);
                row['timestamp'] = row['timestamp'].getTime() / 1000;
                row['syncTimestamp'] = row['timestamp'];
                this.processQueryResult(row, hex40Map, hex64Map);
            })
        }
        const result = {total: page?.count || 0, list};
        return result;
    }

    public abstract doQueryAccountAddress(options: any, queryOptions: any): Promise<any>;

    public async listAccountAddress(options) {
        const {address, skip = 0, limit = 10} = options;

        const addressHex = address && format.hexAddress(address).substr(2);
        const addressMap = await hex40IdMap([addressHex]);
        const addressId = addressMap?.get(addressHex);
        if(address !== undefined && addressId === undefined){
            return {total: 0, list: []};
        }

        const queryOptions: any = {where: {contractId: addressId}, offset: skip, limit, raw: true};
        const page = await this.doQueryAccountAddress(options, queryOptions);
        let list ;
        if(page?.rows){
            const hex40IdSet = new Set<number>();
            page.rows.forEach( row => {
                hex40IdSet.add(row['addressId']);
            });
            const hex40Map = await idHex40Map(Array.from(hex40IdSet));
            list = [...hex40Map.values()];
        }
        return {total: list?.length || 0, list: list || []};
    }
}
