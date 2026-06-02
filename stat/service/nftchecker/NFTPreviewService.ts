import {LEGACY_NFT_IMAGES, LEGACY_NFT_NAMES, LEGACY_NFT_URIS, LEGACY_NFTS} from './NFTInfo';
import {Desensitizer} from "../Desensitizer";
import {NftMint, Token} from "../../model/Token";
import {formatToBase32, Hex40Map} from "../../model/HexMap";
import {format} from "js-conflux-sdk";
import {QueryTypes} from "sequelize";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {Errors} from "../common/LogicError";
import {CONST} from "../common/constant"
import {IPFSGatewaySync} from "../IPFSGatewaySync";
import {fmtAddr, StatApp} from "../../StatApp";
import {TokenQuery} from "../TokenQuery";
import {MetaStatus, NftMeta} from "./NFTIndexer";
import {safeFetch} from "../common/security/safeFetch";

const lodash = require('lodash');
const {abi} = require('../abi/Crc1155Core');

export class NFTPreviewService {
    private cfx;

    constructor({cfx}) {
        this.cfx = cfx;
        new IPFSGatewaySync();
    }

    public async getNFTInfo ({
        contractAddress,
        tokenId,
        withDetail = false,
        forceFlush = false,
    }: {
        contractAddress: string;
        tokenId: BigInt;
        withDetail?: boolean;
        forceFlush?: boolean;
    }): Promise<NFTInfoType> {
        const address = formatToBase32(contractAddress) as string;
        let token = await Token.findOne({attributes: ['hex40id', 'type', 'ipfsGateway'], where: {base32: address}});
        if (!token) {
            token = await TokenQuery.detectTokenType({base32: address}) as Token;
        }
        if (token.type !== CONST.TRANSFER_TYPE.ERC1155 && token.type !== CONST.TRANSFER_TYPE.ERC721) {
            throw new Errors.ParameterError(`The contract ${contractAddress} not a NFT contract`);
        }

        let nftInfo;
        if (LEGACY_NFTS[address]) {
            nftInfo = LEGACY_NFTS[address];
        } else {
            const {hex40id, type, ipfsGateway: gateway} = token;
            const method = LEGACY_NFT_URIS[address] || (type === CONST.TRANSFER_TYPE.ERC1155 ? "uri" : "tokenURI");
            nftInfo = await this.getNFTMeta({address, hex40id, tokenId, gateway, method, forceFlush});
        }

        let ownerInfo;
        if (withDetail) {
            ownerInfo = await this.getNFTOwnerInfo({address, hex40id: token.hex40id, tokenId, type: token.type});
        }

        const imageUri = nftInfo.imageUri;
        const imageGateway = imageUri?.startsWith('http') ? imageUri.substring(0, imageUri.indexOf('/ipfs/')) : '';

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
        tokenId: BigInt,
        gateway?: string,
        method?: string,
        forceFlush?: boolean
    }): Promise<NFTInfoType> {
        try {
            if (!forceFlush) {
                const cache = await this.getCache(hex40id, String(tokenId));
                if (cache) {
                    const nft = this.buildNFTMeta(address, method, tokenId, gateway, cache.uri, JSON.parse(cache.content));
                    return nft;
                }
            }

            const {rawURI, meta} = await getNFTMeta(this.cfx, address, tokenId, gateway, method);

            replaceMetaAttributes(address, meta);

            this.setCache(hex40id, String(tokenId), rawURI, meta);

            const nft = this.buildNFTMeta(address, method, tokenId, gateway, rawURI, meta);
            return nft;
        } catch (e) {
            if (e.code === undefined) {
                e = new Errors.QueryNFTError(e?.message?.substr(0, 255));
            }
            throw e;
        }
    };

    private async buildNFTMeta(address, method, tokenId, gateway, rawTokenURI, meta) {
        const gatewayTokenURI = normalizeIpfsURI(rawTokenURI, gateway);
        const legacyName = LEGACY_NFT_NAMES[address] && LEGACY_NFT_NAMES[address](meta);
        const legacyImage = LEGACY_NFT_IMAGES[address] && LEGACY_NFT_IMAGES[address](meta);
        return {
            imageName: legacyName || await this.getNFTName(meta) || {},
            imageUri: legacyImage || normalizeIpfsURI(meta.image, gateway),
            imageDesc: meta.description,
            detail: {
                funcCall: `${method}(${tokenId})`,
                tokenUri: {raw: rawTokenURI, gateway: gatewayTokenURI !== rawTokenURI ? gatewayTokenURI : ''},
                metadata: meta,
            }
        }
    }

    private async getNFTName(meta) {
        try {
            const nftName = {
                en: meta.name
            };
            if (meta?.localization?.uri) { // try 1155
                const zhUri = meta.localization.uri.replace('{locale}', 'zh-cn');
                const data = await safeFetch(zhUri);
                const json = JSON.parse(data);
                const zh = json.name;
                lodash.assign(nftName, {zh: zh ? zh : meta.name});
            }
            return nftName;
        } catch (e) {
            throw new Errors.QueryNFTLocalNameError(`${meta?.localization?.uri} ${e.message}`)
        }
    };

    private async getCache(contractId: number, tokenId: string) {
        const nftMeta = await NftMeta.findOne({where: {contractId, tokenId}, raw: true});
        if (!nftMeta || nftMeta.status !== MetaStatus.SUCCESS || !nftMeta.content) {
            return null;
        }
        return nftMeta;
    }

    private setCache(contractId: number, tokenId: string, uri: string, metadata: string) {
        NftMeta.upsert({
            contractId: contractId,
            tokenId,
            epochNumber: 0,
            status: MetaStatus.SUCCESS,
            retry: 0,
            errorType: 0,
            error: '',
            uri,
            content: JSON.stringify(metadata)
        }).then();
    }

    private async getNFTOwnerInfo({address, hex40id, tokenId, type}) {
        const hex = format.hexAddress(address);

        const sql = `select * from hex40 where id = (select \`from\` from trace_create_contract where \`to\` = (select
            id from hex40 where hex = ?));`;
        const creator = await Hex40Map.sequelize
            .query(sql, {type: QueryTypes.SELECT, replacements: [hex.substr(2)]})
            .then(hexBeanArray => {
                return hexBeanArray?.length ? formatToBase32(`0x${hexBeanArray[0]['hex']}`) : undefined;
            });

        const sql1 = `select * from ${NftMint.getTableName()} where contractId =(select id from hex40 where hex = ?) 
            and tokenId = ?;`;
        const minter = await NftMint.sequelize
            .query(sql1, {type: QueryTypes.SELECT, replacements: [hex.substr(2), `${tokenId}`]})
            .then(async nftMinterArray => {
                if (!nftMinterArray?.length) return undefined;
                const nftMinter = nftMinterArray[0];
                const ownerHex = await Hex40Map.findOne({where: {id: nftMinter['toId']}});
                const owner = formatToBase32(`0x${ownerHex['hex']}`);
                const mintTime = nftMinter['createdAt'];
                return {owner, mintTime};
            });

        let owner;
        if (type === CONST.TRANSFER_TYPE.ERC721) {
            const ownerId = await Erc721Transfer.findOne({
                where: {contractId: hex40id, tokenId: `${tokenId}`},
                order: [['epoch', 'DESC']],
                limit: 1,
                raw: true
            }).then(item => item.toId);
            const ownerHex = await Hex40Map.findOne({where: {id: ownerId}});
            owner = formatToBase32(`0x${ownerHex['hex']}`);
        }

        return {creator, ...minter, owner, type};
    }
}

