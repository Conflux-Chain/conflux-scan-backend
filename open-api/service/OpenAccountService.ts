import {StatApp} from "../../stat/StatApp";
import {format} from "js-conflux-sdk";
import {
    checkPresent, formatPrice,
    mustBeAddressParamIfPresent,
    mustBeEnumParamArrayIfPresent,
    mustBeEnumParamIfPresent
} from "../../stat/service/common/utils";
import {BalanceService} from "../../stat/service/watcher/BalanceService";
import {setBody} from "../router/middleware";
import {getApiService} from "../ApiServer";
import {TokenQuery} from "../../stat/service/TokenQuery";

const lodash = require('lodash');
const TAG_NATIVE = 'native'

/**
 * Query asserts hold by one account/address.
 * @param ctx
 */
export async function listAccountAssets(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'account')
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC'])
    mustBeEnumParamArrayIfPresent(ctx.request.query, 'tokenType', StatApp.isEVM ? ['ERC20', 'ERC721', 'ERC1155', TAG_NATIVE] : ['CRC20', 'CRC721', 'CRC1155', TAG_NATIVE])

    const {account, tokenType} = ctx.request.query;
    checkPresent({account}, ['account']);

    const assets = await BalanceService.listAccountBalanceInner(account, tokenType)
    await polishAssertList(account, assets, tokenType)
    setBody(ctx, assets)
}

async function polishAssertList(account, page, tokenType) {
    let wrappedCfx
    page?.list?.forEach(row=>{
        row.amount = row.balance
        row.contract = row.base32
        fixIconUrl(row, 'base32')
        if (StatApp.isEVM) {
            row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;
        } else{
            row.type = row.type?.replace('ERC', 'CRC')
        }
        if(row.base32 === TokenQuery.wrappedCFXAddr) {
            wrappedCfx = row;
        }
        delete row.tokenHex40id;
        delete row.balance
        delete row.base32
    })

    if(!tokenType?.length || lodash.includes(tokenType, TAG_NATIVE)) {
        const acc = await getApiService().cfx.getAccount(account);
        if(BigInt(acc.balance) > BigInt(0)
            || (StatApp.isEVM ? false : BigInt(acc.stakingBalance) > BigInt(0))) {
            const cfx = {
                name: 'Conflux Network Token',
                symbol: 'CFX',
                decimals: 18,
                type: TAG_NATIVE,
                iconUrl: TokenQuery.wrappedCFX?.iconUrl,
                priceInUSDT: wrappedCfx?.price || formatPrice(TokenQuery.wrappedCFX?.price),
                quoteUrl: TokenQuery.wrappedCFX?.quoteUrl,
                amount: acc.balance,
                stakingAmount: StatApp.isEVM ? undefined : acc.stakingBalance,
            };
            page?.list?.unshift(cfx);
        }
    }

    delete page?.candidate
}

export function fixIconUrl(row, addressKey) {
    if (!row.iconUrl) {
        delete row.iconUrl
        return
    }

    if (row.iconUrl.startsWith('https://')) {
        // it's ok
    } else if (row.iconUrl.startsWith('http://')) {
        // it's ok, too.
    }else {// without prefix
        if (row[addressKey].startsWith('cfx:')) { // mainnet
            row.iconUrl = 'https://confluxscan.io/stat/' + row.iconUrl
        } else if (row[addressKey].startsWith('cfxtest:')) { // testnet
            row.iconUrl = 'https://testnet.confluxscan.io/stat/' + row.iconUrl
        }
    }
}
