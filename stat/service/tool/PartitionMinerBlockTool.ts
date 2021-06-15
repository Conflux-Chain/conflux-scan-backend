import {FullMinerBlock, buildFullMinerBlock} from "../../model/FullMinerBlock";
import {FullBlock} from "../../model/FullBlock";
import {init} from "./FixDailyTokenStat";
import {Op} from 'sequelize'

let epochMaxToSync = 0
let epochMinToSyn = -1
let epochMaxAddressTable = -1
export async function checkBoundary(times: number, full_t, partition_t) {
    console.log(`partition miner_block ${full_t.getTableName()} ----- ${partition_t.getTableName()}`)
    await Promise.all([
        full_t.min('epoch'),
        full_t.max('epoch'),
    ]).then(([epochMinInDB, epochMaxInDB]) => {
        console.log(`loopMinerBlock---full_table minEpoch:${epochMinInDB} maxEpoch:${epochMaxInDB}`)
        epochMaxToSync = Number(epochMaxInDB)
        epochMinToSyn = Number(epochMinInDB)
        // force epoch [from, to]
        if (args.length >= 3) {
            epochMaxToSync = Number(args[2])
            return Number(args[1]) - 1
        }
        return partition_t.max('epoch')
    }).then(epochMaxInAddressTable => {
        if (!isNaN(Number(epochMaxInAddressTable))) {
            console.log(`loopMinerBlock---use address_table maxEpoch:${epochMaxInAddressTable}`)
            epochMaxAddressTable = Number(epochMaxInAddressTable)
        } else {
            console.log(`loopMinerBlock---use full_table minEpoch:${epochMinToSyn}`)
            epochMaxAddressTable = epochMinToSyn - 1
        }
    }).catch(err => {
        console.log(`setup loop fail:`, err)
    })
}
export async function loopMinerBlock(times: number, full_t, partition_t) {
    await checkBoundary(times, full_t, partition_t)
    console.log(`loopMinerBlock---full table maxEpoch:${epochMaxToSync}, address table minEpoch:${epochMaxAddressTable}, begin run ${times}`)
    while (times > 0 && epochMaxAddressTable <= epochMaxToSync) {
        // find min epoch greater than previous processed.
        await full_t.min("epoch", {where:{
            epoch: {[Op.gt]:epochMaxAddressTable}
        }}).then(higherEpoch=> {
            if (isNaN(Number(higherEpoch))) {
                return Promise.reject(`loopMinerBlock---no higher epoch > ${epochMaxAddressTable}`); // not found
            }
            epochMaxAddressTable = Number(higherEpoch)
            return full_t.findAll({where:{epoch: higherEpoch},
            })
        }).then(list=>{
            if (list.length > 0) {
                const copies = buildFullMinerBlock(list)
                return partition_t.bulkCreate(copies,{
                }).then(arr=>{
                    process.stdout.write(`\r\u001b[2K epoch:${epochMaxAddressTable} table:${partition_t.getTableName()} insert:${arr.length
                        }, currentTime:${list[0].createdAt.toISOString()}`)
                })
            }
        }).catch(err=>{
            console.log(`loopMinerBlock---Error at epoch ${epochMaxToSync}:`, err)
            times = -1
        })
        //
        times--
    }
    console.log(`\n loopMinerBlock---Done.`)
}

//           0     1       2
// node this 5 <lowFrom> <highEnd>
const args = process.argv.slice(2)
init().then(()=>{
    return loopMinerBlock(Number(args[0] || 1), FullBlock, FullMinerBlock)
}).catch(err=>{
    console.log(`loopMinerBlock error:`, err)
}).then(()=>{
    return FullBlock.sequelize.close()
})
