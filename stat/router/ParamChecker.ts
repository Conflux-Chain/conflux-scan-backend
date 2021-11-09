export function pageParam(obj: object, skipKey: string, limitKey: string, defaultLimit: number) {
	const param = {
		skip: intParam(obj, skipKey, 0),
		limit: intParam(obj, limitKey, defaultLimit)
	};
	if (param.skip > 10000) {
		throw new Error('Parameter <skip> exceeds 10000')
	}
	if (param.limit > 100) {
		throw new Error('Parameter <limit> exceeds 100')
	}
	return param
}

// skip exceeds 10_000;
export function skipLimitAny(obj) {
	return {
		skip: intParam(obj, 'skip', 0),
		limit: intParam(obj, 'limit', 10)
	};

}
export function skipLimit(obj) {
	return pageParam(obj, 'skip', 'limit', 10)
}
export function intParam(obj: object, key: string, defaultV: number) {
	const v = obj[key]
	if (v === undefined || v === null) {
		return defaultV
	}
	if (!/^[0-9]+$/.test(v)) {
		throw new InvalidParamError(`Invalid parameter [${key}] with value[${v}]`)
	}
	let number: number;
	try {
		number = parseInt(v);
	} catch (e) {
		return defaultV
	}
	if (isNaN(number)) {
		throw new InvalidParamError(`Invalid parameter [${key}] with value [${v}]`)
	}
	return number;
}
export class InvalidParamError extends Error{}