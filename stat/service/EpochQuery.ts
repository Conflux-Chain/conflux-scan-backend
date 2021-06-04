import {Epoch} from "../model/Epoch";

export class EpochQuery{
    protected app;

    constructor(app: any) {
        this.app = app;
    }

    async query(epochNumber: number) {
        const{ logger } = this.app;
        return Epoch.findOne({where: {epoch: epochNumber}, raw: true});
    }
}
