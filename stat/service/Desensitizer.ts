import {Blacklist} from "../model/Blacklist";
import {ethers} from "ethers";
import {format} from "js-conflux-sdk";
import {StatApp} from "../StatApp";
import {KEY_BLACKLIST_DISABLE, KV} from "../model/KV";

export class Desensitizer {
    private static BLACKLIST: any = {};

    constructor() {
        this.scheduleRefreshBlacklist().then();
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
        const disable = await KV.getSwitch(KEY_BLACKLIST_DISABLE);
        if (disable) {
            Desensitizer.BLACKLIST = {};
            return;
        }

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
