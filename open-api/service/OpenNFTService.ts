import {StatApp} from "../../stat/StatApp";
import {getApiService} from "../ApiServer";
import {setBody} from "../router/middleware";
import {format, sign} from "js-conflux-sdk";
import {
    checkPresent,
    getPagination,
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeIntParamIfPresent
} from "../../stat/service/common/utils";
import {paginateCore} from "../../stat/router/ParamChecker";

const lodash = require('lodash');

export async function listNFTBalances(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'owner');
    mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');

    const {owner} = ctx.request.query;
    const {skip, limit} = paginateCore(ctx.request.query);
    checkPresent({owner}, ['owner']);

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
    mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit', 'tokenId');
    mustBeEnumParamIfPresent(ctx.request.query, 'withBrief', ['false', 'true']);
    mustBeEnumParamIfPresent(ctx.request.query, 'withMetadata', ['false', 'true']);

    const {owner, contract, tokenId, withBrief, withMetadata} = ctx.request.query;
    const {skip, limit} = paginateCore(ctx.request.query, owner ? {skipMax: undefined} : undefined); // no skipMax limit for owner
    checkPresent({contract}, ['contract']);

    const data = await getApiService().nftCheckerService.getNftTokensForOpenApi({owner, contract, tokenId, skip, limit});
    if(withBrief === 'true' || withMetadata === 'true'){
        const externalMs = await batchGetNFTInfoList({nftList: data?.list, withBrief, withMetadata});
        ctx.set('external-ms', externalMs)
    }

    data?.list?.forEach(row => {
        delete row['owner'];
        delete row['amount'];
        StatApp.isEVM && (row.contract = row.contract ? format.hexAddress(row.contract) : row.contract);
    });
    setBody(ctx, data)
}

export async function listNFTTokensByFts(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contract');

    const {contract, name: nftName} = ctx.request.query;
    checkPresent({nftName}, ['nftName']);

    const data = await getApiService().nftCheckerService.getNftTokensByFtsForOpenApi({contract, name: nftName});

    delete data.total;
    if (StatApp.isEVM) {
        data?.list?.forEach(row => {row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;});
    }
    setBody(ctx, data)
}

export async function listNFTOwners(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contract');
    mustBeIntParamIfPresent(ctx.request.query, 'tokenId', 'limit');

    const {contract, tokenId, cursor} = ctx.request.query;
    const {limit} = paginateCore(ctx.request.query);
    checkPresent({contract}, ['contract']);

    const data = await getApiService().nftCheckerService.getNftOwnersForOpenApi({contract, tokenId, cursor, limit});

    if (StatApp.isEVM) {
        data?.list?.forEach(row => {row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;});
    }
    setBody(ctx, data)
}

async function batchGetNFTInfoList({nftList, withBrief, withMetadata}){
    let total = nftList?.length;
    if (!total) {
        return 0;
    }

    const start = Date.now()
    let curPage = 1;
    let skip = 0;
    let pageSize = 10;

    do {
        const nftArray = nftList.slice(skip, skip + pageSize)
        if (nftArray?.length) {
            await Promise.all(nftArray?.map(async (item) => {
                const nftInfo = await getApiService().nftPreviewService.getNFTInfo({contractAddress: item.contract,
                    tokenId: BigInt(item.tokenId)});
                const brief = withBrief === 'true' ? {name: nftInfo?.imageName?.en, image: nftInfo?.imageUri,
                    description: nftInfo?.imageDesc} : undefined;
                const metadata = withMetadata === 'true' ? {rawData: nftInfo?.detail} : undefined;
                const data = {...brief, ...metadata, error: nftInfo?.error};
                lodash.defaults(item, data);
            }));
        }
        skip = (++curPage - 1) * pageSize;
    } while (skip <= total);

    return Date.now() - start
}

export async function getNFTPreview(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contract');
    mustBeIntParamIfPresent(ctx.request.query, 'tokenId');
    mustBeEnumParamIfPresent(ctx.request.query, 'withMetadata', ['false', 'true']);

    const {contract, tokenId, withMetadata} = ctx.request.query;
    checkPresent({contract, tokenId}, ['contract', 'tokenId']);

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
