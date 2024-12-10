import {Sequelize} from "sequelize";
import {RankService} from "../service/RankService";
import {hex} from "./GenData";
// @ts-ignore
import {format} from 'js-conflux-sdk'

export class TestRank{

    async testTop(seq: Sequelize) {
        const svc = new RankService(seq)
        const {list, total} = await svc.top('TOP_CFX_HOLD', 10)
        console.log(`test top done, list size ${list.length}, total ${total}`)
        list.forEach(r=>{
            console.log(`${r.hex}, ${r.valueN}, ${r.rank}, percent ${r.percent}, txn ${r.value2}, name ${r.name}`)
        })
    }
}
