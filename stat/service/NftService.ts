import {Op} from 'sequelize'
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Hex40Map, makeIdV} from "../model/HexMap";
import {NftMint} from "../model/Token";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {init} from "./tool/FixDailyTokenStat";

export class NftService {
    zeroAddrId:number

    async setup() {
        const hex = '0'.padStart(40, '0')
        this.zeroAddrId = await makeIdV(hex)
        console.log(`setup zero addr id to ${this.zeroAddrId}`)
    }

    // sync from exists transfer record from DB
    async checkByEpoch(from, range, model) : Promise<Erc721Transfer[]> {
        return model.findAll({where:{fromId: this.zeroAddrId, epoch:{[Op.between]:[from, from+range]}}})
    }
    async saveIds(list:any/*Erc721Transfer*/[]) {
        const beans:any[] = list.map(t=>{
            const b = {contractId: t.contractId, createdAt: t.createdAt,
                toId: t.toId, tokenId: t.tokenId, txHashId: t.txHashId}
            return b
        })
        return NftMint.bulkCreate(beans,{
            updateOnDuplicate:["updatedAt","toId","txHashId"],
            logging: false
        })
    }
    async checkAll(from) {
        await this.setup()
        const stop = Math.max(
            await Erc721Transfer.max('epoch'),
            await Erc1155Transfer.max('epoch'))
        const batch = 1000
        while(from <= stop) {
            let count = 0
            const result = await this.checkByEpoch(from, batch-1, Erc721Transfer).then(list=>{
                count += list.length
                return this.saveIds(list)
            }).then(()=>{
                return this.checkByEpoch(from, batch-1, Erc1155Transfer)
            }).then(list=>{
                count += list.length
                return this.saveIds(list)
            }).catch(err=>{
                console.log(`error at [${from},${from+batch-1}]`, err)
                return -1
            })
            if (result === -1) {
                break;
            }
            from += batch
            process.stdout.write(`\r\u001b[2K fixed count ${count}, to epoch ${from+batch-1}, will stop at ${stop}   $`)
        }
        console.log(`\n done ${from}, stop ${stop}`)
    }
}


if (module === require.main) {
    init().then(cfg=>{
        const args = process.argv.slice(2)
        let from = args[0]
        return new NftService().checkAll(Number(from))
    }).then(()=>{
        return NftMint.sequelize.close()
    })
}