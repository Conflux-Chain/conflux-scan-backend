import {StatApp} from "../../stat/StatApp";
import {getApiService} from "../ApiServer";
import {setBody} from "../router/middleware";
import {format} from "js-conflux-sdk";
import {
    checkPresent,
    mustBeAddressArrayParamIfPresent,
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeIntParamIfPresent
} from "../../stat/service/common/utils";
import {paginateCore} from "../../stat/router/ParamChecker";
import {Errors} from "../../stat/service/common/LogicError";
import {TokenQuery} from "../../stat/service/TokenQuery";

const lodash = require('lodash');

export async function listAccountNFTs(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'owner');
    mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');

    const {owner} = ctx.request.query;
    const {skip, limit} = paginateCore(ctx.request.query);

    checkPresent({owner}, ['owner']);

    const result = await TokenQuery.listByAccount({owner, types: ['ERC721', 'ERC1155'], skip, limit});

    result.list = result.list.map((token: any) =>
        lodash.assign({
                owner: StatApp.isEVM ? format.hexAddress(owner) : owner,
                contract: StatApp.isEVM ? format.hexAddress(token.contract) : token.contract,
            },
            lodash.pick(token, ['type', 'balance', 'name', 'symbol', 'iconUrl', 'webSite']))
    );

    result.list = result.list.map(token => lodash.pickBy(token, value => !lodash.isNil(value)));

    setBody(ctx, result);
}

export async function listNFTTokensPro(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'owner');
    mustBeAddressArrayParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contract');
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC'])
    mustBeEnumParamIfPresent(ctx.request.query, 'sortField', ['latest_update_time','mint_time'])
    mustBeIntParamIfPresent(ctx.request.query, 'cursor', 'skip', 'limit', 'tokenId');
    mustBeEnumParamIfPresent(ctx.request.query, 'withBrief', ['false', 'true']);
    mustBeEnumParamIfPresent(ctx.request.query, 'withMetadata', ['false', 'true']);
    mustBeEnumParamIfPresent(ctx.request.query, 'suppressMetadataError', ['false', 'true']);

    const {owner, contract, tokenId, withBrief, withMetadata, suppressMetadataError, sort, sortField, cursor} = ctx.request.query;
    const {skip, limit} = paginateCore(ctx.request.query, owner ? {skipMax: undefined} : undefined); // no skipMax limit for owner
    if(!contract && !owner) {
        throw new Errors.ParameterError(`At least one of the parameters 'contract' and 'owner' is required.`);
    }

    const data = await getApiService().nftCheckerService.listNftTokensForOpenApiPro({
        owner, contract, tokenId: tokenId?.toString(), sort, sortField, cursor, skip, limit});
    if(withBrief === 'true' || withMetadata === 'true') {
        const externalMs = await batchGetNFTInfoList({nftList: data?.list, withBrief, withMetadata, suppressMetadataError});
        ctx.set('external-ms', externalMs)
    }

    if(StatApp.isEVM) {
        data?.list?.forEach(row => {
            row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;
            row.owner = row.owner ? format.hexAddress(row.owner) : row.owner;
            row.type = row.type ? row.type.replace('CRC', 'ERC') : row.type;
        });
    }
    setBody(ctx, data)
}

export async function listNFTTokensByFts(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contract');

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
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contract');
    mustBeIntParamIfPresent(ctx.request.query, 'tokenId', 'limit');

    const {contract, tokenId, cursor} = ctx.request.query;
    const {limit} = paginateCore(ctx.request.query);
    checkPresent({contract}, ['contract']);

    const data = await getApiService().nftCheckerService.getNftOwnersForOpenApi({contract, tokenId: tokenId?.toString(), cursor, limit});

    if (StatApp.isEVM) {
        data?.list?.forEach(row => {
            row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;
            row.address = row.address ? format.hexAddress(row.address) : row.address;
        });
    }
    setBody(ctx, data)
}

async function batchGetNFTInfoList({nftList, withBrief, withMetadata, suppressMetadataError}){
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
                const nftInfo: any = await getApiService().nftPreviewService
                    .getNFTInfo({contractAddress: item.contract, tokenId: BigInt(item.tokenId)})
                    .catch(e => {
                        if(suppressMetadataError !== 'true') throw e;
                        return {detail: e.partialData, error: e.message};
                    });

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
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contract');
    mustBeIntParamIfPresent(ctx.request.query, 'tokenId');
    mustBeEnumParamIfPresent(ctx.request.query, 'withMetadata', ['false', 'true']);

    const {contract, tokenId, withMetadata} = ctx.request.query;
    checkPresent({contract, tokenId}, ['contract', 'tokenId']);

    const nftInfo = await getApiService().nftPreviewService.getNFTInfo({contractAddress: contract,
        tokenId: BigInt(tokenId), withDetail: true}) as any;

    const data = {
        contract, tokenId,
        name: nftInfo?.imageName?.en, image: nftInfo?.imageUri, description: nftInfo?.imageDesc, creator: nftInfo.creator,
        mintTimestamp: nftInfo?.mintTime.getTime() / 1000, owner: nftInfo?.owner, type: nftInfo?.type?.replace('ERC', 'CRC')
    };
    const metadata = withMetadata === 'true' ? {rawData: nftInfo?.detail} : undefined;
    lodash.defaults(data, {...metadata, error: nftInfo?.error});
    if (StatApp.isEVM) {
        data.contract = data.contract ? format.hexAddress(data.contract) : data.contract;
        data.creator = data.creator ? format.hexAddress(data.creator) : data.creator;
        data.type = data.type ? data.type.replace('CRC', 'ERC') : data.type;
    }
    setBody(ctx, data)
}
