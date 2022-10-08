import { NFTMap, NFTNames } from './NFTInfo';
import {toBase32} from "../tool/AddressTool";
import {Desensitizer} from "../Desensitizer";
import {NftMint, Token} from "../../model/Token";
import {Hex40Map} from "../../model/HexMap";
import {format} from "js-conflux-sdk";
import {QueryTypes} from "sequelize";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {Errors} from "../common/LogicError";
import {CONST} from "../common/constant"
import {IPFSGatewayArray} from "../../config/IPFSGateway";
import {IPFSGatewaySync} from "../IPFSGatewaySync";
import {Erc20Transfer} from "../../model/Erc20Transfer";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";
import {getMetaFromDB, requestUpdateNftMetaSafe} from "./NftMetaStorage";
import {StatApp} from "../../StatApp";

const lodash = require('lodash');
const superagent = require('superagent');
const {abi} = require('../abi/Crc1155Core');
const {put,get, clear} = require('./MetaInfoCache')

export class NFTPreviewService {
    private app;
    private cfx;
    private ipfsGatewaySet;
    private TIMEOUT_CONN = 3000;
    private TIMEOUT_READ = 3000;

    constructor(app: any) {
        this.app = app;
        this.cfx = app.cfx;
        this.ipfsGatewaySet = new Set(IPFSGatewayArray);
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
        const address = toBase32(contractAddress) as string;
        let token = await Token.findOne({attributes: ['hex40id', 'type', 'ipfsGateway'], where: {base32: address}});
        if(!token) {
            token = await this.detectTokenType(address) as Token;
        }
        if (forceFlush && token.hex40id) {
            requestUpdateNftMetaSafe(token.hex40id, tokenId.toString()).then();
        }

        let detail;
        if(withDetail){
            detail = await this.getDetailInfo({address, hex40id: token.hex40id, tokenId, type: token.type});
        }

        let nftInfo;
        try{
            const start = Date.now();
            nftInfo = await this.getNFTInfo0({address, tokenId, type: token.type, gateway: token.ipfsGateway, forceFlush});
            nftInfo.externalMs = Date.now() - start;
            lodash.assign(nftInfo, detail);
        } catch(e){
            e.partialData = lodash.assign(e.partialData, detail);
            throw e;
        }

        nftInfo.imageName.zh = Desensitizer.mosaicStr(address, nftInfo.imageName.zh);
        nftInfo.imageName.en = Desensitizer.mosaicStr(address, nftInfo.imageName.en);
        nftInfo.imageUri = Desensitizer.mosaicUri(address, nftInfo.imageUri);
        return nftInfo;
    }

    public async getNFTDetail ({
         contractAddress,
         tokenId,
         forceFlush = false,
    }: {
        contractAddress: string;
        tokenId: BigInt;
        forceFlush?: boolean;
    }): Promise<NFTInfoType> {
        return this.getNFTInfo({contractAddress, tokenId, withDetail: true, forceFlush});
    }

    private async getDetailInfo({address, hex40id, tokenId, type}){
        const hex = format.hexAddress(address);

        const sql = `select * from hex40 where id = (select \`from\` from trace_create_contract where \`to\` = (select
            id from hex40 where hex = ?));`;
        const creator = await Hex40Map.sequelize
            .query(sql, {type: QueryTypes.SELECT, replacements: [hex.substr(2)]})
            .then(hexBeanArray => {
                return hexBeanArray?.length ? toBase32(`0x${hexBeanArray[0]['hex']}`) : undefined;
            });

        const sql1 = `select * from ${NftMint.getTableName()} where contractId =(select id from hex40 where hex = ?) 
            and tokenId = ?;`;
        const minter = await NftMint.sequelize
            .query(sql1, {type: QueryTypes.SELECT, replacements: [hex.substr(2), `${tokenId}`]})
            .then(async nftMinterArray => {
                if(!nftMinterArray?.length) return undefined;
                const nftMinter = nftMinterArray[0];
                const ownerHex = await Hex40Map.findOne({where: {id: nftMinter['toId']}});
                const owner = toBase32(`0x${ownerHex['hex']}`);
                const mintTime = nftMinter['createdAt'];
                return {owner, mintTime};
            });

        let owner;
        if(type === CONST.TRANSFER_TYPE.ERC721){
            const ownerId = await Erc721Transfer.findOne({
                where: {contractId: hex40id, tokenId: `${tokenId}`},
                order: [['epoch', 'DESC']],
                limit: 1,
                raw: true
            }).then(item => item.toId);
            const ownerHex = await Hex40Map.findOne({where: {id: ownerId}});
            owner = toBase32(`0x${ownerHex['hex']}`);
        }

        return {creator, ... minter, owner, type};
    }

