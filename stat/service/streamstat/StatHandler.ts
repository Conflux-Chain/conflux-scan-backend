import {StatApp} from "../../StatApp";
import {PRUNE_Q, RedisStreamMessage, RedisWrap} from "../RedisWrap";

export abstract class StatHandler {

    protected app: StatApp;
    protected constructor(app: StatApp) {
        this.app = app;
    }

    protected abstract getModel(type: {type: string}): any;
    protected abstract buildBaseQuery({type, pruneParas}): {where: any, key: any};

    public async schedule(delay = 10) {
        await this.listen();

        async function repeat() {
            await StatHandler.refreshConfig().catch(err=>{
                console.log(`prune_refresh_conf fail: `, err);
            });
            setTimeout(repeat, delay);
        }
        repeat().then();
        console.log(`schedule prune_refresh_conf service in 1s interval`);
    }

    private async listen() {
        return RedisWrap.listenStreamMessage(PRUNE_Q, (data) => this.handle(data));
    }

    private static async refreshConfig(){
    }

    private async handle(data:RedisStreamMessage[]) {
        for (const item of data) {
            const {message} = item;
            for (const type of Object.keys(message)) {

            }
        }
        return RedisWrap.xDel(data);
    }

}
