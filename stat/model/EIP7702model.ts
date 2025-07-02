import {DataTypes, Model, Op, QueryTypes, Sequelize} from "sequelize";
import {getAddrId, Hex40Map} from "./HexMap";
import {FullTransaction} from "./FullBlock";
import {getCfxSdk} from "../service/common/utils";
import {detectAccountType} from "../service/eip/eip7702";
import {ethers} from "ethers";

export interface IAuthBlockStub {
	id?: number;
	blockNumber: number; blockHash: string;
	// transactionPosition: number;
	// transactionHash: string;
}
export interface IAuthAction {
	id?: number;
	refBlockStubId: number;
	// authorId: number;
	author: string;
	nonce: number;
	chainId: number;
	// addressId: number;
	address: string;
	result: string;

	blockNumber: number;
	transactionPosition: number;
	authIndex: number;
	yParity: string;
	r: string;
	s: string;
}

export class AuthBlockStub extends Model<IAuthBlockStub> implements IAuthBlockStub {
	id?: number;
	blockNumber: number;
	blockHash: string;
	// transactionPosition: number;
	// transactionHash: string;

	static register(sequelize: Sequelize) {
		AuthBlockStub.init({
			id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
			blockNumber: {type: DataTypes.BIGINT, allowNull: false},
			blockHash: {type: DataTypes.STRING(66), allowNull: false},
			// transactionPosition: {type: DataTypes.BIGINT, allowNull: false},
			// transactionHash: {type: DataTypes.STRING(66), allowNull: false},
		}, {
			sequelize, tableName: "auth_tx_stub",
			indexes: [
				{name: 'idx_block', fields: ['blockNumber']},
			]
		})
	}
}

export async function getDelegatedAddrAtTx(eoa: string, blockNumber:number, txHash: string): Promise<IAuthAction> {
	const accType = await detectAccountType(eoa);
	if (accType.isContract) {
		return null;
	}
	const txBean = await FullTransaction.findOne({
		where: {epoch: blockNumber, hash: txHash}, raw: true,
	});
	if (!txBean) {
		return null;
	}
	return AuthAction.findOne({
		where: {
			author: eoa,
			blockNumber: {[Op.lte]: blockNumber},
			transactionPosition: {[Op.lte]: txBean.txPosition},
			result: 'success',
		}, raw: true,
		order: [['blockNumber', 'desc'], ['transactionPosition', 'desc'], ['authIndex', 'desc']],
	});
}

export async function getAuthActionInTx(txHash: string) {
	const receipt = await getCfxSdk().getTransactionReceipt(txHash);
	if (!receipt) {
		return {list: [], message: 'transaction receipt not found'};
	}
	const txBean = await FullTransaction.findOne({
		where: {epoch: receipt.epochNumber, hash: txHash}, raw: true,
	})
	if (!txBean) {
		return {list: [], message: 'transaction not found'};
	}
	const list = await AuthAction.findAll({
		where: {blockNumber: receipt.epochNumber, transactionPosition: txBean.txPosition},
		order: [['authIndex', 'asc']],
		raw: true,
	})
	list.forEach((row) => {
		row['address'] =  ethers.utils.getAddress(row['address']);
	});
	return {list};
}

export async function listAuthAction({author, skip = 0, limit = 10}) {
	const actionT = AuthAction.getTableName();
	const txT = FullTransaction.getTableName();
	const hexT = Hex40Map.getTableName();
	const sql = `select a.*, tx.createdAt as txTime, tx.hash as txHash, concat('0x', hex.hex) as txSender from ${actionT} a join ${txT} tx on a.blockNumber = tx.epoch
	 and tx.blockPosition = 0 and tx.txPosition = a.transactionPosition
	 join ${hexT} hex on tx.fromId = hex.id 
	 where a.author = ? order by a.blockNumber desc, a.transactionPosition desc, a.authIndex desc limit ? , ?`;
	const arr = await AuthAction.sequelize.query(sql, {
		type: QueryTypes.SELECT, replacements: [author, skip, limit],
	})
	arr.forEach((row) => {
		row['createdAt'] = row['txTime'];
		row['txSender'] =  ethers.utils.getAddress(row['txSender']);
		row['address'] =  ethers.utils.getAddress(row['address']);
	});
	const count = await AuthAction.count({where: {author}});
	return {total: count, list: arr, listLimit: 1000};
}

