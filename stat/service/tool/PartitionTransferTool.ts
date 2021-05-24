import {FullTransaction} from "../../model/FullBlock";
import {AddressErc20Transfer, build20transferList2address, Erc20Transfer} from "../../model/Erc20Transfer";
import {init} from "./FixDailyTokenStat";
export async function copy20transferByEpoch(epoch: number) {

}

export async function loop20transfer(times: number) {
    let epochMax = 0
    let epochMin = -1
    let erc20transferEpochMax = -1
    /*
     select min(epoch), max(epoch) from erc20transfer;
     select * from address_erc20_transfer limit 10;
     */
    await Promise.all([
        Erc20Transfer.max('epoch'),
        Erc20Transfer.min('epoch'),
    ]).then(([epochMax0, minEpochDB])=>{
        console.log(`full transfer min ${minEpochDB} max ${epochMax0}`)
        epochMax = Number(epochMax0)
        epochMin = Number(minEpochDB)
        return AddressErc20Transfer.max('epoch')
    }).then(addr20tMax=>{
        if (!isNaN(Number(addr20tMax))) {
            console.log(`use partition max ${addr20tMax}`)
            erc20transferEpochMax = Number(addr20tMax)
        } else {
            console.log(`use full transfer, before ${epochMin}`)
            erc20transferEpochMax = epochMin - 1
        }
    }).catch(err=>{
        console.log(`setup loop fail:`, err)
    })
    console.log(`full 20 transfer epoch at ${epochMax}, partition epoch ${erc20transferEpochMax
        }, begin run ${times}`)
    while (times > 0 && erc20transferEpochMax <= epochMax) {
        erc20transferEpochMax += 1
        await Erc20Transfer.findAll({where:{epoch: erc20transferEpochMax},
            // logging:console.log
        }).then(list=>{
            if (list.length > 0) {
                const copies = build20transferList2address(list)
                return AddressErc20Transfer.bulkCreate(copies,{

                }).then(arr=>{
                    process.stdout.write(`\r\u001b[2K epoch ${erc20transferEpochMax} addresses 20transfer ${arr.length}`)
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
// node this erc20 5
init().then(()=>{
    switch(args[0]) {
        case 'erc20':
            return loop20transfer(Number(args[1] || 1))
        default:
            console.log(`unknown action: should be [erc20]`)
    }
}).catch(err=>{
    console.log(`error:`, err)
}).then(()=>{
    return Erc20Transfer.sequelize.close()
})