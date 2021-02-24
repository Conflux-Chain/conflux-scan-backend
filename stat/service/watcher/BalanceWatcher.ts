// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {Model} from "sequelize";
import {
    Balance,
    Balance_cBAND, Balance_cBTC,
    Balance_cCOMP,
    Balance_cDAI, Balance_cDF,
    Balance_cETH,
    Balance_cFOR, Balance_cKNC, Balance_cKP3R,
    Balance_cLEND,
    Balance_cLINK,
    Balance_cMOON,
    Balance_CRCL_BTC_symbol, Balance_cSNX, Balance_csUSD, Balance_cSWRV, Balance_cUMA,
    Balance_cUSDC, Balance_cYFI, Balance_cYFII,
    Balance_FC,
    CfxBalance,
    DexCfxBalance,
    DexUSDTBalance,
    USDTBalance,
    WCfxBalance
} from "../../model/Balance";
import {KEY_BALANCE_POS_PREFIX, KV} from "../../model/KV";
import {Hex40Map} from "../../model/HexMap";
import {fmtDtUTC} from "../../model/Utils";
const BigFixed = require('bigfixed');

export class BalanceWatcher{
    private miniERC20: any;
    protected cfx: Conflux;
    protected fraction = BigInt(1e+18)
    protected addressPos = -1;
    protected model: typeof Balance
    protected name:string
    // save address position in DB, in order to `scan` balance of all addresses.
    protected addressPosKey:string

    constructor(name:string, contractAddr: string, cfx:Conflux) {
        this.name = name
        this.cfx = cfx;
        this.model = BalanceWatcher.mapModel(name)
        if (contractAddr) {
            const {abi, bytecode} = require('./contract/miniERC20.json');
            this.miniERC20 = cfx.Contract({abi, bytecode, address: contractAddr});
        }
    }

    static mapModel(name:string): typeof Balance{
        let ret;
        switch (name) {
            case 'wcfx':        ret = WCfxBalance;       break;
            case 'dex-cfx':     ret = DexCfxBalance;     break;
            case 'usdt':        ret = USDTBalance;       break;
            case 'dex-usdt':    ret = DexUSDTBalance;    break;
            case 'cfx':         ret = CfxBalance;    break;

            case 'CRCL_BTC_symbol':         ret = Balance_CRCL_BTC_symbol;    break;
            case 'cMOON':         ret = Balance_cMOON;    break;
            // case 'cUSDT':         ret = BalancecUSDT;    break;
            case 'cETH':         ret = Balance_cETH;    break;
            case 'FC':         ret = Balance_FC;    break;
            // case 'WCFX':         ret = BalanceWCFX;    break;
            case 'cDAI':         ret = Balance_cDAI;    break;
            case 'cUSDC':         ret = Balance_cUSDC;    break;
            case 'cLEND':         ret = Balance_cLEND;    break;
            case 'cFOR':         ret = Balance_cFOR;    break;
            case 'cLINK':         ret = Balance_cLINK;    break;
            case 'cCOMP':         ret = Balance_cCOMP;    break;
            case 'cBAND':         ret = Balance_cBAND;    break;
            case 'cBTC':         ret = Balance_cBTC;    break;
            case 'cYFI':         ret = Balance_cYFI;    break;
            case 'cDF':         ret = Balance_cDF;    break;
            case 'cYFII':         ret = Balance_cYFII;    break;
            case 'cSWRV':         ret = Balance_cSWRV;    break;
            case 'cKP3R':         ret = Balance_cKP3R;    break;
            case 'cUMA':         ret = Balance_cUMA;    break;
            case 'cKNC':         ret = Balance_cKNC;    break;
            case 'cSNX':         ret = Balance_cSNX;    break;
            case 'csUSD':         ret = Balance_csUSD;    break;

            default:
                throw new Error('unknown balance type, please fix the mapping code. name:'+name)
        }
        return ret;
    }

    async schedule(delay:number = 100) {
        this.addressPosKey = KEY_BALANCE_POS_PREFIX + this.name;
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
            console.log(`${fmtDtUTC(new Date())} ${this.addressPosKey} reach max, id: ${curId}`)
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
        if (ban < 1) {
            await this.model.destroy({where: {addressId: addrId}})
            return Promise.resolve();
        }
        ban = this.drip2cfx(ban)
        await this.model.upsert({addressId:addrId, balance: ban}, {});
    }

    protected drip2cfx(drip) {
        return BigFixed(drip).div(BigFixed(this.fraction))
    }
}
export class CfxWatcher extends BalanceWatcher{
    constructor(name:string, cfx:Conflux) {
        super(name, null, cfx);
    }
    async queryBalance(hex: string, addrId: number): Promise<void> {
        try {
            // @ts-ignore
            const accountInfo:any = await this.cfx.getAccount(format.address(hex, this.cfx.networkId))
            if (accountInfo.balance < 1 && accountInfo.stakingBalance < 1) {
                await this.model.destroy({where: {addressId: addrId}})
                return Promise.resolve();
            }
            const cfx:any = this.drip2cfx(accountInfo.balance)
            const staking:any = this.drip2cfx(accountInfo.stakingBalance)
            const total = cfx.add(staking)
            await CfxBalance.upsert({addressId: addrId, balance:cfx, stakingBalance: staking,
                total: total})
        } catch (err) {
            console.log(`query cfx account fail:`, err)
        }
    }
}
export class Erc20Watcher extends BalanceWatcher{
}