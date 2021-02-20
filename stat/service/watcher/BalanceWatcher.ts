// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {Model} from "sequelize";
import {Balance, DexCfxBalance, DexUSDTBalance, USDTBalance, WCfxBalance} from "../../model/Balance";
import {KEY_BALANCE_POS_PREFIX, KV} from "../../model/KV";
import {Hex40Map} from "../../model/HexMap";
import {fmtDtUTC} from "../../model/Utils";

export class BalanceWatcher{
    private miniERC20: any;
    private cfx: Conflux;
    protected fraction = 1e+18
    protected addressPos = -1;
    protected model: typeof Balance
    protected name:string
    // save address position in DB, in order to `scan` balance of all addresses.
    protected addressPosKey:string

    constructor(name:string, contractAddr: string, cfx:Conflux) {
        this.name = name
        this.cfx = cfx;
        const { abi, bytecode } = require('./contract/miniERC20.json');
        this.miniERC20 = cfx.Contract({ abi, bytecode , address: contractAddr});
        switch (name) {
            case 'wcfx':        this.model = WCfxBalance;       break;
            case 'dex-cfx':     this.model = DexCfxBalance;     break;
            case 'usdt':        this.model = USDTBalance;       break;
            case 'dex-usdt':    this.model = DexUSDTBalance;    break;
            default:
                throw new Error('unknown balance type, please fix the mapping code.')
        }
    }

    async schedule(delay:number = 100) {
        // @ts-ignore
        await this.cfx.updateNetworkId()
        // @ts-ignore
        console.log(`network id ${this.cfx.networkId}`)
        //
        const position = await KV.findOne({where:{key: this.addressPosKey}})
        if (position == null) {
            await KV.create({key: this.addressPosKey, value: "0"})
        }
        //
        const that = this;
        async function repeat() {
            await that.run()
            setTimeout(repeat, delay)
        }
        repeat().then()
        console.log(`schedule balance watcher : ${this.name}`)
    }

    async run() {
        // console.log(`run balance watcher ${this.name}`)
        let lastId = await KV.getNumber(this.addressPosKey)
        let curId = lastId + 1
        this.addressPos = curId
        const hex = await Hex40Map.findByPk(curId)
        if (hex !== null) {
            await this.queryBalance('0x'+hex.hex, hex.id)
        } else if (curId > (await Hex40Map.max("id"))){
            console.log(`reach max, id: ${curId}`)
            curId = 0
        }
        await KV.update({value: curId.toString()}, {where:{key: this.addressPosKey}})
    }

    async queryBalance(hex: string, addrId: number) {
        try {
            // @ts-ignore
            const ban = await this.miniERC20.balanceOf(format.address(hex, this.cfx.networkId));
            await this.save(addrId, ban);
            if (this.addressPos % 100 === 0) {
                console.log(`${fmtDtUTC(new Date())} update balance, position of ${this.addressPosKey
                } is ${this.addressPos}`)
            }
        } catch (err) {
            console.log(`execute fail:`, err)
        }

    }

    protected async save(addrId: number, ban: any) {

    }
}
export class Erc20Watcher extends BalanceWatcher{
    async schedule(delay: number = 100): Promise<void> {
        this.addressPosKey = KEY_BALANCE_POS_PREFIX + this.name;
        await super.schedule(delay);
    }

    protected async save(addrId: number, ban: any) {
        if (ban < 1) {
            await this.model.destroy({where: {addressId: addrId}})
            return Promise.resolve();
        }
        ban = ban / BigInt(this.fraction)
        await this.model.upsert({addressId:addrId, balance: ban}, {});
    }
}