import {Sequelize} from "sequelize";
import {RankService} from "../service/RankService";
import {STATE_INIT, STATE_OK, TOP_CFX_HOLD, TopBatchIndex, TopRecord} from "../model/TopRecord";
import {makeId} from "../model/HexMap";
import {hex} from "./GenData";

export class TestRank{
    async buildTestData(seq: Sequelize) {
        const dt = new Date();
        const type = TOP_CFX_HOLD
        const batch = await TopBatchIndex.create({state: STATE_INIT, beginTime: dt, endTime: dt, type})
        await TopRecord.create({batchId: batch.id, rank: 1, valueN: 111, addressId: (await makeId(hex(40))).id})
        await TopRecord.create({batchId: batch.id, rank: 2, valueN: 110, addressId: (await makeId(hex(40))).id})
        batch.state = STATE_OK
        await batch.save()
    }
    async testTop(seq: Sequelize) {
        const svc = new RankService(seq)
        const list = await svc.top(TOP_CFX_HOLD, 10)
        console.log(`test top done, list size ${list.length}`)
        list.forEach(r=>{
            console.log(`${r.hex}, ${r.valueN}, ${r.rank}`)
        })
    }
}