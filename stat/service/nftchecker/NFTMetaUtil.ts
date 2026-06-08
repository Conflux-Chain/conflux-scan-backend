import {Errors} from "../common/LogicError";
import {abi} from "../abi/Crc1155Core";
import {IPFSGatewaySync} from "../IPFSGatewaySync";
import {safeFetch} from "../common/security/safeFetch";
import {fmtAddr, StatApp} from "../../StatApp";
import {CONST} from "../common/constant";

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

export function normalizeIpfsURI(rawURI: string, userGateway: string): string {
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

export const LEGACY_NFTS = {
    'cfx:ach7c9fr2skv5fft98cygac0g93999z1refedecnn1': {
        imageName: {
            zh: '守护者勋章',
            en: 'Guardian',
        },
        imageUri: 'https://cdn.image.htlm8.top/guardian/nft.png'
    },
}

export const LEGACY_NFT_URIS = {
    'cfx:accfeg3rcm430khhbz09r4t38aswm5u9dezucjxjcf': "uris",
    'cfx:acc370g3s6d56ndcp8t6gyc657rhtp0fz6ytc8j9d2': "uris",
}

export const LEGACY_NFT_NAMES = {
    'cfx:acc370g3s6d56ndcp8t6gyc657rhtp0fz6ytc8j9d2': (meta) => {
        const index = meta.url.split('_')[0];
        switch (index) {
            case '001':
                return {
                    en: 'ConFiActor',
                    zh: '明星烤仔',
                }
            case  '002':
                return {
                    en: 'ConFi & ConKi',
                    zh: '烤仔与烤喵',
                }
            case '003':
                return {
                    en: 'ConFiAngel',
                    zh: '天使烤仔',
                }
            case '004':
                return {
                    en: 'ConFiDemon',
                    zh: '恶魔烤仔',
                }
            case '005':
                return {
                    en: 'ConFiMiner',
                    zh: '矿工烤仔',
                }
            case '006':
                return {
                    en: 'ConFiMouse',
                    zh: '金鼠烤仔',
                }
            case '007':
                return {
                    en: 'ConFiPhD',
                    zh: '博士烤仔',
                }
            case '008':
                return {
                    en: 'ConFiRapper',
                    zh: '嘻哈烤仔',
                }
            default:
                throw new Error("NFT name not found")
        }
    },
}

export const LEGACY_NFT_IMAGES = {
    'cfx:acc370g3s6d56ndcp8t6gyc657rhtp0fz6ytc8j9d2': (meta) => {
        return 'http://cdn.tspace.online/image/finish/' + meta.url
    },
}
