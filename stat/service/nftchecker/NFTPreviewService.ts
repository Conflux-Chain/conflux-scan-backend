// get NFT cache info from localStorage
import { NFTMap, NFTNames } from './NFTInfo';
import {toBase32} from "../tool/AddressTool";
import {Desensitizer} from "../Desensitizer";
import {Token} from "../../model/Token";

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
                return this.getNFTImage({ address, tokenId, minHeight: 328 });
            case NFTMap.ancientChineseGod.address:
            case NFTMap.ancientChineseGodGenesis.address:
                return this.getNFTImage({ address, tokenId, minHeight: 377 });
            case NFTMap.moonswapGenesis.address:
                return this.getNFTImage({ address, tokenId, minHeight: 150 });
            case NFTMap.conHero.address:
                return this.getNFTImage({ address, tokenId, minHeight: 267 });
            case NFTMap.shanhaijing.address:
                return this.getNFTImage({ address, tokenId, minHeight: 267 });
            case NFTMap.threeKingdoms.address:
                return this.getNFTImage({ address, tokenId, minHeight: 286 });

            case NFTMap.epiKProtocolKnowledgeBadge.address:
                return this.getNFTImage({ address, tokenId, minHeight: 200,
                    imageUriFormatter: meta => meta.data.page_url });
            case NFTMap.TREAGenesisFeitian.address:
                return this.getNFTImage({ address, tokenId,  minHeight: 200, method: 'uris', needFetchJson: false,
                    imageUriFormatter: meta => meta.image });
            case NFTMap.confi.address:
                return this.getNFTImage({ address, tokenId, method: 'uris', needFetchJson: false,
                    imageUriFormatter: meta => 'http://cdn.tspace.online/image/finish/' + meta.url });
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
                    nftName = NFTNames.confi[JSON.parse(meta).title.split('_')[0]];
                case NFTMap.confiCard.address:
                    nftName = {
                        zh: meta.name,
                        en: meta.name,
                    };
                case NFTMap.conDragon.address:
                    nftName = {
                        zh: meta.name,
                        en: meta.name_en,
                    };
                case NFTMap.confluxGuardian.address:
                    nftName = {
                        zh: '守护者勋章',
                        en: 'Guardian',
                    };
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
                case NFTMap.moonswapGenesis.address:
                    nftName = {
                        zh: '创世 NFT',
                        en: 'Genesis NFT',
                    };
                case NFTMap.conHero.address:
                    nftName = {
                        zh: meta.name,
                        en: meta.name_en,
                    };
                case NFTMap.conDragonStone.address:
                    nftName = {
                        zh: '龙石',
                        en: 'Dragon Stone NFT',
                    };
                case NFTMap.satoshiGift.address:
                    nftName = {
                        zh: "Satoshi's gift",
                        en: "Satoshi's gift",
                    };
                case NFTMap.shanhaijing.address:
                    nftName = {
                        zh: meta.name,
                        en: meta.name,
                    };
                case NFTMap.shanhaichingSeriesCard.address:
                    nftName = {
                        zh: '山海经卡包',
                        en: 'Shanhaiching Series Card Pack',
                    };
                case NFTMap.shuttleflowBscNft.address:
                    nftName = {
                        zh: 'ShuttleFlow-BSC NFT',
                        en: 'ShuttleFlow-BSC NFT',
                    };
                case NFTMap.crossChainNftGloryEdition.address:
                    nftName = {
                        zh: '荣耀版跨链NFT',
                        en: 'Cross-Chain NFT / Glory Edition',
                    };
                case NFTMap.happyBirthdayToConfi.address:
                    nftName = {
                        zh: 'Happy Birthday to ConFi',
                        en: 'Happy Birthday to ConFi',
                    };
                case NFTMap.TREAGenesisFeitian.address:
                    nftName = {
                        zh: 'TREA 创世飞天',
                        en: 'TREA Genesis Feitian',
                    };
                case NFTMap.OKExNft.address:
                    nftName = {
                        zh: 'OKEx NFT',
                        en: 'OKEx NFT',
                    };
                case NFTMap.honorOfPractitioner.address:
                    nftName = {
                        zh: '践行者计划',
                        en: 'Honor of Practitioner',
                    };
                case NFTMap.confiOfSchrodinger.address:
                    nftName = {
                        zh: '薛定谔的盒',
                        en: 'Confi of Schrodinger',
                    };
                case NFTMap.threeKingdoms.address:
                    nftName = {
                        zh: meta.name,
                        en: meta.name,
                    };
                case NFTMap.epiKProtocolKnowledgeBadge.address:
                    nftName = {
                        zh: meta.data.title,
                        en: meta.data.title,
                    };
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

    private async getNFTImage({address, tokenId, method = 'uri', minHeight = 200, needFetchJson = true, imageUriFormatter}:
        { address: string, tokenId: BigInt, method?: string, minHeight?: number, needFetchJson?: boolean, imageUriFormatter?: any}
    ): Promise<NFTInfoType> {
        let url;
        let meta;
        let imageUri;
        let imageName;
        let imageDesc;
        let error;
        try {
            const nftObj = this.getNFTCacheInfo({ address, tokenId });
            if (nftObj) {
                return {imageMinHeight: minHeight, imageUri: nftObj.imageUri, imageName: nftObj.imageName || {}, imageDesc: nftObj.imageDesc};
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
                if (needFetchJson) {
                    url = url.indexOf('{id}') > -1 ? url.replace('{id}', tokenId.toString(16)) : url;
                    url = url.startsWith('ipfs://') ? this.replaceIPFSGateway(url) : url;

                    // fetch meta data
                    const response = await superagent.get(url);
                    meta = JSON.parse(response.text);
                    if(meta.Image) meta.image = meta.Image;
                    if(meta.Name) meta.name = meta.Name;
                }

                // build resp
                imageUri = imageUriFormatter ? imageUriFormatter(meta) : needFetchJson ? meta.image : meta;
                imageUri = imageUri?.startsWith('ipfs://') ? this.replaceIPFSGateway(imageUri) : imageUri;
                imageUri = imageUri?.startsWith('https://gateway.pinata.cloud') ? this.replacePinataGateway(imageUri) : imageUri;
                imageName = await this.getNFTName({address, meta}) || {};
            }
            imageDesc = meta.description;

            if(!imageUri) throw new Error('image not found');
            if(!imageName) throw new Error('name not found');
            this.setNFTCacheInfo({ address, tokenId, imageUri, imageName, imageDesc });
        } catch (e) {
            error = {funcCall: `${method}(${tokenId})`, metadataURI: url, metadata: meta, errorMessage: e?.message?.substr(0, 50)};
        }
        return { imageMinHeight: error ? undefined : minHeight, imageUri, imageName, imageDesc, error };
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

    private setNFTCacheInfo({address, tokenId, imageUri, imageName, imageDesc}:
        { address: string, tokenId: BigInt, imageUri?: string, imageName?: any, imageDesc?: any }
    ) {
        if (imageUri) {
            put(address, tokenId,
                JSON.stringify({address, tokenId, imageUri, imageName, imageDesc, timeout: +new Date() + 1000 * 60 * 60}));
        }
    };

    private replaceIPFSGateway(ipfsPath){
        return `https://ipfs.io/ipfs/${ipfsPath.substr(7)}`;
    }

    private replacePinataGateway(ipfsPath){
        return `https://ipfs.io/ipfs/${ipfsPath.substr(34)}`;
    }
}

export type NFTInfoType = {
    imageMinHeight: number;
    imageUri: string;
    imageName: any;
    imageDesc?: any;
    error?: any;
} | null;
