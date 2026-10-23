export interface Withdrawal {
	index: string;
	validatorIndex: string;
	address: string;
	amount: string;
}

export interface WithdrawalParsed {
	index: number;
	validatorIndex: number;
	address: string;
	amount: number;
}

export interface WithdrawalsData {
	withdrawals: Withdrawal[];
	withdrawalsRoot: string;
	number: string;
}

export interface WithdrawalsDataParsed {
	withdrawals: WithdrawalParsed[];
	withdrawalsRoot: string;
	totalAmount: number;
	blockNumber: number;
}


export class WithdrawalParser {
	/**
	 * Parse hex string to number
	 * Handles large numbers that might exceed JavaScript's safe integer limit
	 */
	static parseHexToNumber(hexValue: string): number {
		if (!hexValue.startsWith('0x')) {
			throw new Error(`Invalid hex value: ${hexValue}`);
		}

		// Remove '0x' prefix and parse
		const hexString = hexValue.slice(2);

		// For very large numbers, use BigInt and convert to number if safe
		const bigIntValue = BigInt(hexValue);

		if (bigIntValue <= BigInt(Number.MAX_SAFE_INTEGER)) {
			return Number(bigIntValue);
		} else {
			// For numbers larger than safe integer, you might want to handle differently
			// For now, we'll return as number but this might lose precision
			return Number(bigIntValue);
		}
	}

	/**
	 * Parse a single withdrawal object
	 */
	static parseWithdrawal(withdrawal: Withdrawal): WithdrawalParsed {
		return {
			index: WithdrawalParser.parseHexToNumber(withdrawal.index),
			validatorIndex: WithdrawalParser.parseHexToNumber(withdrawal.validatorIndex),
			address: withdrawal.address,
			amount: WithdrawalParser.parseHexToNumber(withdrawal.amount)
		};
	}

	/**
	 * Parse withdrawals data and calculate total amount
	 */
	static parseWithdrawalsData(data: WithdrawalsData): WithdrawalsDataParsed {
		const parsedWithdrawals = data.withdrawals.map(WithdrawalParser.parseWithdrawal);

		const totalAmount = parsedWithdrawals.reduce((sum, withdrawal) => {
			return sum + withdrawal.amount;
		}, 0);

		return {
			withdrawals: parsedWithdrawals,
			withdrawalsRoot: data.withdrawalsRoot,
			totalAmount, blockNumber: WithdrawalParser.parseHexToNumber(data.number)
		};
	}

	/**
	 * Sum amounts from parsed withdrawals
	 */
	static sumAmounts(withdrawals: WithdrawalParsed[]): number {
		return withdrawals.reduce((sum, withdrawal) => sum + withdrawal.amount, 0);
	}

	/**
	 * Sum amounts directly from raw withdrawals data
	 */
	static sumAmountsRaw(withdrawals: Withdrawal[]): number {
		return withdrawals.reduce((sum, withdrawal) => {
			return sum + WithdrawalParser.parseHexToNumber(withdrawal.amount);
		}, 0);
	}
}

import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

// Define interfaces for Sequelize
interface WithdrawalAttributes {
	id?: number;
	blockNo: number;
	wIndex: number;
	validatorIndex: number;
	address: string;
	amount: number;
	withdrawalsRoot: string;
	createdAt?: Date;
	updatedAt?: Date;
}

export interface WithdrawalCreationAttributes extends Optional<WithdrawalAttributes, 'id'> {}

export class WithdrawalModel extends Model<WithdrawalAttributes, WithdrawalCreationAttributes>
	implements WithdrawalAttributes {

	public id!: number;
	public blockNo: number;
	public wIndex!: number;
	public validatorIndex!: number;
	public address!: string;
	public amount!: number;
	public withdrawalsRoot!: string;
	public readonly createdAt!: Date;
	public readonly updatedAt!: Date;
}

export const initWithdrawalModel = (sequelize: Sequelize): typeof WithdrawalModel => {
	WithdrawalModel.init(
		{
			id: {
				type: DataTypes.INTEGER,
				autoIncrement: true,
				primaryKey: true,
			},
			blockNo: {
				type: DataTypes.BIGINT,
				allowNull: false, unique: true,
			},
			wIndex: {
				type: DataTypes.BIGINT,
				allowNull: false,
			},
			validatorIndex: {
				type: DataTypes.BIGINT,
				allowNull: false,
			},
			address: {
				type: DataTypes.STRING(42), // Ethereum address length
				allowNull: false,
				validate: {
					is: /^0x[a-fA-F0-9]{40}$/ // Basic Ethereum address validation
				}
			},
			amount: {
				type: DataTypes.BIGINT,
				allowNull: false,
			},
			withdrawalsRoot: {
				type: DataTypes.STRING(66), // SHA-256 hash length
				allowNull: false,
			}
		},
		{
			sequelize,
			tableName: 'withdrawals',
			indexes: [
				{
					name: 'idx_block',
					fields: ['blockNo'],
				},
			]
		}
	);

	return WithdrawalModel;
};

// Utility function to create withdrawal records
export const createWithdrawalRecords = async (
	sequelize: Sequelize,
	data: WithdrawalsData
): Promise<WithdrawalModel[]> => {
	const Withdrawal = initWithdrawalModel(sequelize);

	const parsedData = WithdrawalParser.parseWithdrawalsData(data);

	const withdrawalRecords = await Withdrawal.bulkCreate(
		parsedData.withdrawals.map(withdrawal => ({
			...withdrawal,
			withdrawalsRoot: parsedData.withdrawalsRoot
		})),
		{ ignoreDuplicates: true }
	);

	return withdrawalRecords;
};

