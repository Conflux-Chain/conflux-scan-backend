import {DataTypes, Model, Sequelize} from "sequelize";

export const TopUniqueCache = 'TopUniqueCache';

export interface IResultCache {
	id?:number;
	name: string;
	content: string;
}

export class ResultCache extends Model<IResultCache> implements IResultCache {
	id?:number;
	name: string;
	content: string;
	static register(seq: Sequelize) {
		ResultCache.init({
			id: {type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true},
			name: {type: DataTypes.STRING(1024), unique: true},
			content: {type: DataTypes.TEXT("long"), },
		}, {
			tableName: `result_cache`, sequelize: seq,
		})
	}
}
