import {Sequelize} from 'sequelize';
// @ts-ignore
import {format} from 'js-conflux-sdk';
import {Token} from "../model/Token";
import {makeId} from "../model/HexMap";
const addressSdk = require('js-conflux-sdk/src/util/address')
const lodash = require('lodash');
const superagent = require('superagent');
import {decodeUtf8} from "./tool/StringTool";

export class TokenSync{
    private sequelize: Sequelize;
    private config: {scanApiUrl:string};
    private pageSize: number = 10;

    constructor(sequelize: Sequelize, config:{scanApiUrl:string}) {
        this.sequelize = sequelize;
        this.config = config
    }

    public async listToken(fields, transferType, orderBy, reverse, skip: number = 0, limit: number = 10) {
        const options: any = {};
        // fields
        let attributes: any = [['base32', 'address'],
            'name',
            'symbol',
            'decimals',
            'totalSupply',
            ['holder', 'holderCount'],
            ['transfer', 'transferCount'],
            ['type', 'transferType']
        ];
        if(fields && fields.indexOf('icon') > 0){
            attributes.push('icon');
        }
        if(fields && fields.indexOf('price') > 0){
            attributes.push('price');
            attributes.push('quoteUrl');
            attributes.push('totalPrice');
        }
        options.attributes = attributes;

        // query
        const query: any = {};
        if(transferType){
            query.type = transferType;
        }
        options.where = query;

        // page
        options.offset = skip;
        options.limit = limit;

        // order by
        let order: any;
        if(orderBy){
            if(orderBy === 'transferCount'){
                orderBy = 'transfer';
            }
            if(orderBy === 'holderCount'){
                orderBy = 'holder';
            }
            const orderItem = [];
            orderItem.push(orderBy);
            orderItem.push(reverse === 'true' ? 'DESC' : 'ASC');
            order = [];
            order.push(orderItem);
            options.order = order;
        }
        const page = await Token.findAndCountAll(options)
        if(page && page.rows){
            page.rows.forEach( row => {
                if(row.icon) {
                    row.icon = decodeUtf8(row.icon);
                }
            });
        }
        return page;
    }

    private async run() {
        let skip = 0;
        let total;
        let currPage = 1;
        do{
            let response = await this.getFromScan(skip, this.pageSize);
            if(!response) return;
            total = total ? total : response.total;
            console.log('sync toke_list currPage======>', currPage, ',skip======>', skip, ',total======>', total );

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
            .query(`fields=transferCount%2Cicon%2Cprice%2CtotalPrice%2CquoteUrl%2CtransactionCount%2Cerc20TransferCount&skip=${skip}&limit=${limit}`)
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
            const now = new Date();
            await that.run().catch(err=>{
                console.log(`sync toke_list fail: `, err);
            });
            const delay = 60;// in minutes
            setTimeout(repeat, delay * 60 *  1000);
            console.log(`sync toke_list service in delay ${delay}min.`);
        }
        repeat().then();
    }
}

