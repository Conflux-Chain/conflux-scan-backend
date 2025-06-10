//
import {DataTypes, Model, Sequelize} from "sequelize";

export const ADDR_LEN = 8 // 40. only save the tail of an address.

export interface IUniqueAddrHourly {
	id?:number
	timeStart: Date
	timeEnd: Date
	contractId:number
	addr:number
	fromMark: boolean
	toMark: boolean
}
export class UniqueAddressHourly extends Model<IUniqueAddrHourly> implements IUniqueAddrHourly {
	id?:number
	timeStart: Date
	// main prop
	contractId:number
	addr:number
	fromMark: boolean
	toMark: boolean
	timeEnd: Date
	static register(seq:Sequelize) {
		UniqueAddressHourly.init({
			id: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true, autoIncrement: true},
			timeStart: {type: DataTypes.DATE, allowNull: false},
			timeEnd: {type: DataTypes.DATE, allowNull: false},
			contractId: {type: DataTypes.BIGINT, allowNull: false, },
			addr: {type: DataTypes.BIGINT, allowNull: false, },
			fromMark: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
			toMark: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
		}, {
			sequelize: seq, tableName: 'unique_addr_hourly',
			indexes: [
				{name: 'uk_epoch_cid_addr', unique: true, fields:['timeStart','contractId', 'addr'], },
			]
		})
	}
}

