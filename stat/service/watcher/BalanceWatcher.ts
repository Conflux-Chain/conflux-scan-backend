import {Conflux, format} from "js-conflux-sdk";
import {Model, Op} from "sequelize";
import {
    CfxBalance,
} from "../../model/Balance";
import {StatApp} from "../../StatApp";
import {DynamicBalanceModel} from "./DynamicBalanceModel";
const BigFixed = require('bigfixed');

/**
 * Scan all address's balance of configured contracts.
 * For erc1155, we also need maintain all the token ids, by calling scan json rpc.
 */
export class BalanceWatcher{
    //
    static watcherMap = new Map<string, BalanceWatcher>()
    //
    protected cfx: Conflux;
    protected fraction = BigInt(1e+18) // hard code, please search 1e+18 globally when fixing it.

    constructor(cfx:Conflux) {
        this.cfx = cfx;
    }

    static mapModel(name:string, silent:boolean = false, contractId: number = -1)/*: typeof Balance | DynamicBalanceModel*/{
        if (contractId > -1) {
            return new DynamicBalanceModel(contractId)
        }
        if (silent) {
            return null
        }
        throw new Error('unknown balance type, please fix the mapping code. name:'+name)
    }


    async queryBalance(hex: string, addrId: number) {

    }
    public static async saveModel(model, addrId: number, ban: any, needScale = true, fraction: any) {
        if (ban < 1) {
            await model.destroy({where: {addressId: addrId}})
            return Promise.resolve();
        }
        if (needScale) {
            ban = BalanceWatcher.drip2cfx(ban, fraction)
        }
        await model.upsert({addressId:addrId, balance: ban}, {});
    }

    public static drip2cfx(drip, fraction) {
        return BigFixed(drip).div(BigFixed(fraction))
    }
}
export class CfxWatcher extends BalanceWatcher{
    constructor(name:string, cfx:Conflux) {
        super(cfx);
    }
    async queryBalance(hex: string, addrId: number): Promise<void> {
        try {
            // @ts-ignore
            const accountInfo:any = await this.cfx.getAccount(format.address(hex, StatApp.networkId))
            if (accountInfo.balance < 1 && accountInfo.stakingBalance < 1) {
                await CfxBalance.destroy({where: {addressId: addrId}})
                return Promise.resolve();
            }
            const cfx:any = BalanceWatcher.drip2cfx(accountInfo.balance, this.fraction)
            const staking:any = BalanceWatcher.drip2cfx(accountInfo.stakingBalance, this.fraction)
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