    private async getNFTInfo0 ({
        address,
        tokenId,
        type,
        gateway,
        forceFlush = false,
    }: {
        address: string;
        tokenId: BigInt;
        type: string;
        gateway: string;
        forceFlush?: boolean;
    }): Promise<NFTInfoType> {
        const tokenBasic = { address, tokenId, gateway, forceFlush };
        switch (address) {
            case NFTMap.confluxGuardian.address:
                return { imageMinHeight: 200, imageName: await this.getNFTName({ address }),
                    imageUri: 'https://cdn.image.htlm8.top/guardian/nft.png'};
            case NFTMap.conDragonStone.address:
                return { imageMinHeight: 200, imageName: await this.getNFTName({ address }),
                    imageUri: 'https://cdn.image.htlm8.top/dragon-stone/dragon-stone.png' };
            case NFTMap.satoshiGift.address:
                return { imageMinHeight: 282, imageName: await this.getNFTName({ address }),
                    imageUri: 'https://cdn.image.htlm8.top/pizza-day/nft.png' };
            case NFTMap.shanhaichingSeriesCard.address:
                return { imageMinHeight: 267, imageName: await this.getNFTName({ address }),
                    imageUri: 'https://metadata.boxnft.io/nftbox.gif' };
            case NFTMap.shuttleflowBscNft.address:
                return { imageMinHeight: 200, imageName: await this.getNFTName({ address }),
                    imageUri: 'https://cdn.image.htlm8.top/bsc-shuttleflow-nft/nft.png' };
            case NFTMap.crossChainNftGloryEdition.address:
                return { imageMinHeight: 200, imageName: await this.getNFTName({ address }),
                    imageUri: 'https://cdn.image.htlm8.top/flux-shuttleflow-nft/nft.jpg' };
            case NFTMap.happyBirthdayToConfi.address:
                return { imageMinHeight: 50, imageName: await this.getNFTName({ address }),
                    imageUri: 'https://cdn.image.htlm8.top/confi-birthday-nft/nft.png' };
            case NFTMap.OKExNft.address:
                return { imageMinHeight: 200, imageName: await this.getNFTName({ address }),
                    imageUri: 'https://cdn.image.htlm8.top/okex-listing-nft/okex-listing-nft.gif' };
            case NFTMap.honorOfPractitioner.address:
                return { imageMinHeight: 288, imageName: await this.getNFTName({ address }),
                    imageUri: 'https://cdn.image.htlm8.top/practitioner/nft.png' };
            case NFTMap.confiOfSchrodinger.address:
                return { imageMinHeight: 150, imageName: await this.getNFTName({ address }),
                    imageUri: 'https://cj.yzbbanban.com/purplerr.jpeg' };

            case NFTMap.conDragon.address:
                return this.getNFTImage(tokenBasic);
            case NFTMap.confiCard.address:
                return this.getNFTImage(lodash.defaults(tokenBasic, { height: 328 }));
            case NFTMap.ancientChineseGod.address:
            case NFTMap.ancientChineseGodGenesis.address:
                return this.getNFTImage(lodash.defaults(tokenBasic, { height: 377 }));
            case NFTMap.moonswapGenesis.address:
                return this.getNFTImage(lodash.defaults(tokenBasic, { height: 150 }));
            case NFTMap.conHero.address:
                return this.getNFTImage(lodash.defaults(tokenBasic, { height: 267 }));
            case NFTMap.shanhaijing.address:
                return this.getNFTImage(lodash.defaults(tokenBasic, { height: 267 }));
            case NFTMap.threeKingdoms.address:
                return this.getNFTImage(lodash.defaults(tokenBasic, { height: 286 }));

            case NFTMap.TREAGenesisFeitian.address:
                return this.getNFTImage(lodash.defaults(tokenBasic, { height: 200, method: 'uris',
                    uriFormatter: meta => meta.image }));
            case NFTMap.confi.address:
                return this.getNFTImage(lodash.defaults(tokenBasic, { method: 'uris',
                    uriFormatter: meta => 'http://cdn.tspace.online/image/finish/' + meta.url }));
            default:
                let result;
                if(type === CONST.TRANSFER_TYPE.ERC721){
                    result = await this.getNFTImage(lodash.defaults(tokenBasic, { method: 'tokenURI'}));
                }
                if(type === CONST.TRANSFER_TYPE.ERC1155){
                    result =  await this.getNFTImage(tokenBasic);
                }
                return result;
        }
    };

