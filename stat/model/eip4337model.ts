import {DataTypes, Model, Sequelize} from "sequelize";
import {Hex40Map, makeIdV} from "./HexMap";

export interface IBundleTx {
	id: bigint;
	hash: string;
	epoch: bigint;
	bundlerId: number;
	entryPointId: number;
	txCount: number;
	failedTxCount: number;
	status: number
	method: string;
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
	failedTxCount: number;
	status: number
	method: string;
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
			failedTxCount: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0},
			status: {type: DataTypes.MEDIUMINT, allowNull: false, defaultValue: 0},
			method: {type: DataTypes.STRING(32), allowNull: false, defaultValue: ''},
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
	methods: string;
	method7702: string;
	createdAt: Date;
}

export const LEN_AA_TX_METHODS = 1024;
// method id has 10 characters, and append a ',', it's 11 chars.
export const COUNT_AA_TX_METHODS = Math.floor(LEN_AA_TX_METHODS / 11);

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
	methods: string;
	method7702: string;
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
			actualGasUsed: {type: DataTypes.BIGINT, allowNull: false},
			methods: {type: DataTypes.STRING(LEN_AA_TX_METHODS),
				allowNull: true, defaultValue: '', },
			method7702: {type: DataTypes.STRING(32), allowNull: false, defaultValue: '', },
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
				{name: 'idx_opHash', fields: ['userOpHash']},
			]
		});
	}
}

export const entrypointAddrSet = new Set([
	'0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789', // --- v0.6
	'0x0000000071727de22e5e9d8baf0edac6f37da032', // --- v0.7
	'0x4337084d9e255ff0702461cf8895ce9e3b5ff108', // --- v0.8
])

export const entrypointAddrIdSet = new Set<number>();

export async function bindBundleTxModels() {
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
/*
alter table bundleTx add column status int default 0;
alter table bundleTx add column failedTxCount int default 0;
alter table bundleTx add column method varchar(32) default '';
alter table aaTx add column method7702 varchar(32) default '';
alter table aaTx modify column actualGasUsed bigint not null default 0;
 */
