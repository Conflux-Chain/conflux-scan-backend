/** Save all block. Another model `Block` only saves recent blocks (miner stat)*/



import {Op, Sequelize, DataTypes, Model} from "sequelize";

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
    executedTxnCount:number;
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
    txCount:number; // all txn, include packed but not executed
    executedTxnCount:number; //
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
            executedTxnCount: {type: DataTypes.INTEGER, allowNull: true, defaultValue: 0}, // A 32 bit integer.
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
export interface ITxnRowMark {
    id:number
    epoch:number
    blockPosition:number
    txPosition:number
    createdAt:Date
}
export class TxnRowMark extends Model<ITxnRowMark> implements ITxnRowMark {
    id:number
    epoch:number
    blockPosition:number
    txPosition:number
    createdAt:Date
    static register(seq) {
        TxnRowMark.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, primaryKey: true},
            epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            blockPosition: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            txPosition: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            createdAt:{type: DataTypes.DATE, allowNull: false},
        },{
            sequelize: seq,
            timestamps: false,
            tableName: 'full_tx_row_mark',
            indexes:[
                {name: 'idx_time', fields:[{name: 'createdAt', order: 'DESC'}]}
            ]
        })
    }
}
export const TX_PAGE_MARK_SIZE = 10_000 //
export class TxPage {
    id:number
    epoch:number
    blockPosition:number
    txPosition:number
    skip:number
}
export interface IBlockRowMark {
    id:number
    epoch:number
    position:number
}
export class BlockRowMark extends Model<IBlockRowMark> implements IBlockRowMark {
    // For example, {id:10, epoch: 3, position: 5} , indicates that
    // the block on epoch 3 position 5 is the 10th block.
    // Epoch 0, position 0 is the 1st block.
    id:number
    epoch:number
    position:number
    static register(seq) {
        BlockRowMark.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, primaryKey: true},
            epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            position: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
        },{
            sequelize: seq,
            timestamps: false,
            tableName: 'block_row_mark',
            indexes:[
            ]
        })
    }
}
export const BLOCK_PAGE_MARK_SIZE = 10_000 //
export class BlockPage {
    id:number
    epoch:number
    position:number
    skip:number
}
export async function countNonMarkBlockRows(maxOne: BlockRowMark) {
    const nonMarkRows = await FullBlock.count({
        where: {
            [Op.or]: {
                epoch: {[Op.gt]: maxOne.epoch},
                [Op.and]: {
                    epoch: {[Op.eq]: maxOne.epoch},
                    position: {[Op.gt]: maxOne.position},
                }
            }
        },
        logging: console.log
    })
    return nonMarkRows;
}

export async function countNonMarkTxRows(maxOne: TxnRowMark) {
    const nonMarkRows = await FullTransaction.count({
        where: {
            [Op.or]: {
                // epoch > ?
                epoch: {[Op.gt]: maxOne.epoch},
                // or ( epoch = ? and blockPosition > ?)
                [Op.and]:[
                    {epoch: maxOne.epoch},
                    {blockPosition: {[Op.gt]:maxOne.blockPosition}},
                ],
                // or ( epoch = ? and blockPosition = ? and txPosition)
                [Op.and]: {
                    epoch: maxOne.epoch,
                    blockPosition: maxOne.blockPosition,
                    txPosition: {[Op.gt]: maxOne.txPosition},
                }
            }
        },
        logging: console.log
    })
    return nonMarkRows;
}

// How to use the result:
/**
 if (result.id === Infinity) : query without condition;
 else : query with epoch and position condition.
 SQL:
 select * from t
 where epoch < result.epoch or (epoch = result.epoch and position < result.position)
 order by epoch desc, position desc
 limit result.skip, N
 */
export async function pagingFullBlock(skip:number) : Promise<BlockPage> {
    // find the max mark
    // const sqlMax = `select * from ${BlockRowMark.getTableName()} order by id desc limit 1`
    const maxOne = await BlockRowMark.findOne({order:[["id","desc"]], limit: 1})
    // handle null
    if (maxOne === null) {
        return {id:Infinity, epoch:Infinity, position:Infinity, skip}
    }
    // calculate rows between max mark and latest block
    const nonMarkRows = await countNonMarkBlockRows(maxOne);
    //
    if (nonMarkRows >= skip) {
        return {id:Infinity, epoch:Infinity, position:Infinity, skip}
    }
    //
    const pagedSkip = skip - nonMarkRows
    const skipMarkRows = Math.floor(pagedSkip/BLOCK_PAGE_MARK_SIZE)
    if (skipMarkRows === 0) {
        return {...maxOne, skip: pagedSkip}
    }
    const nearestId = maxOne.id - BLOCK_PAGE_MARK_SIZE * skipMarkRows
    // find the min mark that greater than pagedSkip
    const nearestOne = await BlockRowMark.findByPk(nearestId)
    // must exists
    const remainSkip = pagedSkip - BLOCK_PAGE_MARK_SIZE * skipMarkRows
    return {...nearestOne, skip: remainSkip}
}

export async function markBlockPosition(count:number=1) {
    let maxOne:IBlockRowMark = await BlockRowMark.findOne({order:[["id","desc"]], limit: 1})
    if (maxOne === null) {
       maxOne = {id:0, epoch: -1, position: -1}
    }
    do {
        // select epoch, position from full_block where epoch > -1 order by epoch asc, position asc limit 10000, 1;
        // select count(*) from full_block where epoch < 5947;
        const higherAnchor = await FullBlock.findOne({
            order: [["epoch", "asc"], ["position", "asc"]],
            where: {
                [Op.or]: [
                    {epoch: {[Op.gt]: maxOne.epoch}},
                    {[Op.and]: [{epoch: maxOne.epoch}, {position: {[Op.gt]: maxOne.position}}]},
                ]
            },
            // minus 1 will make the target record be the BLOCK_PAGE_MARK_SIZE(th) one.
            offset: BLOCK_PAGE_MARK_SIZE - 1,
            // logging: console.log, benchmark: true
        })
        if (higherAnchor === null) {
            console.log(`\nHigher anchor not found, want higher than: epoch ${maxOne.epoch
            } position ${maxOne.position}`)
            return
        }
        const saved = await BlockRowMark.create({
            id: maxOne.id + BLOCK_PAGE_MARK_SIZE,
            epoch: higherAnchor.epoch, position: higherAnchor.position
        })
        maxOne = saved
        process.stdout.write(`\r\u001b[2K ${count} ${JSON.stringify(saved)}`)
    } while (--count>0)
    console.log(`\n MarkBlockPosition done.`)
}