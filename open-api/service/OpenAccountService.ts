import {StatApp} from "../../stat/StatApp";
import {
    checkPresent, formatPrice,
    mustBeAddressArrayParamIfPresent,
    mustBeAddressParamIfPresent,
    mustBeEnumParamArrayIfPresent,
    mustBeIntParamIfPresent
} from "../../stat/service/common/utils";
import {setBody} from "../router/middleware";
import {getApiService} from "../ApiServer";
import {TokenQuery} from "../../stat/service/TokenQuery";
import {paginateCore} from "../../stat/router/ParamChecker";

const lodash = require('lodash');
const TAG_NATIVE = 'native'

export async function listAccountAssets(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'account')
    mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');
    mustBeEnumParamArrayIfPresent(ctx.request.query, 'tokenType', StatApp.isEVM ? ['ERC20', 'ERC721', 'ERC1155', TAG_NATIVE] : ['CRC20', 'CRC721', 'CRC1155', TAG_NATIVE])

    const {account: owner, tokenType: types} = ctx.request.query;
    let {skip, limit} = paginateCore(ctx.request.query, {limit: 100});

    checkPresent({owner}, ['owner']);

    let nativeToken
    if (!types?.length || lodash.includes(types, TAG_NATIVE)) {
        const account = await getApiService().cfx.getAccount(owner);
        if (BigInt(account.balance) > BigInt(0) || (!StatApp.isEVM && BigInt(account.stakingBalance) > BigInt(0))) {
            nativeToken = {
                type: TAG_NATIVE,
                amount: account.balance,
                stakingAmount: StatApp.isEVM ? undefined : account.stakingBalance,
                name: 'Conflux Network Token',
                symbol: 'CFX',
                decimals: 18,
                iconUrl: TokenQuery.wrappedCFX?.iconUrl,
                priceInUSDT: formatPrice(TokenQuery.wrappedCFX?.price),
                quoteUrl: TokenQuery.wrappedCFX?.quoteUrl,
            };
        }
    }

    if (nativeToken) {
        if (skip === 0) {
            limit = limit - 1;
        } else {
            skip = skip - 1;
        }
    }
    const result = await TokenQuery.listByAccount({owner, types, skip, limit});

    result.list = result.list.map((token: any) =>
        lodash.assign({
                amount: token?.balance,
                priceInUSDT: token?.price,
            },
            lodash.pick(token, ['contract', 'type', 'name', 'symbol', 'decimals', 'iconUrl', 'quoteUrl']))
    );

    if (nativeToken) {
        if (skip === 0) {
            result?.list?.unshift(nativeToken);
        }
        result.total += 1;
    }

    result.list = result.list.map(token => lodash.pickBy(token, value => !lodash.isNil(value)));

    setBody(ctx, result)
}

const MAX_ACCOUNTS = 100;

export async function listAccountInfos(ctx) {
    mustBeAddressArrayParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'accounts');
    const {accounts} = ctx.request.query;
    checkPresent({accounts}, ['accounts']);
    if (accounts.length > MAX_ACCOUNTS) {
        setBody(ctx, null, 1, `The max size of accounts is ${MAX_ACCOUNTS}`);
        return;
    }

    const data = await getApiService().accountQuery.list(accounts);

    setBody(ctx, data);
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
