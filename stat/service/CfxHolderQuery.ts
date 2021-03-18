import {DailyCfxHolder} from "../model/DailyCfxHolder";

export class CfxHolderQuery{

    async listCfxHolderDaily(skip: number = 0, limit: number = 10) {
        const query: any = {}
        const page = await DailyCfxHolder.findAndCountAll({
            attributes: ['statDay', 'holderCount'],
            where: query, offset: skip, limit, order:[["statDay", "DESC"]]
        })
        return page;
    }
}
