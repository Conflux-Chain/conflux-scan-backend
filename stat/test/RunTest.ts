import {Sequelize as DB} from "sequelize";
import {Epoch} from "../model/Epoch";
import {hex, hex64, rnd} from "./GenData";
import {Hex40Map} from "../model/HexMap";
import {BlockAndMinerSync} from "../service/BlockAndMinerSync";
import {TxnSync} from "../service/TxnSync";
import {createDB, initModel} from "../service/DBProvider";
import {QueryTypes} from "sequelize";
import {fmtDtUTC} from "../model/Utils";
import {loadConfig} from "../config/StatConfig";
import {KV} from "../model/KV";
import {TestRank} from "./TestRank";

const {makeId} = require("../model/HexMap");

const config = loadConfig('Prod')
const sequelize = createDB(config.database)

async function createEpoch() {
    const epochNumber = 1;
    await Epoch.destroy({where: {epoch: epochNumber}})
    await Epoch.create({epoch: epochNumber, pivotHash: hex64(), timestamp: new Date()})
    const count = await Epoch.count({})
    console.info(`add epoch ok, total size ${count}`)
    await Epoch.destroy({where: {epoch: epochNumber}})
}

async function createTx() {

}

async function testIdAndModel() {
    let addr = hex(40);
    let bean = await makeId(addr)
    await makeId(addr)
    // h64map
    // await h64map.save()
    console.info(`bean is ${JSON.stringify(bean)}, id is ${bean.id}, hex is ${addr}`)
    await Hex40Map.destroy({where: {id: bean.id}})
    let count;
    count = await Hex40Map.count({})
    console.info(`count is ${count}`)

    await createEpoch();
    await createTx();
}

async function testConfig() {
    let testConfigKey = "test";
    const value = await KV.getNumber(testConfigKey)
    console.info(`config is ${value}`)
    const updateConfig = await KV.update({value: '2'},
        {where: {key: testConfigKey}})
    if (updateConfig[0] === 0) {
        const created = await KV.create({key: testConfigKey, value: '2'})
        console.log('created config: ', created)
    }
    console.log('update config ret:', updateConfig)
}

async function testTopMinerBlock() {
    // let dataBlockService = new BlockAndMinerSync(sequelize, config.conflux);
    // // await DataBlockService.checkDBSize()
    // await dataBlockService.topByType(30, 'd', 20).then(list => {
    //     console.log('top miners', list)
    // })
}

async function run(){
    await sequelize.authenticate();
    await initModel(sequelize)

    if (config.database?.syncSchema) {
        console.log('sync model begin.')
        await sequelize.sync({alter: false}).catch(err=>{
            console.log(`sync fail: `, err)
        })
    } else {
        console.log(`skip sync schema.`)
    }
    console.log('---------------init models done------------')

    // let blockAndMinerSync = new BlockAndMinerSync(sequelize, config.conflux);
    // await new DataBlockService(sequelize).rollup();
    // await new DataBlockService(sequelize).rollupStatPerHour().then(()=>{
    //     console.info(`rollup per hour done. `)
    // });
    // await testTopMinerBlock();
    // await testTxSync()
    await new TestRank().testTop(sequelize)
    // const porter = new DataPorter(sequelize, config.conflux)
    // await porter.copyEpoch(5882304);
    // await testIdAndModel();
    // await testConfig();
    // await testTimezone(sequelize)
    sequelize.close().then()
}



run().then()
