// get NFT cache info from localStorage
import { NFTMap, NFTNames } from './NFTInfo';
import {toBase32} from "../tool/AddressTool";
import {Desensitizer} from "../Desensitizer";

const lodash = require('lodash');
const superagent = require('superagent');
const {abi} = require('../abi/Crc1155Core');
const {put,get, clear} = require('./MetaInfoCache')
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
        if(!nftInfo) {
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
                // try 1155
                let result =  await this.getNFTImage({ address, tokenId });
                // try 721
                if (result === null) {
                    result = await this.getNFTImage({ address, tokenId, method: 'tokenURI'});
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
        try {
            switch (address) {
                case NFTMap.confi.address:
                    return NFTNames.confi[JSON.parse(meta).title.split('_')[0]];
                case NFTMap.confiCard.address:
                    return {
                        zh: meta.name,
                        en: meta.name,
                    };
                case NFTMap.conDragon.address:
                    return {
                        zh: meta.name,
                        en: meta.name_en,
                    };
                case NFTMap.confluxGuardian.address:
                    return {
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
                    return {
                        zh: responseObj.name,
                        en: meta.name,
                    };
                case NFTMap.moonswapGenesis.address:
                    return {
                        zh: '创世 NFT',
                        en: 'Genesis NFT',
                    };
                case NFTMap.conHero.address:
                    return {
                        zh: meta.name,
                        en: meta.name_en,
                    };
                case NFTMap.conDragonStone.address:
                    return {
                        zh: '龙石',
                        en: 'Dragon Stone NFT',
                    };
                case NFTMap.satoshiGift.address:
                    return {
                        zh: "Satoshi's gift",
                        en: "Satoshi's gift",
                    };
                case NFTMap.shanhaijing.address:
                    return {
                        zh: meta.name,
                        en: meta.name,
                    };
                case NFTMap.shanhaichingSeriesCard.address:
                    return {
                        zh: '山海经卡包',
                        en: 'Shanhaiching Series Card Pack',
                    };
                case NFTMap.shuttleflowBscNft.address:
                    return {
                        zh: 'ShuttleFlow-BSC NFT',
                        en: 'ShuttleFlow-BSC NFT',
                    };
                case NFTMap.crossChainNftGloryEdition.address:
                    return {
                        zh: '荣耀版跨链NFT',
                        en: 'Cross-Chain NFT / Glory Edition',
                    };
                case NFTMap.happyBirthdayToConfi.address:
                    return {
                        zh: 'Happy Birthday to ConFi',
                        en: 'Happy Birthday to ConFi',
                    };
                case NFTMap.TREAGenesisFeitian.address:
                    return {
                        zh: 'TREA 创世飞天',
                        en: 'TREA Genesis Feitian',
                    };
                case NFTMap.OKExNft.address:
                    return {
                        zh: 'OKEx NFT',
                        en: 'OKEx NFT',
                    };
                case NFTMap.honorOfPractitioner.address:
                    return {
                        zh: '践行者计划',
                        en: 'Honor of Practitioner',
                    };
                case NFTMap.confiOfSchrodinger.address:
                    return {
                        zh: '薛定谔的盒',
                        en: 'Confi of Schrodinger',
                    };
                case NFTMap.threeKingdoms.address:
                    return {
                        zh: meta.name,
                        en: meta.name,
                    };
                case NFTMap.epiKProtocolKnowledgeBadge.address:
                    return {
                        zh: meta.data.title,
                        en: meta.data.title,
                    };
                default:
                    // try 1155
                    if (meta) {
                        let zh;
                        if (meta?.localization?.uri) {
                            const zhUri = meta.localization.uri.replace('{locale}', 'zh-cn');
                            const response = await superagent.get(zhUri);
                            const responseObj = JSON.parse(response.text);
                            zh = responseObj.name;
                        }
                        return { zh: !zh ? meta.name : zh, en: meta.name };
                    }
                    return null;
            }
        } catch (e) {
            return null;
        }
    };

    private async getNFTImage({address, tokenId, method = 'uri', minHeight = 200, needFetchJson = true, imageUriFormatter}:
        { address: string, tokenId: BigInt, method?: string, minHeight?: number, needFetchJson?: boolean, imageUriFormatter?: any}
    ): Promise<NFTInfoType> {
        let meta;
        let imageUri;
        let imageName;
        let imageDesc;
        try {
            const nftObj = this.getNFTCacheInfo({ address, tokenId });
            if (nftObj) {
                return {imageMinHeight: minHeight, imageUri: nftObj.imageUri, imageName: nftObj.imageName || {}, imageDesc: nftObj.imageDesc};
            }

            // get uri
            const contract = await this.cfx.Contract({ abi, address });
            let url = await contract[method](tokenId);

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
                imageUri = imageUri.startsWith('ipfs://') ? this.replaceIPFSGateway(imageUri) : imageUri;
                imageUri = imageUri.startsWith('https://gateway.pinata.cloud') ? this.replacePinataGateway(imageUri) : imageUri;
                imageName = await this.getNFTName({address, meta}) || {};
            }
            imageDesc = meta.description;

            this.setNFTCacheInfo({ address, tokenId, imageUri, imageName, imageDesc });
        } catch (e) {
            return null;
        }
        return { imageMinHeight: minHeight, imageUri, imageName, imageDesc, errorMessage: meta.error };
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
    errorMessage?: any;
} | null;
