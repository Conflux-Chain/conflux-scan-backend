import {Blacklist} from "../model/Blacklist";
import {ethers} from "ethers";
import {format} from "js-conflux-sdk";
import {StatApp} from "../StatApp";
import {Token} from "../model/Token";

export class Desensitizer {
    private static BLACKLIST: any = {};

    public async markBlacklist(
        {
            address,
            remark = 'sensitive info',
        }: {
            address: string,
            remark?: string,
        }): Promise<boolean> {
        await Blacklist.sequelize.transaction(async (dbTx) => {
            await Blacklist.upsert({address, remark} as Blacklist, { transaction: dbTx });
            await Token.update({auditResult: false} as Token, { where: {base32: address}, transaction: dbTx });
        });

        return true;
    }

    public async scheduleRefreshBlacklist(delay = 1000 * 10) {
        async function repeat() {
            await Desensitizer.refreshBlacklist().catch(err => {
                console.log(`blacklist_refresh fail: `, err);
            });
            setTimeout(repeat, delay);
        }

        repeat().then();
        console.log(`schedule blacklist_refresh service in 1s interval`);
    }

    public static mosaicStr(address: string, str: string) {
        if (Desensitizer.skipMosaic(address, str)) {
            return str;
        }

        const len = str.length;
        return len === 1 ? str : `${str.substr(0, 1)}***${str.substr(len - 1, len)}`;
    }

    public static mosaicUri(address: string, str: string) {
        if (Desensitizer.skipMosaic(address, str)) {
            return str;
        }

        return '';
    }

    public static mosaicIcon(address: string, str: string) {
        if (Desensitizer.skipMosaic(address, str)) {
            return str;
        }

        return '';
    }

    private static async refreshBlacklist() {
        const blacklists = await Blacklist.findAll({raw: true});

        const blacklistInfo = {};
        blacklists?.forEach(item => {
            const hex = format.hexAddress(item.address);
            const base32 = format.address(item.address, StatApp.isEVM);
            const checkSum = ethers.utils.getAddress(hex);
            blacklistInfo[hex] = item['updatedAt'];
            blacklistInfo[base32] = item['updatedAt'];
            blacklistInfo[checkSum] = item['updatedAt'];
        });

        Desensitizer.BLACKLIST = blacklistInfo;
    }

    private static skipMosaic(address: string, str: string) {
        return !address || !str || !(Desensitizer.BLACKLIST)[address];
    }
}
