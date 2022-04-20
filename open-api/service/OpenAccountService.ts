import {StatApp} from "../../stat/StatApp";
import {format} from "js-conflux-sdk";
import {mustBeAddressParamIfPresent, mustBeEnumParamIfPresent} from "../../stat/service/common/utils";
import {BalanceService} from "../../stat/service/watcher/BalanceService";
import {setBody} from "../router/middleware";

/**
 * Query asserts hold by one account/address.
 * @param ctx
 */
export async function listAccountAssets(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'account')
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC'])
    const {account: base32} = ctx.request.query;
    // if (!Boolean(base32)) {
    //     setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
    //     return
    // }
    const assets = await BalanceService.listAccountBalanceInner(base32)
    polishAssertList(assets)
    setBody(ctx, assets)
}

export function polishAssertList(page) {
    page?.list?.forEach(row=>{
        row.amount = row.balance
        row.type = row.type?.replace('ERC', 'CRC')
        row.contract = row.base32
        fixIconUrl(row, 'base32')
        delete row.tokenHex40id;
        delete row.balance
        delete row.base32

        if (StatApp.isEVM) {
            row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;
        }
    })
    delete page?.candidate
}

export function fixIconUrl(row, addressKey) {
    if (row.iconUrl) {
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
}