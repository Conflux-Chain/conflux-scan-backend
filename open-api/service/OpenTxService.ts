import {format} from "js-conflux-sdk";
import {Hex40Map} from "../../stat/model/HexMap";
import {AddressTransactionIndex} from "../../stat/model/FullBlock";
import {
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeIntParamIfPresent, skipLimit
} from "../../stat/service/common/utils";
import {StatApp} from "../../stat/StatApp";
import {setBody} from "../router/middleware";
import {CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG} from "../common/Def";
import {getApiService} from "../ApiServer";
import {polishContract} from "./OpenContractService";

/**
 * query transactions of one account(address)
 * @param ctx
 */
export async function listAccountTransaction(ctx) {
    mustBeIntParamIfPresent(ctx.request.query, 'minEpochNumber','maxEpochNumber', 'startBlock', 'endBlock', 'minTimestamp','maxTimestamp')
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'from','to','account')
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC'])
    const {skip, limit} = skipLimit(ctx.request.query)
    const {account: base32,minEpochNumber,maxEpochNumber,startBlock, endBlock, minTimestamp,maxTimestamp,from, to, sort, nonce, txType, needAddressInfo} = ctx.request.query;
    if (!Boolean(base32)) {
        setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
        return
    }

    const startEpoch = StatApp.isEVM ? startBlock : minEpochNumber;
    const endEpoch = StatApp.isEVM ? endBlock : maxEpochNumber;
    const page = await getApiService().fullBlockQuery.listTransaction({accountAddress: base32, skip, limit,
        verboseAddress: false, minEpochNumber: startEpoch, maxEpochNumber: endEpoch, minTimestamp, maxTimestamp, from, to, sort, nonce, txType
    });

    const hashArray = [];
    page?.list?.forEach(tx=>{
        delete tx.syncTimestamp
        delete tx.blockHash
        if (StatApp.isEVM) {
            tx['blockNumber'] = tx.epochNumber;
            delete tx.epochNumber;
            delete tx.blockPosition;
            tx['contractAddress'] = tx.contractCreated;
            delete tx.contractCreated;
            tx['isError'] = tx.txExecErrorMsg ? '1' : '0';
            hashArray.push(tx.hash);
        }
    })

    if (StatApp.isEVM) {
        const resp = await getApiService().fullBlockQuery.batchGetTransactionList({hashArray});
        const {txMap} = resp;
        page?.list?.forEach(tx=>{
            tx['input'] = txMap[tx.hash]?.data;
            tx['blockHash'] = txMap[tx.hash]?.blockHash;
        })
    }

    delete page.extraInfo
    await polishContract(page, needAddressInfo)
    setBody(ctx, page)
}

export async function base32id(base32: string) {
    const hex = format.hexAddress(base32)
    return Hex40Map.findOne({where: {hex: hex.substr(2)} });
}

export async function queryAccountTx({base32,startEpoch,endEpoch,startTimestamp,endTimestamp,sort
                                     }) {
    const ownerId = await base32id(base32);
    const page = await AddressTransactionIndex.findAndCountAll({
        where: {addressId: ownerId}
    })
}
