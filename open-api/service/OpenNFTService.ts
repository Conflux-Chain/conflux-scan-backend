import {StatApp} from "../../stat/StatApp";
import {getApiService} from "../ApiServer";
import {setBody} from "../router/middleware";
import {format} from "js-conflux-sdk";
import {
    getPagination,
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeIntParamIfPresent
} from "../../stat/service/common/utils";

const lodash = require('lodash');

export async function listNFTBalances(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'owner');
    mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');

    const {owner} = ctx.request.query;
    const {skip, limit} = getPagination(ctx.request.query);
    const data = await getApiService().nftCheckerService.getNftBalancesForOpenApi({owner, skip, limit});

    if (StatApp.isEVM) {
        data?.list?.forEach(row => {
            row.owner = row.owner ? format.hexAddress(row.owner) : row.owner;
            row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;
        });
    }

    setBody(ctx, data)
}

export async function listNFTTokens(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'owner', 'contract');
    mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');
    mustBeEnumParamIfPresent(ctx.request.query, 'detail', ['false', 'true']);

    const {owner, contract, detail} = ctx.request.query;
    if (contract === undefined) {
        throw new Error(`Invalid parameter <contract> with value [${contract}], contract is required.`)
    }
    const {skip, limit} = getPagination(ctx.request.query);
    const data = await getApiService().nftCheckerService.getNftTokensForOpenApi({owner, contract, skip, limit});

    if (StatApp.isEVM) {
        data?.list?.forEach(row => {
            row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;
        });
    }

    if(detail === 'true'){
        await Promise.all(data?.list?.map(async (item) => {
            const nftInfo = await getApiService().nftPreviewService.getNFTInfo({contractAddress: item.contract, tokenId: item.tokenId});
            const data = {name: nftInfo?.imageName?.en, image: nftInfo?.imageUri, description: nftInfo?.imageDesc};
            lodash.defaults(item, data);
        }));
    }

    setBody(ctx, data)
}

export async function getNFTPreview(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contract');
    mustBeIntParamIfPresent(ctx.request.query, 'tokenId');

    const {contract, tokenId} = ctx.request.query;
    if(contract === undefined) {
        throw new Error(`Invalid parameter <contract> with value [${contract}], contract is required.`)
    }
    if(tokenId === undefined) {
        throw new Error(`Invalid parameter <contract> with value [${tokenId}], tokenId is required.`)
    }

    const nftInfo = await getApiService().nftPreviewService.getNFTInfo({contractAddress: contract, tokenId});
    if(!nftInfo) {
        // throw new Error(`NFT not found.`)
    }
    const data = {contract, tokenId, name: nftInfo?.imageName?.en, image: nftInfo?.imageUri, description: nftInfo?.imageDesc};

    if (StatApp.isEVM) {
        data.contract = data.contract ? format.hexAddress(data.contract) : data.contract;
    }

    setBody(ctx, data)
}
