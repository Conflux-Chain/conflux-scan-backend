import { NFTMap, NFTNames } from './NFTInfo';
import {toBase32} from "../tool/AddressTool";
import {Desensitizer} from "../Desensitizer";
import {NftMint, Token} from "../../model/Token";
import {Hex40Map} from "../../model/HexMap";
import {format} from "js-conflux-sdk";
import {QueryTypes} from "sequelize";

const lodash = require('lodash');
const superagent = require('superagent');
const {abi} = require('../abi/Crc1155Core');
const {put,get, clear} = require('./MetaInfoCache')
const CONST = require('../common/constant');
export class NFTPreviewService {
    private app;
    private cfx;

    constructor(app: any) {
        this.app = app;
        this.cfx = app.cfx;
    }

    public async getNFTInfo ({
        contractAddress,
        tokenId
    }: {
        contractAddress: string;
        tokenId: BigInt;
    }): Promise<NFTInfoType> {
        const address = toBase32(contractAddress) as string;
        const nftInfo = await this.getNFTInfo0({contractAddress: address, tokenId});

        if(!nftInfo || nftInfo.error) {
            return nftInfo;
        }

        nftInfo.imageName.zh = Desensitizer.mosaicStr(address, nftInfo.imageName.zh);
        nftInfo.imageName.en = Desensitizer.mosaicStr(address, nftInfo.imageName.en);
        nftInfo.imageUri = Desensitizer.mosaicUri(address, nftInfo.imageUri);
        return nftInfo;
    }

    public async getNFTDetail ({
         contractAddress,
         tokenId
    }: {
        contractAddress: string;
        tokenId: BigInt;
    }): Promise<NFTInfoType> {
        const address = toBase32(contractAddress) as string;
        const nftInfo = await this.getNFTInfo0({contractAddress: address, tokenId});

        const sql = `select * from hex40 where id = (select \`from\` from trace_create_contract where \`to\` = (select
            id from hex40 where hex = ?));`;
        const hex = format.hexAddress(address);
        const creator = await Hex40Map.sequelize
            .query(sql, {type: QueryTypes.SELECT, replacements: [hex.substr(2)]})
            .then(hexBeanArray => {
                return hexBeanArray?.length ? toBase32(`0x${hexBeanArray[0]['hex']}`) : undefined;
            });

        const sql1 = `select * from ${NftMint.getTableName()} where contractId =(select id from hex40 where hex = ?) and tokenId = ?;`;
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

        const type = await Token.findOne({attributes: ['type'], where: {base32: address}})
            .then(token => {return token.type});
        lodash.assign(nftInfo, {creator, ... minter, type});

        if(!nftInfo || nftInfo.error) {
            return nftInfo;
        }

        nftInfo.imageName.zh = Desensitizer.mosaicStr(address, nftInfo.imageName.zh);
        nftInfo.imageName.en = Desensitizer.mosaicStr(address, nftInfo.imageName.en);
        nftInfo.imageUri = Desensitizer.mosaicUri(address, nftInfo.imageUri);
        return nftInfo;
    }

