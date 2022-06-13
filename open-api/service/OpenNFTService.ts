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
import {Stopwatch} from "../../stat/service/Stopwatch";

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
    mustBeEnumParamIfPresent(ctx.request.query, 'withBrief', ['false', 'true']);
    mustBeEnumParamIfPresent(ctx.request.query, 'withMetadata', ['false', 'true']);

    const {owner, contract, withBrief, withMetadata} = ctx.request.query;
    if (contract === undefined) {
        throw new Error(`Invalid parameter <contract> with value [${contract}], contract is required.`)
    }
    const {skip, limit} = getPagination(ctx.request.query);

    let debug = true
    const watch = debug ? new Stopwatch() : null;
    debug && watch.start('getNftTokensForOpenApi')
    const data = await getApiService().nftCheckerService.getNftTokensForOpenApi({owner, contract, skip, limit});

    if(withBrief === 'true' || withMetadata === 'true'){
        debug && watch.start("batchGetNFTInfoList")
        const externalMs = await batchGetNFTInfoList({nftList: data?.list, withBrief, withMetadata});
        console.log(` --- original ext ms costs`, externalMs)
        ctx.set('external-ms', externalMs)
/*        await Promise.all(data?.list?.map(async (item) => {
            const nftInfo = await getApiService().nftPreviewService.getNFTInfo({contractAddress: item.contract,
                tokenId: BigInt(item.tokenId)});
            const brief = withBrief === 'true' ? {name: nftInfo?.imageName?.en, image: nftInfo?.imageUri,
                description: nftInfo?.imageDesc} : undefined;
            const metadata = withMetadata === 'true' ? {rawData: nftInfo?.detail} : undefined;
            const data = {...brief, ...metadata, error: nftInfo?.error};
            lodash.defaults(item, data);
        }));*/
    }

    if (StatApp.isEVM) {
        data?.list?.forEach(row => {
            row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;
        });
    }
    debug && watch.dump('\nnft tokens')
    debug && console.log(`-----------------\n`)
    setBody(ctx, data)
}

async function batchGetNFTInfoList({nftList, withBrief, withMetadata}){
    let total = nftList?.length;
    let externalMs = 0
    if (!total) {
        return externalMs;
    }

    let curPage = 1;
    let skip = 0;
    let pageSize = 10;
    do {
        const nftArray = nftList.slice(skip, skip + pageSize)
        if (nftArray?.length) {
            await Promise.all(nftArray?.map(async (item) => {
                const nftInfo = await getApiService().nftPreviewService.getNFTInfo({contractAddress: item.contract,
                    tokenId: BigInt(item.tokenId)});
                externalMs += nftInfo?.externalMs || 0
                const brief = withBrief === 'true' ? {name: nftInfo?.imageName?.en, image: nftInfo?.imageUri,
                    description: nftInfo?.imageDesc} : undefined;
                const metadata = withMetadata === 'true' ? {rawData: nftInfo?.detail} : undefined;
                const data = {...brief, ...metadata, error: nftInfo?.error};
                lodash.defaults(item, data);
            }));
        }
        skip = (++curPage - 1) * pageSize;
    } while (skip <= total);
    return externalMs
}

export async function getNFTPreview(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contract');
    mustBeIntParamIfPresent(ctx.request.query, 'tokenId');
    mustBeEnumParamIfPresent(ctx.request.query, 'withMetadata', ['false', 'true']);

    const {contract, tokenId, withMetadata} = ctx.request.query;
    if(contract === undefined) {
        throw new Error(`Invalid parameter <contract> with value [${contract}], contract is required.`)
    }
    if(tokenId === undefined) {
        throw new Error(`Invalid parameter <contract> with value [${tokenId}], tokenId is required.`)
    }

    const nftInfo = await getApiService().nftPreviewService.getNFTInfo({contractAddress: contract,
        tokenId: BigInt(tokenId)});

    const data = {contract, tokenId, name: nftInfo?.imageName?.en, image: nftInfo?.imageUri,
        description: nftInfo?.imageDesc};
    const metadata = withMetadata === 'true' ? {rawData: nftInfo?.detail} : undefined;
    lodash.defaults(data, {...metadata, error: nftInfo?.error});

    if (StatApp.isEVM) {
        data.contract = data.contract ? format.hexAddress(data.contract) : data.contract;
    }

    setBody(ctx, data)
}
