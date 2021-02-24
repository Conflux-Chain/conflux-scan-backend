import {Balance} from "../../model/Balance";
import {Token} from "../../model/Token";
import {Erc20WatchList} from "../../config/StatConfig";
import {Hex40Map} from "../../model/HexMap";
// @ts-ignore
import {format} from "js-conflux-sdk";
import {BalanceWatcher} from "./BalanceWatcher";

export class BalanceService {
    private tokens: Erc20WatchList[];
    private readonly networkId: number;

    constructor(erc20watchList: Erc20WatchList[], networkId:number = 1029) {
        this.tokens = erc20watchList
        this.networkId = networkId;
    }

    public schedule(delay: number = 60_000) {
        const that = this
        async function repeat() {
            await that.run()
            setTimeout(repeat, delay)
        }
        repeat().then()
    }

    async run() {
        this.tokens.forEach(t=>{
            this.updateToken(t)
        })
    }

    public async updateToken(token: Erc20WatchList) {
        const hexBean = await Hex40Map.findOne({where: {hex: token.address.substr(2)}})
        if (hexBean == null) {
            console.log(`token address not found in hex map: ${token.name}, ${token.address}`)
            return;
        }
        let tokenBean:Token = await Token.findOne({where: {hex40id: hexBean.id}});
        if (tokenBean == null) {
            tokenBean = await Token.create({
                base32: format.address(token.address, this.networkId),
                hex40id: hexBean.id, holder: 0,
                symbol: token.name
            })
        }
        //
        let table: typeof Balance;
        try {
            table = BalanceWatcher.mapModel(token.name);
        } catch (err) {
            console.log(`table not found for ${token.name}`)
            return;
        }
        let holder = await table.count({})
        await tokenBean.update({holder: holder}, {where: {id: tokenBean.id}})
    }
}