    // get NFT name
    private async getNFTName ({
         address,
         meta,
    }: {
         address: string;
         meta?: any;
    }) {
        let nftName;
        try {
            switch (address) {
                case NFTMap.confi.address:
                    nftName = NFTNames.confi[meta.title.split('_')[0]];
                    break;
                case NFTMap.confiCard.address:
                    nftName = {
                        zh: meta.name,
                        en: meta.name,
                    };
                    break;
                case NFTMap.conDragon.address:
                    nftName = {
                        zh: meta.name,
                        en: meta.name_en,
                    };
                    break;
                case NFTMap.confluxGuardian.address:
                    nftName = {
                        zh: '守护者勋章',
                        en: 'Guardian',
                    };
                    break;
                case NFTMap.ancientChineseGod.address:
                case NFTMap.ancientChineseGodGenesis.address:
                    const zhUri = meta.localization.uri.replace(
                        '{locale}',
                        'zh-cn',
                    );
                    const response = await superagent.get(zhUri);
                    const responseObj = JSON.parse(response.text);
                    nftName = {
                        zh: responseObj.name,
                        en: meta.name,
                    };
                    break;
                case NFTMap.moonswapGenesis.address:
                    nftName = {
                        zh: '创世 NFT',
                        en: 'Genesis NFT',
                    };
                    break;
                case NFTMap.conHero.address:
                    nftName = {
                        zh: meta.name,
                        en: meta.name_en,
                    };
                    break;
                case NFTMap.conDragonStone.address:
                    nftName = {
                        zh: '龙石',
                        en: 'Dragon Stone NFT',
                    };
                    break;
                case NFTMap.satoshiGift.address:
                    nftName = {
                        zh: "Satoshi's gift",
                        en: "Satoshi's gift",
                    };
                    break;
                case NFTMap.shanhaijing.address:
                    nftName = {
                        zh: meta.name,
                        en: meta.name,
                    };
                    break;
                case NFTMap.shanhaichingSeriesCard.address:
                    nftName = {
                        zh: '山海经卡包',
                        en: 'Shanhaiching Series Card Pack',
                    };
                    break;
                case NFTMap.shuttleflowBscNft.address:
                    nftName = {
                        zh: 'ShuttleFlow-BSC NFT',
                        en: 'ShuttleFlow-BSC NFT',
                    };
                    break;
                case NFTMap.crossChainNftGloryEdition.address:
                    nftName = {
                        zh: '荣耀版跨链NFT',
                        en: 'Cross-Chain NFT / Glory Edition',
                    };
                    break;
                case NFTMap.happyBirthdayToConfi.address:
                    nftName = {
                        zh: 'Happy Birthday to ConFi',
                        en: 'Happy Birthday to ConFi',
                    };
                    break;
                case NFTMap.TREAGenesisFeitian.address:
                    nftName = {
                        zh: 'TREA 创世飞天',
                        en: 'TREA Genesis Feitian',
                    };
                    break;
                case NFTMap.OKExNft.address:
                    nftName = {
                        zh: 'OKEx NFT',
                        en: 'OKEx NFT',
                    };
                    break;
                case NFTMap.honorOfPractitioner.address:
                    nftName = {
                        zh: '践行者计划',
                        en: 'Honor of Practitioner',
                    };
                    break;
                case NFTMap.confiOfSchrodinger.address:
                    nftName = {
                        zh: '薛定谔的盒',
                        en: 'Confi of Schrodinger',
                    };
                    break;
                case NFTMap.threeKingdoms.address:
                    nftName = {
                        zh: meta.name,
                        en: meta.name,
                    };
                    break;
                case NFTMap.epiKProtocolKnowledgeBadge.address:
                    nftName = {
                        zh: meta.data.title,
                        en: meta.data.title,
                    };
                    break;
                default:
                    if (meta?.name) {
                        nftName = { en: meta.name };
                        let zh;
                        if (meta?.localization?.uri) { // try 1155
                            const zhUri = meta.localization.uri.replace('{locale}', 'zh-cn');
                            const response = await superagent.get(zhUri)
                                .timeout({response: this.TIMEOUT_CONN, deadline: this.TIMEOUT_READ})
                                .catch(e => {throw new Errors.QueryNFTLocalNameError(`${zhUri} ${e.message}`)});
                            const responseObj = JSON.parse(response.text);
                            zh = responseObj.name;
                        }
                        nftName = lodash.assign(nftName, {zh: zh ? zh : meta.name});
                    }
            }
        } catch (e) {
        }
        return nftName;
    };

