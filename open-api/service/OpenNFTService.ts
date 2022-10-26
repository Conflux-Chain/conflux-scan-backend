import {StatApp} from "../../stat/StatApp";
import {getApiService} from "../ApiServer";
import {setBody} from "../router/middleware";
import {format, sign} from "js-conflux-sdk";
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
    mustBeEnumParamIfPresent(ctx.request.query, 'withBrief', ['false', 'true']);
    mustBeEnumParamIfPresent(ctx.request.query, 'withMetadata', ['false', 'true']);

    const {owner, contract, withBrief, withMetadata} = ctx.request.query;
    if (contract === undefined) {
        throw new Error(`Invalid parameter <contract> with value [${contract}], contract is required.`)
    }

    const maxSkip = !owner ? 10_000 : Number.MAX_VALUE;
    const {skip, limit} = getPagination(ctx.request.query, {maxSkip, maxLimit: 100});
    // const {skip, limit} = getPagination(ctx.request.query);

    const seqId = genSeqId(ctx.url);
    const date = new Date();
    const veryStart = date.getTime();
    let start = date.getTime();
    console.log(`[seqId=${seqId}][time=${date.toLocaleString()}][url=${ctx.url}]listNFTTokens start`);
    const data = await getApiService().nftCheckerService.getNftTokensForOpenApi({owner, contract, skip, limit});
    console.log(`[[seqId=${seqId}]listNFTTokens.getNftTokensForOpenApi elapsed:${Date.now() - start}`); start = Date.now();

    if(withBrief === 'true' || withMetadata === 'true'){
        const externalMs = await batchGetNFTInfoList({seqId, nftList: data?.list, withBrief, withMetadata});
        console.log(`[seqId=${seqId}]listNFTTokens.batchGetNFTInfoList elapsed:${Date.now() - start}`); start = Date.now();
        ctx.set('external-ms', externalMs)
    }

    if (StatApp.isEVM) {
        data?.list?.forEach(row => { row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;});
    }
    console.log(`[seqId=${seqId}]listNFTTokens elapsed ${Date.now() - veryStart}`);
    setBody(ctx, data)
}

export async function listNFTTokensByFts(ctx) {
    const {nftName} = ctx.request.query;
    if (nftName === undefined) {
        throw new Error(`Invalid parameter <nftName> with value [${nftName}], nftName is required.`)
    }

    const data = await getApiService().nftCheckerService.getNftTokensByFtsForOpenApi({nftName});
    delete data.total;
    if (StatApp.isEVM) {
        data?.list?.forEach(row => {row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;});
    }
    setBody(ctx, data)
}

function genSeqId(url){
    const plain = `${url}${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const random = sign.keccak256(Buffer.from(plain)).toString('hex');
    return random.substr(0, 16);
}

async function batchGetNFTInfoList({seqId, nftList, withBrief, withMetadata}){
    let total = nftList?.length;
    if (!total) {
        return 0;
    }
    const start = Date.now()
    let curPage = 1;
    let skip = 0;
    let pageSize = 10;
    let start0 = Date.now();
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
        const raw = lodash.map(nftArray, nft => lodash.pick(nft, ['contract', 'tokenId']));
        console.log(`[seqId=${seqId}]listNFTTokens.getNFTInfo get:${JSON.stringify(raw)}, elapsed:${Date.now() - start0}`);start0 = Date.now();
    } while (skip <= total);
    return Date.now() - start
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
