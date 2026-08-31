import {
    LEGACY_NFT_IMAGES,
    LEGACY_NFT_NAMES,
    LEGACY_NFT_URIS,
    LEGACY_NFTS,
    getNFTMeta,
    normalizeIpfsURI,
    replaceMetaAttributes
} from './NFTMetaUtil';
import {Desensitizer} from "../Desensitizer";
import {NftMint, Token} from "../../model/Token";
import {formatToBase32, Hex40Map} from "../../model/HexMap";
import {format} from "js-conflux-sdk";
import {Op, QueryTypes} from "sequelize";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {Errors} from "../common/LogicError";
import {CONST} from "../common/constant"
import {IPFSGatewaySync} from "../IPFSGatewaySync";
import {TokenQuery} from "../TokenQuery";
import {MetaStatus, NftMeta} from "./NFTIndexer";
import {safeFetch} from "../common/security/safeFetch";
import {safeAddErrorLog} from "../../monitor/ErrorMonitor";

const lodash = require('lodash');

export class NFTPreviewService {
    private cfx;
    private ipfsGatewaySync: IPFSGatewaySync;

    constructor({cfx, ipfsGatewaySync = new IPFSGatewaySync()}) {
        this.cfx = cfx;
        this.ipfsGatewaySync = ipfsGatewaySync;
    }

    public start() {
        return this.ipfsGatewaySync.start();
    }

    public stop() {
        this.ipfsGatewaySync.stop();
    }

    public async getNFTInfo ({
        contractAddress,
        tokenId,
        withDetail = false,
        forceFlush = false,
    }: {
        contractAddress: string;
        tokenId: bigint;
        withDetail?: boolean;
        forceFlush?: boolean;
    }): Promise<NFTInfoType> {
        const address = formatToBase32(contractAddress) as string;
        let token = await Token.findOne({attributes: ['hex40id', 'type', 'ipfsGateway'], where: {base32: address}});
        const typeInfo = await TokenQuery.detectTokenType({base32: address}) as Token;
        if (!token) {
            token = typeInfo;
        } else if (typeInfo.type === CONST.TRANSFER_TYPE.ERC1155
            || typeInfo.type === CONST.TRANSFER_TYPE.ERC721) {
            token.type = typeInfo.type; // support hybrid nft
        }

        if (!token || (token.type !== CONST.TRANSFER_TYPE.ERC1155 && token.type !== CONST.TRANSFER_TYPE.ERC721)) {
            throw new Errors.ParameterError(`The contract ${contractAddress} not a NFT contract`);
        }

        let nftInfo: NFTInfoType;
        if (LEGACY_NFTS[address]) {
            nftInfo = lodash.cloneDeep(LEGACY_NFTS[address]) as NFTInfoType;
        } else {
            const {hex40id, type, ipfsGateway: gateway} = token;
            const method = LEGACY_NFT_URIS[address] || (type === CONST.TRANSFER_TYPE.ERC1155 ? "uri" : "tokenURI");
            nftInfo = await this.getNFTMeta({address, hex40id, tokenId, gateway, method, forceFlush});
        }

        let ownerInfo;
        if (withDetail) {
            ownerInfo = await this.getNFTOwnerInfo({address, hex40id: token.hex40id, tokenId, type: token.type});
        }

        const imageGateway = getImageGateway(nftInfo.imageUri);

        lodash.assign(nftInfo, ownerInfo, {imageGateway});

        nftInfo.imageName.zh = Desensitizer.mosaicStr(address, nftInfo.imageName.zh);
        nftInfo.imageName.en = Desensitizer.mosaicStr(address, nftInfo.imageName.en);
        nftInfo.imageUri = Desensitizer.mosaicUri(address, nftInfo.imageUri);

        return nftInfo;
    }

    private async getNFTMeta({
        address,
        hex40id,
        tokenId,
        gateway,
        method = 'uri',
        forceFlush = false
    }: {
        address: string,
        hex40id: number,
        tokenId: bigint,
        gateway?: string,
        method?: string,
        forceFlush?: boolean
    }): Promise<NFTInfoType> {
        try {
            if (!forceFlush) {
                const cache = await this.getCache(hex40id, String(tokenId));
                if (cache) {
                    try {
                        return await this.buildNFTMeta(
                            address, method, tokenId, gateway, cache.uri, JSON.parse(cache.content)
                        );
                    } catch (e) {
                        safeAddErrorLog('nft-preview', 'build-cached-metadata', e).then();
                    }
                }
            }

            const {rawURI, meta} = await getNFTMeta(this.cfx, address, tokenId, gateway, method);

            replaceMetaAttributes(address, meta);

            await this.setCache(hex40id, String(tokenId), rawURI, meta).catch(e => {
                safeAddErrorLog('nft-preview', 'set-metadata-cache', e).then();
            });

            const nft = this.buildNFTMeta(address, method, tokenId, gateway, rawURI, meta);
            return nft;
        } catch (e) {
            if (e.code === undefined) {
                e = new Errors.QueryNFTError(e?.message?.substr(0, 255));
            }
            throw e;
        }
    };

