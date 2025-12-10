import {Interface, FunctionFragment, Result} from "ethers/lib/utils";

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
