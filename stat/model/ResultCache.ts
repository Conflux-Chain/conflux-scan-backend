import {DataTypes, Model, Sequelize} from "sequelize";

// this is the api level cache, with more information of each token.
export const TopUniqueCache = 'TopUniqueCache';
// this is the db level cache, with only address id and its score.
export const TopUniqueBaseCache = 'TopUniqueBaseCache';

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
			name: {type: DataTypes.STRING(700), unique: true, },
			content: {type: DataTypes.TEXT("long"), },
		}, {
			tableName: `result_cache`, sequelize: seq,
		})
	}
}
