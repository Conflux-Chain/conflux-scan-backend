import {Errors} from "../service/common/LogicError";

const lodash = require('lodash');

export const LIMIT_MAX = 100
export const LIMIT_MAX_STAT = 5000
export const SKIP_MAX = 10000

const optCore = {skip: 0, skipMax: SKIP_MAX, limit: 10, limitMax: LIMIT_MAX};
const optCoreStat = {skip: 0, skipMax: SKIP_MAX, limit: 10, limitMax: LIMIT_MAX_STAT};
const optEVM = {skip: 1, skipMax: SKIP_MAX, limit: 100, limitMax: LIMIT_MAX};
const optEVMStat = {skip: 1, skipMax: SKIP_MAX, limit: 100, limitMax: LIMIT_MAX_STAT};

export interface IPageParam {
    skip: number;
    limit: number;
}

export function paginateCore(reqObj: object, options?: any) {
    return paginate(reqObj, 'skip', 'limit', lodash.assign({...optCore}, options));
}

export function paginateCoreStat(reqObj: object, options?: any) {
    return paginate(reqObj, 'skip', 'limit', lodash.assign({...optCoreStat}, options));
}

export function paginateEVM(reqObj: object, options?: any) {
    return paginate(reqObj, 'page', 'offset', lodash.assign({...optEVM}, options));
}

export function paginateEVMStat(reqObj: object, options?: any) {
    return paginate(reqObj, 'page', 'offset', lodash.assign({...optEVMStat}, options));
}

function paginate(reqObj: object, skipKey: string, limitKey: string, options?: any) {
    const {skip, skipMax, limit, limitMax} = options;

    const pagination = {
        [skipKey]: intParam(reqObj, skipKey, skip),
        [limitKey]: intParam(reqObj, limitKey, limit)
    };

    if (pagination[skipKey] < skip) {
        throw new Errors.ParameterError(`Parameter <${skipKey}> starts at ${skip}`)
    }
    if (skipMax !== undefined && pagination[skipKey] > skipMax) {
        throw new Errors.ParameterError(`Parameter <${skipKey}> exceeds ${skipMax}`);
    }
    if (pagination[limitKey] < 1) {
        throw new Errors.ParameterError(`Parameter <${limitKey}>'s minimum value is 1`)
    }
    if (limitMax !== undefined && pagination[limitKey] > limitMax) {
        throw new Errors.ParameterError(`Parameter <${limitKey}> exceeds ${limitMax}`);
    }

    return pagination;
}

function intParam(obj, key, defaultValue) {
    const value = obj[key]
    if (value === undefined || value === null) {
        return defaultValue
    }

    if (!/^[0-9]+$/.test(value)) {
        throw new Error(`Invalid parameter [${key}] with value[${value}]`)
    }

    let number = parseInt(value);
    if(!isFinite(number)){
        return defaultValue
    }

    return number;
}


export function toArray(obj) {
    return Array.isArray(obj) ? obj : [obj]
}
