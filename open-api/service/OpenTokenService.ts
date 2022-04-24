import {getApiService} from "../ApiServer";
import {StatApp} from "../../stat/StatApp";
import {format} from "js-conflux-sdk";

export async function queryTokenInfo(address) {
    const token = await getApiService().tokenQuery.query({address});
    const result = {
        contractAddress: token.address,
        tokenName: token.name,
        symbol: token.symbol,
        divisor: token.decimals || '0',
        tokenType: token.transferType,
        totalSupply: token.totalSupply,
        website: token.website || '',
    };

    if (StatApp.isEVM) {
        result.contractAddress = result.contractAddress ? format.hexAddress(result.contractAddress) :
            result.contractAddress;
    }

    return result;
}