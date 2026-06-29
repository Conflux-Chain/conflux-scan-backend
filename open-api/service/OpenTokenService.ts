import {getApiService} from "../ApiServer";
import {fmtAddr, StatApp} from "../../stat/StatApp";
import {format} from "js-conflux-sdk";
import {Op} from "sequelize";
import {Token} from "../../stat/model/Token";
import {
    checkPresent,
    formatPrice,
    mustBeAddressArrayParamIfPresent,
    mustBeAddressParamIfPresent
} from "../../stat/service/common/utils";
import {setBody} from "../router/middleware";
import {fixIconUrl} from "./OpenAccountService";
import {CONST} from "../../stat/service/common/constant";
import {Errors} from "../../stat/service/common/LogicError";
import {TokenAutoDetect} from "../../stat/service/TokenAutoDetect";
import {Hex40Map} from "../../stat/model/HexMap";
import {tokenCond} from "../../stat/router/StatRouter";

const lodash = require('lodash');

export async function getToken(address) {
    const token = await getApiService().tokenQuery.query({address});
    if (!token) {
        return null;
    }

    const result = {
        contractAddress: token.address,
        tokenName: token.name,
        symbol: token.symbol,
        divisor: token.decimals || '0',
        tokenType: token.transferType,
        totalSupply: token.totalSupply,
        website: token.website || '',
    };

    if (StatApp.isEVM) {
        result.contractAddress = result.contractAddress ? format.hexAddress(result.contractAddress) :
            result.contractAddress;
    } else {
        result['tokenType'] = result?.tokenType?.replace('ERC', 'CRC');
    }

    return result;
}

export async function validERC20Token(address) {
    const token = await getApiService().tokenQuery.query({address})
    if(!token || token.transferType !== CONST.TRANSFER_TYPE.ERC20) {
        throw new Errors.ParameterError(`ERC20 token ${address} not found.`);
    }
}

const MAX_TOKENS = 30;
export async function listTokens(ctx) {
    mustBeAddressArrayParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contracts');
    const { contracts: addrArray } = ctx.request.query;
    checkPresent({contracts: addrArray}, ['contracts']);
    if(addrArray.length > MAX_TOKENS){
        setBody(ctx, null, 1, `The max size of contracts is ${MAX_TOKENS}`);
        return
    }

    const base32Array = addrArray.map(addr => format.address(addr, StatApp.networkId));
    const tokenArray = await Token.findAll({
        attributes: {exclude: ['icon']},
        where: { base32: {[Op.in]: base32Array}, destroyed: false },
        raw: true
    });
    const tokenMap = lodash.keyBy(tokenArray, 'base32');

    const data = [];
    base32Array.forEach( base32 => {
        const token = tokenMap[base32];
        const contract = StatApp.isEVM ? format.hexAddress(base32) : base32;
        if(token) {
            fixIconUrl(token, 'base32')
            data.push({
                contract,
                name: token.name,
                symbol: token.symbol,
                decimals: token.decimals || undefined,
                type: StatApp.isEVM ? token.type : token.type?.replace('ERC', 'CRC'),
                iconUrl: token.iconUrl || undefined,
                quoteUrl: token.quoteUrl || undefined,
                priceInUSDT: token.price ? formatPrice(token.price) : undefined,
            })
        } else{
            data.push({
                contract,
                error: 'Token not found.'
            })
        }
    })

    setBody(ctx, data)
}

export async function refreshTokenInfo(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contract');
    const {contract} = ctx.request.query;
    checkPresent({contract}, ['contract']);

    const trace = await getApiService().traceCreateQuery.query(contract);
    if (trace.msg) {
        setBody(ctx, null, 1, 'No trace create found for token');
        return;
    }

    const validToken = await Token.findOne({where: {base32: format.address(contract, StatApp.networkId)}, raw: true});
    if (validToken) {
        setBody(ctx, null, 1, 'Token has valid info, cat not refresh again');
        return;
    }

    let token = await TokenAutoDetect.detect(contract, getApiService().tokenTool, false, true);
    if (token === undefined) {
        setBody(ctx, null, 1, `Contract Error, does not meet the token standard. ${tokenCond}`);
        return;
    }

    const id = (await Hex40Map.findOne({where: {hex: format.hexAddress(contract).slice(2)}})).id;
    token = await TokenAutoDetect.buildToken(id, token);
    await Token.upsert(token);

    setBody(ctx, {
        contract: fmtAddr(contract, StatApp.networkId),
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals || undefined,
        type: StatApp.isEVM ? token.type : token.type?.replace('ERC', 'CRC'),
    });
}