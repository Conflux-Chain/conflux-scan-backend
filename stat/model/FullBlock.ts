/** Save all block. Another model `Block` only saves recent blocks (miner stat)*/



import {Sequelize, DataTypes, Model} from "sequelize";

export interface IFullBlock {
    epoch: number;
    position: number;
    hash: string;
    difficulty: number;
    minerId: number;
    createdAt: Date,
    totalReward: bigint;
    txFee: bigint;
    avgGasPrice: number;
    gasLimit: number;
    gasUsed:number;
    txCount:number;
    pivot: boolean;
}

export class FullBlock extends Model<IFullBlock> implements IFullBlock {
    epoch: number;
    createdAt: Date;
    difficulty: number;
    minerId: number;
    hash: string;
    totalReward: bigint;
    txFee: bigint;
    avgGasPrice: number;
    gasLimit: number;
    gasUsed:number;
    txCount:number;
    pivot: boolean;
    position: number;
    static findMax() {
        return FullBlock.scope("maxOneById").findOne()
    }

    static register(sequelize) {
        // mysql partition limits that :
        // A primary must include all columns in the table's partitioning location.
        FullBlock.init({
            // id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            txCount: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0}, // A 32 bit integer.
            position: {type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0}, // A 16 bit integer.
            pivot: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: 0},
            difficulty: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, defaultValue: 0},
            minerId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            hash: {type: DataTypes.CHAR(66), allowNull: true, defaultValue: ''},
            totalReward: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
            txFee: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
            avgGasPrice: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0}, // sum(gasPrice of tx) / txCount
            gasLimit: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
            gasUsed: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
        }, {
            tableName: 'full_block',
            sequelize,
            timestamps: false,
            indexes: [
                {
                    name: 'idx_block_time', // index name must be unique globally under sqlite.
                    fields: [{name: 'createdAt', order: 'DESC'}]
                },{
                    name: 'block_hash',
                    fields:[{name:'hash', length:10}]
                },
                /*{
                // It's primary key, created by SQL directly.
                    name: 'uk_epoch_pos', unique: true,
                    fields:[
                        {name:'epoch', order: 'DESC'},
                        {name:'position', order: 'DESC'},
                    ],
                }*/
            ],
            scopes: {
                maxOneById: {
                    limit: 1,
                    order: [["epoch", "desc", "position", "desc"]]
                },
            }
        })
    }
}

export interface IFullTransaction {
    epoch:number
    blockPosition:number
    txPosition:number
    createdAt:Date
    hash:string
    fromId:number
    nonce: number
    toId:number
    dripValue:number
    gasPrice:number
    gas:number
    status: number
    contractCreatedId:number
}
export class FullTransaction extends Model<IFullTransaction> implements IFullTransaction {
    epoch:number
    blockPosition:number
    txPosition:number
    createdAt:Date
    hash:string
    fromId:number
    nonce: number
    toId:number
    dripValue:number
    gasPrice:number
    gas:number
    status: number
    contractCreatedId:number
    static register(sequelize) {
        // mysql partition limits that :
        // A primary must include all columns in the table's partitioning location.
        FullTransaction.init({
            // id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            blockPosition: {type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0}, // A 16 bit integer.
            txPosition: {type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0}, // A 16 bit integer.
            createdAt: {type: DataTypes.DATE, allowNull: false},
            hash: {type: DataTypes.CHAR(66), allowNull: true, defaultValue: ''},
            fromId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            nonce: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            toId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            dripValue: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
            gasPrice: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0}, // sum(gasPrice of tx) / txCount
            gas: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0}, // sum(gasPrice of tx) / txCount
            status: {type: DataTypes.TINYINT, allowNull: false, defaultValue: 0}, // A 8 bit integer.
            contractCreatedId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
        }, {
            tableName: 'full_tx',
            sequelize,
            timestamps: false,
            indexes: [
                {
                    name: 'idx_block_time', // index name must be unique globally under sqlite.
                    fields: [{name: 'createdAt', order: 'DESC'}]
                },{
                    name: 'idx_hash',
                    fields:[{name:'hash', length:10}]
                },
                /*{
                // It's primary key, created by SQL directly.
                    name: 'pk_epoch_bPos_tPos', unique: true,
                    fields:[
                        {name:'epoch', order: 'DESC'},
                        {name:'blockPosition', order: 'DESC'},
                        {name:'txPosition', order: 'DESC'},
                    ],
                }*/
            ]
        })
    }
}
// index tx by `from` and `to`
export interface IAddressTransactionIndex extends IFullTransaction{
    // partition by address id. add each tx to both `fromId` partition and `toId` partition
    addressId:number
}
// partition by address id. add each tx to both `fromId` partition and `toId` partition
export class AddressTransactionIndex extends Model<IAddressTransactionIndex> implements IAddressTransactionIndex {
    addressId:number
    epoch:number
    blockPosition:number
    txPosition:number
    createdAt:Date
    hash:string
    fromId:number
    nonce: number
    toId:number
    dripValue:number
    gasPrice:number
    gas:number
    status: number
    contractCreatedId:number
    static register(sequelize) {
        // mysql partition limits that :
        // A primary must include all columns in the table's partitioning location.
        AddressTransactionIndex.init({
            addressId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            blockPosition: {type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0}, // A 16 bit integer.
            txPosition: {type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0}, // A 16 bit integer.
            createdAt: {type: DataTypes.DATE, allowNull: false},
            hash: {type: DataTypes.CHAR(66), allowNull: true, defaultValue: ''},
            fromId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            nonce: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            toId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            dripValue: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
            gasPrice: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0}, // sum(gasPrice of tx) / txCount
            gas: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0}, // sum(gasPrice of tx) / txCount
            status: {type: DataTypes.TINYINT, allowNull: false, defaultValue: 0}, // A 8 bit integer.
            contractCreatedId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: true},
        }, {
            tableName: 'address_tx',
            sequelize,
            timestamps: false,
            indexes: [
                {
                    name: 'idx_block_time', // index name must be unique globally under sqlite.
                    fields: [{name: 'createdAt', order: 'DESC'}]
                }
                /*{
                // It's primary key, created by SQL directly.
                    name: 'pk_epoch_bPos_tPos', unique: true,
                    fields:[
                        {name:'addressId', order: 'DESC'},
                        {name:'epoch', order: 'DESC'},
                        {name:'blockPosition', order: 'DESC'},
                        {name:'txPosition', order: 'DESC'},
                    ],
                }*/
            ]
        })
    }
}