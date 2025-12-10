import {Interface, FunctionFragment, Result} from "ethers/lib/utils";
import {BigNumber} from "ethers";

/**
 * 合约解析器，支持 Interface 缓存
 */
export class ContractDecoder {
	private interfaceCache = new Map<string, Interface>();

	/**
	 * 获取或创建 Interface 实例
	 */
	public getInterface(abi: any[]): Interface {
		const abiString = JSON.stringify(abi);

		if (!this.interfaceCache.has(abiString)) {
			this.interfaceCache.set(abiString, new Interface(abi));
		}

		return this.interfaceCache.get(abiString)!;
	}

	/**
	 * 解析合约交易 input 数据
	 */
	decode(abi: any[], input: string): {
		functionName: string;
		signature: string;
		params: Array<{
			name: string;
			type: string;
			value: any;
		}>;
		fragment: FunctionFragment;
	} | null {
		try {
			if (!input || !input.startsWith('0x')) {
				return null;
			}

			const iface = this.getInterface(abi);
			const parsedTransaction = iface.parseTransaction({ data: input });

			if (!parsedTransaction) {
				return null;
			}

			const fragment = parsedTransaction.functionFragment;
			const params = fragment.inputs.map((input, index) => ({
				name: input.name || `param${index}`,
				type: input.type,
				value: parsedTransaction.args[index]
			}));

			return {
				functionName: fragment.name,
				signature: fragment.format(),
				params,
				fragment
			};
		} catch (error) {
			console.error('Decode failed:', error);
			return null;
		}
	}

	/**
	 * 简化的解析方法
	 */
	parse(abi: any[], input: string): {
		functionName: string;
		args: Result;
	} | null {
		try {
			if (!input || !input.startsWith('0x')) {
				return null;
			}

			const iface = this.getInterface(abi);
			const parsedTransaction = iface.parseTransaction({ data: input });

			if (!parsedTransaction) {
				return null;
			}

			return {
				functionName: parsedTransaction.name,
				args: parsedTransaction.args
			};
		} catch (error) {
			console.error('Parse failed:', error);
			return null;
		}
	}

	/**
	 * 清空缓存
	 */
	clearCache(): void {
		this.interfaceCache.clear();
	}

	/**
	 * 获取缓存大小
	 */
	getCacheSize(): number {
		return this.interfaceCache.size;
	}
}

/**
 * 将 ethers 解析的参数转换为具名参数对象
 * @param args ethers 解析后的参数（包含位置参数和具名参数）
 * @returns 只有具名参数且 BigNumber 转换为数字的对象
 */
export function transformNamedArgs(args: any[] | any): Record<string, any> {
	// 如果 args 不是数组，直接返回
	if (!Array.isArray(args)) {
		return transformObject(args);
	}

	// 提取具名参数（排除数组索引属性）
	const result: Record<string, any> = {};

	for (const key in args) {
		// 跳过数组索引（数字键）
		if (isNaN(Number(key))) {
			result[key] = transformValue(args[key]);
		}
	}

	return result;
}

/**
 * 转换单个值，处理 BigNumber
 */
function transformValue(value: any): any {
	if (BigNumber.isBigNumber(value)) {
		return (value as BigNumber).toString();
	}

	// 如果是数组或对象，递归转换
	if (Array.isArray(value)) {
		return value.map(transformValue);
	}

	if (value && typeof value === 'object' && !BigNumber.isBigNumber(value)) {
		return transformObject(value);
	}

	return value;
}

/**
 * 递归转换对象中的值，处理 BigNumber
 */
function transformObject(obj: any): any {
	if (obj === null || obj === undefined) {
		return obj;
	}

	// 如果是 BigNumber，转换为数字
	if (BigNumber.isBigNumber(obj)) {
		return (obj as BigNumber).toString();
	}

	// 如果是数组，递归处理每个元素
	if (Array.isArray(obj)) {
		return obj.map(item => transformObject(item));
	}

	// 如果是普通对象，递归处理每个属性
	if (typeof obj === 'object') {
		const result: Record<string, any> = {};
		for (const key in obj) {
			if (Object.prototype.hasOwnProperty.call(obj, key)) {
				result[key] = transformObject(obj[key]);
			}
		}
		return result;
	}

	// 其他类型直接返回
	return obj;
}


if (module === require.main) {
	const abi = [
		"function transfer(address to, uint256 amount) external returns (bool)",
		"function approve(address spender, uint256 amount) external returns (bool)"
	];

	const input = "0xa9059cbb00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8000000000000000000000000000000000000000000000000000de0b6b3a7640000";
	// 使用类版本
	const decoder = new ContractDecoder();
	const result2 = decoder.decode(abi, input);
	const simpleResult = decoder.parse(abi, input);
	console.log(`result is `, result2, '\n', simpleResult);
}

