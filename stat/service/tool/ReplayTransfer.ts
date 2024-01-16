// replay transfer records, build balance table.
import {Erc20Transfer} from "../../model/Erc20Transfer";
import {Op} from 'sequelize'
import {handleTokenTransferWithContract} from "../../StreamSync";
import {init} from "./FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {initCfxSdk} from "../common/utils";
import {StatApp} from "../../StatApp";
import {BatchBalanceWatcher} from "../watcher/BatchBalanceWatcher";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {Token} from "../../model/Token";

async function loop(token:Token, cfx: Conflux) {
    const type = token.type.substring(3);
    const batch = 11000;
    const model = {'20':Erc20Transfer, '1155': Erc1155Transfer, '721': Erc721Transfer}[type]
    const list = await model.findAll({
        attributes: ["fromId", "toId", "contractId"],
        where: {contractId: token.hex40id},
        order: [['epoch', 'desc']],
        limit: batch,
    })
    const map = new Map<number,Set<number>>()
    for (const t of list) {
        let set = map.get(t.contractId)
        if (!set) {
            set = new Set<number>()
            map.set(t.contractId, set)
        }
        set.add(t.fromId)
        set.add(t.toId)
    }
    console.log(` replay: name ${token.name} transfer x ${list.length}` )
    // this function will split the whole task to small pieces, don't worry.
    await handleTokenTransferWithContract(map, cfx)
}
async function setup(config){
    const cfx = await initCfxSdk(config.conflux);
    // init contract
    // @ts-ignore
    StatApp.networkId = cfx.networkId
    console.log(` network id ${StatApp.networkId}`)
    const utilContract = await BatchBalanceWatcher.getUtilContractAddr();
    console.log(` util contract ${utilContract}`)
    new BatchBalanceWatcher(cfx,null, utilContract)
    // type could be 20, 721, 1155
    const [,,from, type] = process.argv
    const tokenList = await Token.findAll({
        attributes: ['hex40id','symbol','name','base32', 'type'],
        where: {destroyed: false, type: 'ERC20'}, raw: true,
    })
    console.log(`token count ${tokenList.length}`)
    for (const token of tokenList) {
        await loop(token, cfx)
    }
}
init().then((config)=> {
    return setup(config)
})