    private async getNFTInfo0 ({
        contractAddress,
        tokenId,
    }: {
        contractAddress: string;
        tokenId: BigInt;
    }): Promise<NFTInfoType> {
        const address = toBase32(contractAddress) as string;
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
                return this.getNFTImage({ address, tokenId });
            case NFTMap.confiCard.address:
                return this.getNFTImage({ address, tokenId, height: 328 });
            case NFTMap.ancientChineseGod.address:
            case NFTMap.ancientChineseGodGenesis.address:
                return this.getNFTImage({ address, tokenId, height: 377 });
            case NFTMap.moonswapGenesis.address:
                return this.getNFTImage({ address, tokenId, height: 150 });
            case NFTMap.conHero.address:
                return this.getNFTImage({ address, tokenId, height: 267 });
            case NFTMap.shanhaijing.address:
                return this.getNFTImage({ address, tokenId, height: 267 });
            case NFTMap.threeKingdoms.address:
                return this.getNFTImage({ address, tokenId, height: 286 });

            case NFTMap.epiKProtocolKnowledgeBadge.address:
                return this.getNFTImage({ address, tokenId, height: 200,
                    uriFormatter: meta => meta.data.page_url });
            case NFTMap.TREAGenesisFeitian.address:
                return this.getNFTImage({ address, tokenId,  height: 200, method: 'uris', fetchJson: false,
                    uriFormatter: meta => meta.image });
            case NFTMap.confi.address:
                return this.getNFTImage({ address, tokenId, method: 'uris', fetchJson: false,
                    uriFormatter: meta => 'http://cdn.tspace.online/image/finish/' + meta.url });
            default:
                let result;
                const token = await Token.findOne({attributes: ['type'], where: {base32: address}});
                if(token?.type === CONST.TRANSFER_TYPE.ERC721){
                    result = await this.getNFTImage({ address, tokenId, method: 'tokenURI'});
                }
                if(token?.type === CONST.TRANSFER_TYPE.ERC1155){
                    result =  await this.getNFTImage({ address, tokenId });
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
                            const response = await superagent.get(zhUri);
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

    private async getNFTImage({address, tokenId, method = 'uri', height = 200, fetchJson = true, uriFormatter}:
        { address: string, tokenId: BigInt, method?: string, height?: number, fetchJson?: boolean, uriFormatter?: any}
    ): Promise<NFTInfoType> {
        let url;
        let meta;
        let imageUri;
        let imageName;
        let imageDesc;
        let detail;
        let error;
        try {
            const nftObj = this.getNFTCacheInfo({ address, tokenId });
            if (nftObj) {
                const cacheInfo = {imageMinHeight: height};
                return lodash.assign(cacheInfo, lodash.pick(nftObj, ['imageUri', 'imageName', 'imageDesc', 'detail']));
            }

            // get uri
            const contract = await this.cfx.Contract({ abi, address });
            url = await contract[method](tokenId);

            // support loot
            if((typeof url === 'string') && url.startsWith('data:application/json;base64')){
                meta = JSON.parse(Buffer.from(url.substr(29), 'base64').toString());
                imageUri = meta.image;
                imageName = await this.getNFTName({address, meta}) || {};
            } else{

                // process uri
                try {
                    url = JSON.parse(url);
                } catch (e){
                }
                if (fetchJson) {
                    url = url.indexOf('{id}') > -1 ? url.replace('{id}', tokenId.toString(16)) : url;
                    url = this.replaceGateway(url);

                    // fetch meta data
                    const response = await superagent.get(url);
                    meta = JSON.parse(response.text);
                    if(meta.Image) meta.image = meta.Image;
                    if(meta.Name) meta.name = meta.Name;
                } else{
                    meta = url;
                }

                // build resp
                imageUri = uriFormatter ? uriFormatter(meta) : fetchJson ? meta.image : meta;
                imageUri = this.replaceGateway(imageUri);
                imageName = await this.getNFTName({address, meta}) || {};
            }
            imageDesc = meta?.description;

            if(!imageUri) throw new Error('image not found');
            if(!imageName) throw new Error('name not found');
        } catch (e) {
            error = e?.message?.substr(0, 50);
        } finally {
            detail = { funcCall: `${method}(${tokenId})`, tokenUri: url, metadata: meta };
            !error && this.setNFTCacheInfo({address, tokenId, imageUri, imageName, imageDesc, detail});
        }

        return {
            imageMinHeight: error ? undefined : height,
            imageUri,
            imageName,
            imageDesc,
            error,
            detail,
        };
    };

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
                    address, tokenId, imageUri, imageName, imageDesc, detail, timeout: +new Date() + 1000 * 60 * 60
                }));
        }
    };

    private replaceGateway(imageUri){
        let uri = imageUri;
        if(uri?.startsWith('ipfs://')) {
            uri = `https://ipfs.io/ipfs/${uri.substr(7)}`;
        }
        if(uri?.startsWith('https://gateway.pinata.cloud')){
            uri = `https://ipfs.io/ipfs/${uri.substr(34)}`;
        }
        return uri;
    }
}

export type NFTInfoType = {
    imageMinHeight: number;
    imageUri: string;
    imageName: any;
    imageDesc?: any;
    detail?:any;
    error?: any;
} | null;
