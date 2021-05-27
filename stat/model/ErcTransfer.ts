import {Op} from "sequelize";
import {fmtDtUTC} from "./Utils";
let logCount = 100
export async function popPartition(epoch: number, fullTransfer: any, partitionT:any) {
    if (logCount-- > 0) {
        console.log(`${fmtDtUTC(new Date())} PopPartition epoch ${epoch} ---`)
    }
    // let fullTransfer = Erc20Transfer;
    // let partitionT = AddressErc20Transfer;
    return fullTransfer.findAll({where: {epoch}}).then(arr => {
        if (arr.length) {
            const addrIds = new Set<number>()
            arr.forEach(row => {
                addrIds.add(row.fromId)
                addrIds.add(row.toId)
            })
            return Promise.all([
                partitionT.destroy({
                    where: {
                        epoch, addressId: {[Op.in]: [...addrIds]}
                    }
                }),
                fullTransfer.destroy({where: {epoch}})
            ])
        }
    });
}