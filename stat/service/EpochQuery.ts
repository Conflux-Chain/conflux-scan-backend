import {Epoch} from "../model/Epoch";

export class EpochQuery{
    protected app;

    constructor(app: any) {
        this.app = app;
    }

    async query(epochNumber: number) {
        return await Epoch.findOne({where: {epoch: epochNumber}, raw: true});
    }
}
