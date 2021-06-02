// @ts-ignore
import {Hex40Map} from "../model/HexMap";
import {FullTransaction} from "../model/FullBlock";
import {TraceCreateContract} from "../model/TraceCreateContract";

export class HomeDashboardService{
    protected app;
    protected data;

    constructor(app: any) {
        this.app = app;
    }

    public getData(){
        return this.data;
    }

    public async schedule(delay: number = 1000) {
        const{ logger } = this.app;

        logger?.info({src: 'HomeDashboardService', msg: `schedule home_dashboard_service with delay: ${delay}`})
        const that = this
        async function repeat() {
            await that.run().catch(err =>{
                logger?.info({src: 'HomeDashboardService', msg: `home_dashboard_service fail, error: ${err}`})
            })
            setTimeout(repeat, delay)
        }
        repeat().then()
    }

    private async run() {
      const{ logger } = this.app;
      const addressCount = await Hex40Map.count({});
      const transactionCount = await FullTransaction.count({});
      const contractCount = await TraceCreateContract.count({});
      // logger?.info({src: 'HomeDashboardService', msg: `addressCount:${addressCount}, transactionCount:${transactionCount}, contractCount:${contractCount}`})
      this.data = {addressCount, transactionCount, contractCount};
    }
}