    private async getNFTImage({
        address,
        tokenId,
        gateway,
        method = 'uri',
        height = 200,
        uriFormatter,
        forceFlush = false
    }: {
        address: string,
        tokenId: BigInt,
        gateway?: string,
        method?: string,
        height?: number,
        uriFormatter?: any,
        forceFlush?: boolean
    }): Promise<NFTInfoType> {
        const err = {contract: StatApp.isEVM ? format.hexAddress(address) : address, tokenId};
        let rawUrl;
        let gatewayUrl;
        let rawMeta;
        let meta;
        let imageUri;
        let imageName;
        let imageDesc;

        try {
            const nftObj = this.getNFTCacheInfo({ address, tokenId });
            if (!forceFlush && nftObj) {
                const cacheInfo = {imageMinHeight: height};
                return lodash.assign(cacheInfo, lodash.pick(nftObj, ['imageUri', 'imageName', 'imageDesc', 'detail']));
            }
            if (!forceFlush) {
                const {uri: dbUri, content, status: dbStatus} = await getMetaFromDB(address, tokenId.toString());
                if (dbStatus === 'ok') {
                    rawUrl = dbUri;
                    rawMeta = content;
                    gatewayUrl = this.replaceGateway({gateway, rawUrl});
                }
            }
            if (!rawUrl){ // rawUrl is set when hit meta in db
                // get uri
                const contract = await this.cfx.Contract({abi, address});
                rawUrl = await contract[method](tokenId)
                .catch(e => { throw new Errors.CallNFTContractError(
                    JSON.stringify(lodash.assign(err, { message: `call contract method ${method}(${tokenId}) occurs ${e.message}`}))
                )});
                rawUrl = rawUrl.indexOf('{id}') > -1 ? rawUrl.replace('{id}', tokenId.toString(16)) : rawUrl;
                gatewayUrl = this.replaceGateway({gateway, rawUrl});

                // get metadata
                if (uriFormatter) {
                    rawMeta = gatewayUrl;
                } else if ((typeof gatewayUrl === 'string') && gatewayUrl.startsWith('data:application/json;base64')) {
                    rawMeta = Buffer.from(gatewayUrl.substr(29), 'base64').toString();
                } else {
                    const resp = await superagent.get(gatewayUrl)
                    .timeout({response: this.TIMEOUT_CONN, deadline: this.TIMEOUT_READ})
                    .catch(e => {throw new Errors.QueryNFTMetadataError(
                        JSON.stringify(lodash.assign(err, {message: `request third-party tokenURI ${gatewayUrl} occurs ${e.message}, try again later`}))
                    )});
                    rawMeta = resp.text;
                }
            }
            try{
                rawMeta = JSON.parse(rawMeta);
            }catch (e) {
                throw new Errors.ParseNFTMetadataError(
                    JSON.stringify(lodash.assign(err, {message: `parse metadata of NFT occurs ${e.message}`}))
                );
            }
            meta = {...rawMeta};

            // build resp
            lodash.defaults(meta, {image: meta.Image, name: meta.Name, description: meta.Description});
            imageUri = uriFormatter ? uriFormatter(meta) : meta.image;
            imageUri = this.replaceGateway({gateway, rawUrl: imageUri});
            imageName = await this.getNFTName({address, meta}) || {};
            imageDesc = meta.description;
            if(!imageUri) throw new Errors.MetadataPropertyError(
                JSON.stringify(lodash.assign(err, {message: `no image field in metadata of NFT,  meta is ${JSON.stringify(meta)}`}))
            );
            if(!imageName) throw new Errors.MetadataPropertyError(
                JSON.stringify(lodash.assign(err, {message: `no name field in metadata of NFT,  meta is ${JSON.stringify(meta)}`}))
            );

        } catch (e) {
            if(e.code === undefined) {
                e = new Errors.QueryNFTError(e?.message?.substr(0, 255));
            }
            e.partialData = this.buildNFTPreview({imageUri, imageName, imageDesc,
                method, tokenId, rawUrl, gatewayUrl, rawMeta});
            throw e;
        }

        const preview = this.buildNFTPreview({imageUri, imageName, imageDesc, imageHeight: height,
            method, tokenId, rawUrl, gatewayUrl, rawMeta});
        this.setNFTCacheInfo({address, tokenId, imageUri, imageName, imageDesc, detail: preview.detail});
        return preview;
    };

