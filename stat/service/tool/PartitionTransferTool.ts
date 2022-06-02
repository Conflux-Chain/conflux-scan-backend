import {AddressErc20Transfer, buildTransferList2address, Erc20Transfer} from "../../model/Erc20Transfer";
import {init} from "./FixDailyTokenStat";
import {Op} from 'sequelize'
import {AddressErc721Transfer, Erc721Transfer} from "../../model/Erc721Transfer";
// import {AddressErc777Transfer, Erc777Transfer} from "../../model/Erc777Transfer";
import {AddressErc1155Transfer, Erc1155Transfer} from "../../model/Erc1155Transfer";
import {AddressCfxTransfer, CfxTransfer} from "../../model/CfxTransfer";


let epochMax = 0
let epochMin = -1
let erc20transferEpochMax = -1
export async function checkBoundary(times: number, full_t, partition_t) {
    // const full_t = Erc20Transfer
    // const partition_t = AddressErc20Transfer

    /*
     select min(epoch), max(epoch) from erc20transfer;
     select * from address_erc20_transfer limit 10;
     */
    console.log(`partition transfer ${full_t.getTableName()} ----- ${partition_t.getTableName()}`)
    await Promise.all([
        full_t.max('epoch'),
        full_t.min('epoch'),
    ]).then(([epochMax0, minEpochDB]) => {
        console.log(`full transfer min ${minEpochDB} max ${epochMax0}`)
        epochMax = Number(epochMax0)
        epochMin = Number(minEpochDB)
        if (args.length >= 3) {
            // force epoch [from, to]
            epochMax = Number(args[3])
            return Number(args[2]) - 1
        }
        return partition_t.max('epoch')
    }).then(addr20tMax => {
        if (!isNaN(Number(addr20tMax))) {
            console.log(`use partition max ${addr20tMax}`)
            erc20transferEpochMax = Number(addr20tMax)
        } else {
            console.log(`use full transfer, before ${epochMin}`)
            erc20transferEpochMax = epochMin - 1
        }
    }).catch(err => {
        console.log(`setup loop fail:`, err)
    })
}
export async function loop20transfer(times: number, full_t, partition_t) {
    await checkBoundary(times, full_t, partition_t)
    console.log(`full transfer epoch at ${epochMax}, partition epoch ${erc20transferEpochMax
        }, begin run ${times}`)
    while (times > 0 && erc20transferEpochMax <= epochMax) {
        // find min epoch greater than previous processed.
        await full_t.min("epoch", {where:{
            epoch: {[Op.gt]:erc20transferEpochMax}
        }}).then(higherEpoch=> {
            if (isNaN(Number(higherEpoch))) {
                // not found
                return Promise.reject(`no higher epoch > ${erc20transferEpochMax}`)
            }
            erc20transferEpochMax = Number(higherEpoch)
            return full_t.findAll({where:{epoch: higherEpoch},
                // logging:console.log
            })
        }).then(list=>{
            if (list.length > 0) {
                const copies = buildTransferList2address(list)
                return partition_t.bulkCreate(copies,{

                }).then(arr=>{
                    process.stdout.write(`\r\u001b[2K epoch ${erc20transferEpochMax} addresses ${partition_t.getTableName()} ${arr.length
                        } time ${list[0].createdAt.toISOString()}`)
                })
            }
        }).catch(err=>{
            console.log(`\nError at epoch ${epochMax}:`, err)
            times = -1
        })
        //
        times--
    }
    console.log(`\n Done.`)
}
const args = process.argv.slice(2)
//             0   1   2     3
// node this erc20 5 <lowFrom> <highEnd>
init().then(()=>{
    switch(args[0]) {
        case 'erc20':
            return loop20transfer(Number(args[1] || 1), Erc20Transfer, AddressErc20Transfer)
        case 'erc721':
            return loop20transfer(Number(args[1] || 1), Erc721Transfer, AddressErc721Transfer)
        // case 'erc777':
        //     return loop20transfer(Number(args[1] || 1), Erc777Transfer, AddressErc777Transfer)
        case 'erc1155':
            return loop20transfer(Number(args[1] || 1), Erc1155Transfer, AddressErc1155Transfer)
        case 'cfx':
            return loop20transfer(Number(args[1] || 1), CfxTransfer, AddressCfxTransfer)
        default:
            console.log(`unknown action: should be [any one of erc20, erc721, erc777, erc1155, cfx]`)
    }
}).catch(err=>{
    console.log(`error:`, err)
}).then(()=>{
    return Erc20Transfer.sequelize.close()
})