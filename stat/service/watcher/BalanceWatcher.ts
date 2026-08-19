import {Conflux, format} from "js-conflux-sdk";
import {Model, Op} from "sequelize";
import {
    CfxBalance,
} from "../../model/Balance";
import {StatApp} from "../../StatApp";
import {DynamicBalanceModel} from "./DynamicBalanceModel";
import {formatUnits} from "ethers";

/**
 * Scan all address's balance of configured contracts.
 * For erc1155, we also need maintain all the token ids, by calling scan json rpc.
 */
export class BalanceWatcher{
    //
    static watcherMap = new Map<string, BalanceWatcher>()
    //
    public cfx: Conflux;
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
        // `toString()` to avoid scientific notation, (1.23e20).
        await model.upsert({addressId:addrId, balance: ban.toString()}, {});
    }

    public static drip2cfx(drip, fraction) {
        const decimals = BalanceWatcher.fractionToDecimals(fraction)
        return formatUnits(BigInt(drip), decimals)
    }

    private static fractionToDecimals(fraction): number {
        let value = BigInt(fraction)
        if (value <= 0n) {
            throw new Error(`invalid fraction: ${fraction}`)
        }

        let decimals = 0
        while (value > 1n && value % 10n === 0n) {
            value /= 10n
            decimals += 1
        }

        if (value !== 1n) {
            throw new Error(`fraction must be power of 10: ${fraction}`)
        }

        return decimals
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
            const balanceDrip = BigInt(accountInfo.balance)
            const stakingDrip = BigInt(accountInfo.stakingBalance)

            if (balanceDrip < 1n && stakingDrip < 1n) {
                await CfxBalance.destroy({where: {addressId: addrId}})
                return Promise.resolve();
            }
            const cfx = BalanceWatcher.drip2cfx(balanceDrip, this.fraction)
            const staking = BalanceWatcher.drip2cfx(stakingDrip, this.fraction)
            const total = BalanceWatcher.drip2cfx(balanceDrip + stakingDrip, this.fraction)
            await CfxBalance.upsert({addressId: addrId, balance:cfx, stakingBalance: staking,
                total: total})
        } catch (err) {
            console.log(`query cfx account fail:`, err)
        }
    }
}
