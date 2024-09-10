import {DataTypes, Model, Sequelize} from "sequelize";

export interface IGasConsumer {
	id: number;
	addrId: number;
	statType: string;
	statTime: Date;
	endTime: Date;
	gas: number;
	updatedAt?: Date;
}

export class GasConsumer extends Model<IGasConsumer> implements IGasConsumer {
	id: number;
	addrId: number;
	statType: string;
	statTime: Date;
	endTime: Date;
	gas: number;
	static register(sequelize: Sequelize) {
		GasConsumer.init({
			id: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, autoIncrement: true, primaryKey: true},
			addrId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, },
			statType: {type: DataTypes.STRING({length: 8}), allowNull: false, },
			statTime: {type: DataTypes.DATE(), allowNull: false, },
			endTime: {type: DataTypes.DATE(), allowNull: false, },
			gas: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, },
		}, {
			tableName: 'gas_consumer',
			indexes: [{
				name: 'uk_type_time_addId', fields: ['statType', 'statTime', 'addrId'], unique: true
			},{
				name: 'uk_type_addId_time', fields: ['statType', 'addrId', 'statTime'], unique: true
			}],
			sequelize,
		})
	}
}