export type NFTInfoType = {
    imageMinHeight?: number;
    imageUri?: string;
    imageName?: any;
    imageDesc?: any;
    detail?: any;
    code?: number;
    error?: any;
    externalMs?: number;
} | null;

export async function getNFTMeta(cfx, address, tokenId, userGateway, method) {
    const rawURI = await getTokenURI(cfx, address, tokenId, method);
    const gatewayURI = normalizeIpfsURI(rawURI, userGateway);
    const rawMeta = await getMetadataByURI(gatewayURI);

    let meta;
    try {
        meta = typeof rawMeta === "object" ? rawMeta : JSON.parse(rawMeta);
    } catch (e) {
        throw new Errors.ParseNFTMetadataError(`parse metadata of NFT occurs ${e.message}`);
    }

    if (!LEGACY_NFT_NAMES[address] && !LEGACY_NFT_IMAGES[address]) {
        assertRequiredMetadataFields(meta);
    }

    return {
        rawURI,
        gatewayURI,
        meta,
    }
}

async function getTokenURI(cfx, address, tokenId, method) {
    try {
        const contract = cfx.Contract({address, abi});
        const tokenURI = await contract[method](tokenId);
        return tokenURI.replace('{id}', tokenId.toString(16).padStart(64, '0'));
    } catch (e) {
        throw new Errors.CallNFTContractError(`call contract method ${method}(${tokenId}) occurs ${e.message}`);
    }
}

function normalizeIpfsURI(rawURI: string, userGateway: string): string {
    if (!rawURI || typeof rawURI !== 'string') {
        throw new Errors.QueryNFTMetadataError('invalid metadata uri');
    }

    const trimmed = rawURI.trim();

    if (trimmed.startsWith('ipfs://')) {
        const gateway = IPFSGatewaySync.tmplFromGateway(userGateway) || IPFSGatewaySync.fastest || "https://ipfs.io";
        const path = trimmed
            .slice('ipfs://'.length)
            .replace(/^ipfs\//, '');
        return `${gateway.replace(/\/+$/, '')}/ipfs/${path}`;
    }

    return trimmed;
}

async function getMetadataByURI(tokenURI: string) {
    try {
        if (tokenURI.startsWith("{")) {
            return tokenURI
        }

        if (tokenURI.startsWith('data:application/json;base64')) {
            return Buffer.from(tokenURI.substring(29), 'base64').toString();
        }

        const meta = await safeFetch(tokenURI);
        return meta;
    } catch (e) {
        throw new Errors.QueryNFTMetadataError(`request third-party tokenURI ${tokenURI} occurs ${e.message}, try again later`);
    }
}

function assertRequiredMetadataFields(meta: any): void {
    if (!meta.image && !meta.image_data)
        throw new Errors.MetadataPropertyError("invalid nft metadata, missing field image");
    if (!meta.name)
        throw new Errors.MetadataPropertyError("invalid nft metadata, missing field name");
}

export function replaceMetaAttributes(address, meta) {
    const addr = fmtAddr(address, StatApp.networkId);

    const nfts = CONST.SWAPPI_NFT_POSITION_LIST[StatApp.networkId];
    if (!nfts?.length || !nfts.includes(addr)) {
        return;
    }

    for (const [search, replace] of Object.entries(CONST.SWAPPI_NFT_POSITION_NAME_REPLACES)) {
        const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        if (meta?.name) {
            meta.name = meta.name.replace(regex, replace);
        }
        if (meta?.description) {
            meta.description = meta.description.replace(regex, replace);
        }
    }
}