    private async buildNFTMeta(address, method, tokenId, gateway, rawTokenURI, meta): Promise<NFTInfoType> {
        const gatewayTokenURI = normalizeIpfsURI(rawTokenURI, gateway);
        const legacyName = LEGACY_NFT_NAMES[address] && LEGACY_NFT_NAMES[address](meta);
        const legacyImage = LEGACY_NFT_IMAGES[address] && LEGACY_NFT_IMAGES[address](meta);
        return {
            imageName: legacyName || await this.getNFTName(meta, gateway) || {},
            imageUri: legacyImage || (meta.image ? normalizeIpfsURI(meta.image, gateway) : meta.image_data),
            imageDesc: meta.description,
            detail: {
                funcCall: `${method}(${tokenId})`,
                tokenUri: {raw: rawTokenURI, gateway: gatewayTokenURI !== rawTokenURI ? gatewayTokenURI : ''},
                metadata: meta,
            }
        }
    }

    private async getNFTName(meta, gateway?: string) {
        const nftName = {
            en: meta.name,
            zh: meta.name
        };
        try {
            if (meta?.localization?.uri) { // try 1155
                const zhUri = meta.localization.uri.replace('{locale}', 'zh-cn');
                const data = await safeFetch(normalizeIpfsURI(zhUri, gateway));
                const json = JSON.parse(data);
                nftName.zh = json.name || meta.name;
            }
        } catch (e) {
            safeAddErrorLog('nft-preview', 'get-localized-name', e).then();
        }
        return nftName;
    };

    private async getCache(contractId: number, tokenId: string) {
        const nftMeta = await NftMeta.findOne({where: {contractId, tokenId}, raw: true});
        if (!nftMeta || nftMeta.status !== MetaStatus.SUCCESS || !nftMeta.content) {
            return null;
        }
        return nftMeta;
    }

    private setCache(contractId: number, tokenId: string, uri: string, metadata: any) {
        return NftMeta.bulkCreate([{
            contractId: contractId,
            tokenId,
            epochNumber: 0,
            status: MetaStatus.SUCCESS,
            retry: 0,
            errorType: 0,
            error: '',
            uri,
            content: JSON.stringify(metadata)
        }] as NftMeta[], {
            updateOnDuplicate: ['status', 'retry', 'errorType', 'error', 'uri', 'content', 'updatedAt']
        });
    }

    private async getNFTOwnerInfo({address, hex40id, tokenId, type}) {
        const hex = format.hexAddress(address);

        const creatorSql = `select hex from hex40 where id = (select \`from\` from trace_create_contract where \`to\` = (select
            id from hex40 where hex = ?)) limit 1;`;
        const latestTransferPromise = type === CONST.TRANSFER_TYPE.ERC721
            ? Erc721Transfer.findOne({
                where: {contractId: hex40id, tokenId: `${tokenId}`},
                order: [['epoch', 'DESC']],
                attributes: ['toId'],
                raw: true
            })
            : Promise.resolve(undefined);
        const [creatorRows, mint, latestTransfer] = await Promise.all([
            Hex40Map.sequelize.query(creatorSql, {
                type: QueryTypes.SELECT,
                replacements: [hex.substr(2)]
            }),
            NftMint.findOne({
                attributes: ['toId', 'createdAt'],
                where: {contractId: hex40id, tokenId: `${tokenId}`},
                raw: true
            }),
            latestTransferPromise
        ]);

        const addressIds = [mint?.toId, latestTransfer?.toId].filter(Boolean);
        const addressRows = addressIds.length ? await Hex40Map.findAll({
            attributes: ['id', 'hex'],
            where: {id: {[Op.in]: addressIds}},
            raw: true
        }) : [];
        const addressMap = lodash.keyBy(addressRows, 'id');
        const formatAddressId = (id) => addressMap[id]
            ? formatToBase32(`0x${addressMap[id].hex}`)
            : undefined;
        const creator = creatorRows?.length
            ? formatToBase32(`0x${creatorRows[0]['hex']}`)
            : undefined;
        const mintOwner = formatAddressId(mint?.toId);
        const owner = type === CONST.TRANSFER_TYPE.ERC721
            ? formatAddressId(latestTransfer?.toId)
            : mintOwner;

        return {creator, mintTime: mint?.['createdAt'], owner, type};
    }
}

function getImageGateway(imageUri?: string): string {
    if (!imageUri) {
        return '';
    }
    try {
        const url = new URL(imageUri);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return '';
        }
        const markerIndex = url.pathname.indexOf('/ipfs/');
        return markerIndex < 0 ? '' : `${url.origin}${url.pathname.substring(0, markerIndex)}`;
    } catch (e) {
        return '';
    }
}

export type NFTImageName = {
    en?: string;
    zh?: string;
};

export type NFTDetail = {
    funcCall: string;
    tokenUri: {raw: string; gateway: string};
    metadata: Record<string, unknown>;
};

export type NFTInfoType = {
    imageMinHeight?: number;
    imageUri?: string;
    imageName: NFTImageName;
    imageDesc?: unknown;
    detail?: NFTDetail;
    code?: number;
    error?: unknown;
    externalMs?: number;
    creator?: string;
    mintTime?: Date;
    owner?: string;
    type?: string;
};
