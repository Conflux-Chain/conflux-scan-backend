import {Errors} from "../service/common/LogicError";

const lodash = require('lodash');

const optCore = {skip: 0, skipMax: 10000, limit: 10, limitMax: 100};
const optCoreStat = {skip: 0, skipMax: 10000, limit: 10, limitMax: 2000};
const optEVM = {skip: 1, skipMax: 10000, limit: 100, limitMax: 100};
const optEVMStat = {skip: 1, skipMax: 10000, limit: 100, limitMax: 2000};

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
