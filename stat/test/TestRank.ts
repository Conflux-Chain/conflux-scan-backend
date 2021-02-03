import {Sequelize} from "sequelize";
import {RankService} from "../service/RankService";
import {STATE_INIT, STATE_OK, TOP_CFX_HOLD, TopBatchIndex, TopRecord} from "../model/TopRecord";
import {ADDR_INFO_STATE_OK, AddressInfo, makeId} from "../model/HexMap";
import {hex} from "./GenData";

export class TestRank{
    async buildTestData(seq: Sequelize) {
        const dt = new Date();
        const type = TOP_CFX_HOLD
        const batch = await TopBatchIndex.create({state: STATE_INIT, beginTime: dt, endTime: dt, type})
        let v = 100000000
        for (let i=0; i<101; i++) {
            let addr = await makeId(hex(40));
            await TopRecord.create({batchId: batch.id, rank: (i+1), percent: i < 10 ? i : 0,
                valueN: v-i, addressId: addr.id, value2: 1000+i})
            if (i < 5) {
                await AddressInfo.upsert({
                    remark: "", state: ADDR_INFO_STATE_OK, id: addr.id,
                    name: `testName${i}`, createAt: dt, updateAt: dt})
            }
        }
        batch.state = STATE_OK
        await batch.save()
    }
    async testTop(seq: Sequelize) {
        const svc = new RankService(seq)
        const {list, total} = await svc.top(TOP_CFX_HOLD, 10)
        console.log(`test top done, list size ${list.length}, total ${total}`)
        list.forEach(r=>{
            console.log(`${r.hex}, ${r.valueN}, ${r.rank}, percent ${r.percent}, txn ${r.value2}`)
        })
    }
}