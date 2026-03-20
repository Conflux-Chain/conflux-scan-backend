import {DataTypes, Model, Sequelize} from "sequelize";

export interface IContractImpl {
	id?: number;
	cid: number;
	implId: number;
	beaconId: number;
	proxyType: string; //
	createdAt: Date;
	updatedAt: Date;
}

export class ContractImpl extends Model<IContractImpl> implements IContractImpl {
	id?: number;
	cid: number;
	implId: number;
	beaconId: number;
	proxyType: string; //
	createdAt: Date;
	updatedAt: Date;
	static register(sequelize: Sequelize) {
		ContractImpl.init({
			id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
			cid: {type: DataTypes.BIGINT, allowNull: false, unique: true},
			implId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
			beaconId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
			proxyType: {type: DataTypes.STRING(64), allowNull: false, defaultValue: ''},
			createdAt: {type: DataTypes.DATE, },
			updatedAt: {type: DataTypes.DATE, },
		}, {
			tableName: 'contract_impl', sequelize,
			indexes: [
				{name: 'idx_cid', fields: ['cid', 'createdAt']},
			]
		})
	}
}
