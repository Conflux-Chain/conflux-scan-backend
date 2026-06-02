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
