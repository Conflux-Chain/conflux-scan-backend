// @ts-ignore
import {format} from 'js-conflux-sdk';
import {StatApp} from "../StatApp";
import {Sequelize} from 'sequelize';
import {Token} from "../model/Token";
import {makeId} from "../model/HexMap";
const addressSdk = require('js-conflux-sdk/src/util/address')
const lodash = require('lodash');
const superagent = require('superagent');
import {KV, KEY_TOKEN_SYNC_BY_SCAN_SWITCH} from "../model/KV";

export class TokenSync{
    private app: StatApp;
    private sequelize: Sequelize;
    private config: {scanApiUrl:string};
    private pageSize: number = 10;

    constructor(app: any) {
        this.app = app;
        this.sequelize = app.sequelize;
        this.config = app.config
    }

    private async run() {
        const rdbSwitch = await KV.getSwitch(KEY_TOKEN_SYNC_BY_SCAN_SWITCH);
        if (!rdbSwitch) {
           return;
        }

        let skip = 0;
        let total;
        let currPage = 1;
        do{
            let response = await this.getFromScan(skip, this.pageSize).catch(err=>{
                console.log(`error get from scan:`, err)
            });
            if(!response) return;
            total = total ? total : response.total;
            console.log('sync toke_list currPage======', currPage, ',skip======', skip, ',total======', total );

            const tokenList = response.list;
            for (const token of tokenList) {
                const base32 = addressSdk.simplifyCfxAddress(token.address);
                const dbToken: Token = await Token.findOne({where: {base32}});
                if(dbToken){
                    const t = lodash.assign(token, {type: token.transferType,
                        transfer: token.transferCount, updatedAt: Date.now()});
                    await dbToken.update(t, {where: {id: dbToken.id}});
                } else{
                    const hex40 = format.hexAddress(token.address);
                    const hexBean = await makeId(hex40);
                    const t = lodash.assign(token, {type: token.transferType,
                        transfer: token.transferCount, base32, hex40id: hexBean.id, holder: 0});
                    await Token.add(t);
                }
            }
            skip = (++currPage - 1) * this.pageSize ;
        } while (skip <= total);
    }

    private async getFromScan(skip: number = 0, limit: number = 10): Promise<{ total: number, list: any }>{
        const response = await superagent.get(`${this.config.scanApiUrl}/v1/token`)
            .query(`fields=transferCount%2Cicon%2Cprice%2CtotalPrice%2CquoteUrl%2CtransactionCount%2Cerc20TransferCount
            %2CmarketCapId%2CmoonDexSymbol%2CbinanceSymbol
            &skip=${skip}&limit=${limit}`)
            .timeout(60 * 1000);
        if (response.status !== 200) {
            console.log('sync toke_list fail:', JSON.stringify(response));
            return;
        }
        return response.body;
    }

    // 1hour interval
    public async schedule() {
        const that = this;
        async function repeat() {
            await that.run().catch(err=>{
                console.log(`sync toke_list fail: `, err);
            });
            const delay = 60;// in minutes
            setTimeout(repeat, delay * 60 *  1000);
            console.log(`sync toke_list service in delay ${delay}min.`);
        }
        try {
            repeat().then().catch(err => {
                console.log(`schedule TokenSync fail:`, err)
            });
        } catch (err) {
            console.log(`catch error token sync:`, err)
        }
    }
}