export class AuthAction extends Model<IAuthAction> implements IAuthAction {
	id?: number;
	refBlockStubId: number;
	// authorId: number;
	author: string;
	nonce: number;
	chainId: number;
	// addressId: number;
	address: string;
	result: string;

	blockNumber: number;
	transactionPosition: number;
	authIndex: number;
	yParity: string;
	r: string;
	s: string;

	static register(sequelize: Sequelize) {
		AuthAction.init({
			id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
			refBlockStubId: {type: DataTypes.BIGINT, allowNull: false},
			author: {type: DataTypes.STRING(44), allowNull: false},
			nonce: {type: DataTypes.BIGINT, allowNull: false},
			chainId: {type: DataTypes.BIGINT, allowNull: false},
			address: {type: DataTypes.STRING(44), allowNull: false},
			result: {type: DataTypes.STRING(32), allowNull: false},
			blockNumber: {type: DataTypes.BIGINT, allowNull: false},
			transactionPosition: {type: DataTypes.INTEGER, allowNull: false},
			authIndex: {type: DataTypes.INTEGER, allowNull: false},
			yParity: {type: DataTypes.STRING(3), allowNull: false},
			r: {type: DataTypes.STRING(66), allowNull: false},
			s: {type: DataTypes.STRING(66), allowNull: false},
		}, {
			sequelize, tableName: "auth_action",
			indexes: [
				{name: 'idx_author', fields: ['author', 'blockNumber', 'transactionPosition', 'authIndex'], unique: true},
				{name: 'idx_refBlockStubId', fields: ['refBlockStubId']},
				{name: 'idx_blockNumber', fields: ['blockNumber']},
			]
		})
	}
}

export interface IAuth {
	id: number; txHash: string; epoch: number; blockIndex:number; txIndex: number;
	authIndex:number;
	senderId: number; sender: string;
	authorId:number; author: string;
	nonce:number; result: string;
	addressId:number; address: string;
}

export class Auth extends Model<IAuth> implements IAuth {
	id: number; txHash: string; epoch: number; blockIndex:number; txIndex: number;
	authIndex:number;
	senderId: number; sender: string;
	authorId:number; author: string;
	nonce:number; result: string;
	addressId:number; address: string;
	static register(sequelize: Sequelize) {
		Auth.init({
			id: {type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true},
			txHash: {type: DataTypes.STRING(66), allowNull: false},
			epoch: {type: DataTypes.BIGINT, allowNull: false},
			blockIndex: {type: DataTypes.INTEGER, allowNull: false},
			txIndex: {type: DataTypes.INTEGER, allowNull: false},
			authIndex: {type: DataTypes.INTEGER, allowNull: false},
			senderId: {type: DataTypes.BIGINT, allowNull: false},
			sender: {type: DataTypes.STRING(42), allowNull: false},
			authorId: {type: DataTypes.BIGINT, allowNull: false},
			author: {type: DataTypes.STRING(42), allowNull: false},
			nonce: {type: DataTypes.BIGINT, allowNull: false},
			result: {type: DataTypes.STRING(32), allowNull: false},
			addressId: {type: DataTypes.BIGINT, allowNull: false},
			address: {type: DataTypes.STRING(42), allowNull: false},
		}, {
			sequelize,
			tableName: 'auth',
			indexes: [
				{name: 'idx_authorId', fields: ['authorId']},
				{name: 'idx_author', fields: ['author']},
			]
		})
	}
}

export async function listAuth(author: string, skip: number, limit: number): Promise<{total:number, list: IAuth[] }> {
	const authorId = await getAddrId(author);
	if (!authorId) {
		return {total: 0, list: []};
	}
	const list = await Auth.findAll({
		where: {authorId}, raw: true,
		order: [['epoch', 'DESC'], ['blockIndex', 'desc'], ['txIndex', 'desc'], ['authIndex', 'desc']],
		offset: skip, limit,
	})
	const count = await Auth.count({where: authorId});
	return {total: count, list};
}
