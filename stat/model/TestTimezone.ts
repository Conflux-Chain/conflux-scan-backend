import {DataTypes, Model} from "sequelize";

export interface ITestTimezone {
    key: string;
    value: Date
}

export const KEY_MINER_EPOCH = "KEY_MINER_EPOCH"

export class TestTimezone extends Model<ITestTimezone> implements ITestTimezone {
    key: string;
    value: Date;

    static register(sequelize) {
        TestTimezone.init({
            key: {type: DataTypes.CHAR(30), primaryKey: true},
            value: DataTypes.DATE,
        }, {
            sequelize,
            tableName: 'testTimezone',
            timestamps: false
        })
    }
}