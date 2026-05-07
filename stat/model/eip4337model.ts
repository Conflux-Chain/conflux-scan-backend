import {DataTypes, Model, Sequelize} from "sequelize";
import {Hex40Map} from "./HexMap";

export interface IBundleTx {
	id: bigint;
	hash: string;
	epoch: bigint;
	bundlerId: number;
	entryPointId: number;
	txCount: number;
	value: string;
	txnFee: string;
	createdAt: Date;
}

export class BundleTx extends Model<IBundleTx> implements IBundleTx {
	id: bigint;
	hash: string;
	epoch: bigint;
	bundlerId: number;
	entryPointId: number;
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
			indexes: [
				{name: 'idx_epoch', fields: ['epoch']},
				{name: 'idx_bundlerId_entryPointId', fields: ['bundlerId', 'entryPointId']},
				{name: 'idx_entryPointId', fields: ['entryPointId']},
			]
		})
	}
}

export interface IAATx {
	id: bigint;
	userOpHash: string;
	epoch: bigint;
	senderId: number;
	bundlerId: number;
	eventContractId: number;
	entryPointId: number;
	bundleTxId: bigint;
	paymasterId: number;
	nonce: string;
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
	bundlerId: number;
	eventContractId: number;
	entryPointId: number;
	bundleTxId: bigint;
	paymasterId: number;
	nonce: string;
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
			bundlerId: {type: DataTypes.BIGINT, allowNull: false},
			eventContractId: {type: DataTypes.BIGINT, allowNull: false},
			entryPointId: {type: DataTypes.BIGINT, allowNull: false},
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
			indexes: [
				{name: 'idx_epoch', fields: ['epoch']},
				{name: 'idx_senderId_bundlerId_entryPointId', fields: ['senderId', 'bundlerId', 'entryPointId']},
				{name: 'idx_senderId_entryPointId', fields: ['senderId', 'entryPointId']},
				{name: 'idx_bundlerId_entryPointId', fields: ['bundlerId', 'entryPointId']},
				{name: 'idx_entryPointId', fields: ['entryPointId']},
			]
		});
	}
}


export function bindBundleTxModels() {
	// In BundleTx model definition, add:
	BundleTx.belongsTo(Hex40Map, { as: 'bundler', foreignKey: 'bundlerId' });
	BundleTx.belongsTo(Hex40Map, { as: 'entryPoint', foreignKey: 'entryPointId' });

	// In AATx model definition, add:
	AATx.belongsTo(Hex40Map, { as: 'sender', foreignKey: 'senderId' });
	AATx.belongsTo(Hex40Map, { as: 'bundler', foreignKey: 'bundlerId' });
	AATx.belongsTo(Hex40Map, { as: 'entryPoint', foreignKey: 'entryPointId' });

	AATx.belongsTo(BundleTx, { as: 'bundleTx', foreignKey: 'bundleTxId' });

}


export interface IAccountDeployed {
	id: bigint;
	bundleTxId: bigint;
	eventContractId: bigint;
	epoch: bigint;
	userOpHash: string;
	sender: string;
	factory: string;
	paymaster: string;
	createdAt: Date;
}

export class AccountDeployed extends Model<IAccountDeployed> implements IAccountDeployed {
	id: bigint;
	bundleTxId: bigint;
	eventContractId: bigint;
	userOpHash: string;
	epoch: bigint;
	sender: string;
	factory: string;
	paymaster: string;
	createdAt: Date;
	static register(sequelize: Sequelize) {
		AccountDeployed.init({
			id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
			bundleTxId: {type: DataTypes.BIGINT, allowNull: false},
			eventContractId: {type: DataTypes.BIGINT, allowNull: false},
			epoch: {type: DataTypes.BIGINT, allowNull: false},
			userOpHash: {type: DataTypes.STRING(66), allowNull: false},
			sender: {type: DataTypes.STRING(42), allowNull: false},
			factory: {type: DataTypes.STRING(42), allowNull: false},
			paymaster: {type: DataTypes.STRING(42), allowNull: false},
			createdAt: {type: DataTypes.DATE, allowNull: false},
		}, {
			sequelize,
			tableName: 'account_deployed',
			indexes: [
				{name: 'idx_epoch', fields: ['epoch']},
			]
		})
	}
}

export interface IUserOperationRevertReason {
	id: bigint;
	bundleTxId: bigint;
	eventContractId: bigint;
	epoch: bigint;
	userOpHash: string;
	sender: string;
	nonce: string;
	revertReason: string;
	createdAt: Date;
}

export class UserOperationRevertReason extends Model<IUserOperationRevertReason> implements IUserOperationRevertReason {
	id: bigint;
	bundleTxId: bigint;
	eventContractId: bigint;
	userOpHash: string;
	epoch: bigint;
	sender: string;
	nonce: string;
	revertReason: string;
	createdAt: Date;
	static register(sequelize: Sequelize) {
		UserOperationRevertReason.init({
			id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
			bundleTxId: {type: DataTypes.BIGINT, allowNull: false},
			eventContractId: {type: DataTypes.BIGINT, allowNull: false},
			epoch: {type: DataTypes.BIGINT, allowNull: false},
			userOpHash: {type: DataTypes.STRING(66), allowNull: false},
			sender: {type: DataTypes.STRING(42), allowNull: false},
			nonce: {type: DataTypes.STRING(78), allowNull: false},
			revertReason: {type: DataTypes.TEXT("medium"), allowNull: false},
			createdAt: {type: DataTypes.DATE, allowNull: false},
		}, {
			sequelize,
			tableName: 'revert_reason',
			indexes: [
				{name: 'idx_epoch', fields: ['epoch']},
				{name: 'idx_userOpHash', fields: ['userOpHash']},
			]
		});
	}
}