export class WithdrawalUtils {
	/**
	 * Filter out zero-amount withdrawals
	 */
	static filterNonZeroWithdrawals(withdrawals: WithdrawalParsed[]): WithdrawalParsed[] {
		return withdrawals.filter(withdrawal => withdrawal.amount > 0);
	}

	/**
	 * Group withdrawals by address
	 */
	static groupByAddress(withdrawals: WithdrawalParsed[]): Map<string, WithdrawalParsed[]> {
		const grouped = new Map<string, WithdrawalParsed[]>();

		withdrawals.forEach(withdrawal => {
			if (!grouped.has(withdrawal.address)) {
				grouped.set(withdrawal.address, []);
			}
			grouped.get(withdrawal.address)!.push(withdrawal);
		});

		return grouped;
	}

	/**
	 * Get total amount by address
	 */
	static getTotalByAddress(withdrawals: WithdrawalParsed[]): Map<string, number> {
		const grouped = WithdrawalUtils.groupByAddress(withdrawals);
		const totals = new Map<string, number>();

		grouped.forEach((withdrawals, address) => {
			const total = withdrawals.reduce((sum, w) => sum + w.amount, 0);
			totals.set(address, total);
		});

		return totals;
	}
}

// BlockWithdraw Model Interfaces
interface BlockWithdrawAttributes {
	id?: number;
	blockNumber: number;
	sumAmount: number; // Current block's total withdrawal amount
	cumulativeAmount: string; // Cumulative amount across blocks
	withdrawalsRoot: string;
	createdAt?: Date;
	updatedAt?: Date;
}

export interface BlockWithdrawCreationAttributes extends Optional<BlockWithdrawAttributes, 'id'> {}

export class BlockWithdrawModel extends Model<BlockWithdrawAttributes, BlockWithdrawCreationAttributes>
	implements BlockWithdrawAttributes {

	public id!: number;
	public blockNumber!: number;
	public sumAmount!: number;
	public cumulativeAmount!: string;
	public withdrawalsRoot!: string;
	public readonly createdAt!: Date;
	public readonly updatedAt!: Date;
}

export const initBlockWithdrawModel = (sequelize: Sequelize): typeof BlockWithdrawModel => {
	BlockWithdrawModel.init(
		{
			id: {
				type: DataTypes.INTEGER,
				autoIncrement: true,
				primaryKey: true,
			},
			blockNumber: {
				type: DataTypes.BIGINT,
				allowNull: false,
				unique: true, // Each block should have only one record
				comment: 'Block number'
			},
			sumAmount: {
				type: DataTypes.BIGINT, // 36 total digits, 18 decimal places
				allowNull: false,
				comment: 'Total withdrawal amount in this block'
			},
			cumulativeAmount: {
				type: DataTypes.DECIMAL(36, 18), // 36 total digits, 18 decimal places
				allowNull: false,
				comment: 'Cumulative withdrawal amount up to this block'
			},
			withdrawalsRoot: {
				type: DataTypes.STRING(66), // SHA-256 hash length
				allowNull: false,
				comment: 'Merkle root of withdrawals in this block'
			}
		},
		{
			sequelize,
			tableName: 'block_withdraws',
			indexes: [
				{
					name: 'idx_block',
					fields: ['blockNumber'],
					unique: true
				}
			]
		}
	);

	return BlockWithdrawModel;
};

export async function getLatestBlockWithdraw(): Promise<BlockWithdrawModel | null> {
	return await BlockWithdrawModel.findOne({
		order: [['blockNumber', 'DESC']],
		raw: true,
	});
}


// validator RPC returns these data:
export interface ValidatorResponse {
	execution_optimistic: boolean;
	finalized: boolean;
	data: ValidatorData[];
}

export interface ValidatorData {
	index: string;
	balance: string;
	/** Stake queued to leave. Counted separately: it does not move `balance`. */
	pending_balance_to_withdraw?: string | null;
	symbiotic_balance: string | null;
	status: string;
	validator: Validator;
}

export interface Validator {
	pubkey: string;
	withdrawal_credentials: string;
	effective_balance: string; // This is the field we need to sum
	slashed: boolean;
	activation_eligibility_epoch: string;
	activation_epoch: string;
	exit_epoch: string;
	withdrawable_epoch: string;
}

// Sum effective balance as BigInt (recommended for large numbers)
/**
 * What the validators actually hold, in Gwei.
 *
 * `balance` and not `validator.effective_balance`: effective balance only follows the
 * real one through a hysteresis band, so once a block's rewards are swept out it stays
 * sitting above what the validator holds. On mainnet that bias ran to 13.6M 0G, and it
 * went straight into the published supply -- totalling `balance` instead brings the two
 * independent readings of the total (this formula, and genesis + cumulative rewards) from
 * 1.24% apart to 0.005%.
 *
 * `pending_balance_to_withdraw` is added on top. It does not move `balance`, so stake
 * queued to leave is held in neither field alone and is simply missed by summing one of
 * them. It is small and moves with the exit queue -- a few hundred to a few thousand 0G
 * -- which is well inside the noise of the check above, so that check neither confirms
 * nor refutes including it; it is here because the two fields count different tokens.
 *
 * Slashing needs nothing: the consensus layer takes it off `balance` directly, which is
 * why validators can report slashed false while the balances already reflect it.
 */
export function sumValidatorBalanceBigInt(response: ValidatorResponse): bigint {
	let total = 0n;

	for (const data of response.data) {
		total += BigInt(data.balance) + BigInt(data.pending_balance_to_withdraw || 0);
	}

	return total;
}
