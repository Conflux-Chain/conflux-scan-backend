import {StatApp} from "../../stat/StatApp";
import {format} from "js-conflux-sdk";
import {checkPresent, mustBeAddressParamIfPresent, mustBeEnumParamIfPresent} from "../../stat/service/common/utils";
import {BalanceService} from "../../stat/service/watcher/BalanceService";
import {setBody} from "../router/middleware";

/**
 * Query asserts hold by one account/address.
 * @param ctx
 */
export async function listAccountAssets(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'account')
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC'])

    const {account} = ctx.request.query;
    checkPresent({account}, ['account']);

    const assets = await BalanceService.listAccountBalanceInner(account)
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