    private buildNFTPreview({imageUri, imageName, imageDesc, imageHeight = undefined,
        method, tokenId, rawUrl, gatewayUrl, rawMeta}){
        const  detail = {
            funcCall: `${method}(${tokenId})`,
            tokenUri: {raw: rawUrl, gateway: gatewayUrl !== rawUrl ? gatewayUrl : ''},
            metadata: rawMeta
        };

        return { imageUri, imageName, imageDesc,imageMinHeight: imageHeight, detail};
    }

    private getNFTCacheInfo({ address, tokenId}:
        { address: string, tokenId: BigInt }
    ) {
        const nftJson = get(address, tokenId)
        if (nftJson) {
            const nftObj = JSON.parse(nftJson);
            if (nftObj.timeout > +new Date()) {
                return nftObj;
            } else {
                clear(address, tokenId)
                return null;
            }
        }
        return null;
    };

    private setNFTCacheInfo({address, tokenId, imageUri, imageName, imageDesc, detail}:
        { address: string, tokenId: BigInt, imageUri?: string, imageName?: any, imageDesc?: any, detail?: any }
    ) {
        if (imageUri) {
            put(address, tokenId,
                JSON.stringify({
                    address, tokenId, imageUri, imageName, imageDesc, detail, timeout: +new Date() + 1000 * 60 * 3
                }));
        }
    };

    private replaceGateway({gateway, rawUrl}){
        const {
            app: {config},
        } = this;

        if (!rawUrl?.startsWith('ipfs://')) {
            return rawUrl;
        }

        let uri = `https://ipfs.io/ipfs/${rawUrl.substr(7)}`;

        if (gateway) {
            const uriSegments = gateway.split("//");
            const usable = uriSegments?.length > 1 && this.ipfsGatewaySet.has(uriSegments[1]);
            if (usable) {
                uri = `${gateway.endsWith('/') ? gateway.substr(0, gateway.length - 1) : gateway}/ipfs/${rawUrl.substr(7)}`;
            }
        }

        const detectGateway = IPFSGatewaySync.fastest;
        if (config.syncIPFSGateway && detectGateway) {
            const index0 = uri.indexOf('//') + 2;
            const index1 = uri.indexOf('/ipfs/');
            uri = `${uri.substr(0, index0)}${detectGateway}${uri.substr(index1, uri.length)}`
        }

        return uri;
    }

    private async detectTokenType(base32){
        const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(base32).substr(2)}});
        const hex40id = hex40?.id;

        let [transfer20, transfer721, transfer1155] = await Promise.all([
            Erc20Transfer.findOne({ where: { contractId: hex40id }}),
            Erc721Transfer.findOne({ where: { contractId: hex40id }}),
            Erc1155Transfer.findOne({ where: { contractId: hex40id }}),
        ]);

        let type;
        if(transfer20)  type = CONST.TRANSFER_TYPE.ERC20;
        if(transfer721)  type = CONST.TRANSFER_TYPE.ERC721;
        if(transfer1155)  type = CONST.TRANSFER_TYPE.ERC1155;
        return {hex40id, type};
    }
}

export type NFTInfoType = {
    imageMinHeight?: number;
    imageUri?: string;
    imageName?: any;
    imageDesc?: any;
    detail?:any;
    code?: number;
    error?: any;
    externalMs?: number;
} | null;
