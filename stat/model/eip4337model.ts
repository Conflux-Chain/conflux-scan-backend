import {DataTypes, Model, Sequelize} from "sequelize";

export interface IBundleTx {
	id: bigint;
	hash: string;
	epoch: bigint;
	bundlerId: bigint;
	entryPointId: bigint;
	txCount: number;
	value: string;
	txnFee: string;
	createdAt: Date;
}

export class BundleTx extends Model<IBundleTx> implements IBundleTx {
	id: bigint;
	hash: string;
	epoch: bigint;
	bundlerId: bigint;
	entryPointId: bigint;
	txCount: number;
	value: string;
	txnFee: string;
	createdAt: Date;
	static register(sequelize: Sequelize) {
		BundleTx.init({
			id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
			hash: {type: DataTypes.STRING(66), allowNull: false},
			epoch: {type: DataTypes.BIGINT, allowNull: false},
			bundlerId: {type: DataTypes.BIGINT, allowNull: false},
			entryPointId: {type: DataTypes.BIGINT, allowNull: false},
			txCount: {type: DataTypes.INTEGER, allowNull: false},
			value: {type: DataTypes.DECIMAL(36,18), allowNull: false},
			txnFee: {type: DataTypes.DECIMAL(36,18), allowNull: false},
			createdAt: {type: DataTypes.DATE, allowNull: false},
		}, {
			sequelize,
			tableName: 'bundleTx',
		})
	}
}

export interface IAATx {
	id: bigint;
	userOpHash: string;
	epoch: bigint;
	senderId: number;
	bundleTxId: bigint;
	paymasterId: number;
	nonce: bigint;
	success: boolean;
	actualGasCost: string;
	actualGasUsed: string;
	createdAt: Date;
}

export class AATx extends Model<IAATx> implements IAATx {
	id: bigint;
	userOpHash: string;
	epoch: bigint;
	senderId: number;
	bundleTxId: bigint;
	paymasterId: number;
	nonce: bigint;
	success: boolean;
	actualGasCost: string;
	actualGasUsed: string;
	createdAt: Date;

	static register(sequelize: Sequelize) {
		AATx.init({
			id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
			userOpHash: {type: DataTypes.STRING(66), allowNull: false},
			epoch: {type: DataTypes.BIGINT, allowNull: false},
			senderId: {type: DataTypes.BIGINT, allowNull: false},
			bundleTxId: {type: DataTypes.BIGINT, allowNull: false},
			paymasterId: {type: DataTypes.BIGINT, allowNull: false},
			nonce: {type: DataTypes.STRING(78), allowNull: false},
			success: {type: DataTypes.BOOLEAN, allowNull: false},
			actualGasCost: {type: DataTypes.DECIMAL(36,18), allowNull: false},
			actualGasUsed: {type: DataTypes.DECIMAL(36,18), allowNull: false},
			createdAt: {type: DataTypes.DATE, allowNull: false},
		}, {
			sequelize,
			tableName: 'aaTx',
		})
	}
}

export interface IAccountDeployed {
	id: bigint;
	epoch: bigint;
	userOpHash: string;
	sender: string;
	factory: string;
	paymaster: string;
	createdAt: Date;
}

export class AccountDeployed extends Model<IAccountDeployed> implements IAccountDeployed {
	id: bigint;
	userOpHash: string;
	epoch: bigint;
	sender: string;
	factory: string;
	paymaster: string;
	createdAt: Date;
	static register(sequelize: Sequelize) {
		AccountDeployed.init({
			id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
			epoch: {type: DataTypes.BIGINT, allowNull: false},
			userOpHash: {type: DataTypes.STRING(66), allowNull: false},
			sender: {type: DataTypes.STRING(42), allowNull: false},
			factory: {type: DataTypes.STRING(42), allowNull: false},
			paymaster: {type: DataTypes.STRING(42), allowNull: false},
			createdAt: {type: DataTypes.DATE, allowNull: false},
		}, {
			sequelize,
			tableName: 'account_deployed',
		})
	}
}

export interface IUserOperationRevertReason {
	id: bigint;
	epoch: bigint;
	userOpHash: string;
	sender: string;
	nonce: string;
	revertReason: string;
	createdAt: Date;
}

export class UserOperationRevertReason extends Model<IUserOperationRevertReason> implements IUserOperationRevertReason {
	id: bigint;
	userOpHash: string;
	epoch: bigint;
	sender: string;
	nonce: string;
	revertReason: string;
	createdAt: Date;
	static register(sequelize: Sequelize) {
		UserOperationRevertReason.init({
			id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
			epoch: {type: DataTypes.BIGINT, allowNull: false},
			userOpHash: {type: DataTypes.STRING(66), allowNull: false},
			sender: {type: DataTypes.STRING(42), allowNull: false},
			nonce: {type: DataTypes.STRING(78), allowNull: false},
			revertReason: {type: DataTypes.TEXT("medium"), allowNull: false},
			createdAt: {type: DataTypes.DATE, allowNull: false},
		}, {
			sequelize,
			tableName: 'revert_reason',
		})
	}
}
