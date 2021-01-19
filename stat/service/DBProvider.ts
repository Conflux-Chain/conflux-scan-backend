import {Sequelize} from "sequelize";
import {hexMapInit} from "../model/HexMap";
import {Epoch} from "../model/Epoch";
import {TransactionDB} from "../model/Transaction";
import {Block} from "../model/Block";
import {MinerBlock} from "../model/MinerBlock";
import {KV} from "../model/KV";
import {TestTimezone} from "../model/TestTimezone";
import {Database} from "../config/StatConfig";
let conf
export function createDB(config) {
    conf = config
    if (isMySQL()) {
        return createMySql(config)
    }
    let storage = config.sqlitePath || './data/database.sqlite';
    const sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: storage,
        logging: config.logging || false,
    });
    console.info(`create sqlite: ${storage}`)
    return sequelize
}

export function getDBConf() : Database{
    return conf;
}

/**
 * sqlite sum() specification: https://sqlite.org/lang_aggfunc.html
 * Use total() instead of sum() to avoid `integer overflow`.
 */
export function getSumFunction() : string{
    // sqlite uses `total`
    return isMySQL() ? 'SUM' : 'TOTAL'
}
export function isMySQL() : boolean {
    return conf.USE_MYSQL === true
}
export async function initModel(sequelize) {
    await sequelize.authenticate().then(()=>{
        console.log('DB authenticated.')
    }).catch(err=>{
        console.log(`connect to DB fail`, err)
    });
    hexMapInit(sequelize);
    Epoch.register(sequelize);
    TransactionDB.register(sequelize);
    Block.register(sequelize);
    MinerBlock.register(sequelize);
    KV.register(sequelize);
    TestTimezone.register(sequelize);
}

export function createMySql(dbConf) {
    console.log(`create mysql ${dbConf.host}`)
    return new Sequelize(dbConf.database,
        dbConf.user,
        dbConf.pwd, {
        host: dbConf.host,
        dialect: 'mysql', /* one of 'mysql' | 'mariadb' | 'postgres' | 'mssql' */
        // logging: console.log,            // default true
            logging: false,
        // timezone: '+08:00', // default UTC
        // dialectOptions: {
        //   useUTC: false,
        // },
    });
}