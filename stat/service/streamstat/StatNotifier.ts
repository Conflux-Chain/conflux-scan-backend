import {
    RedisWrap,
    STREAM_STAT_ADDR_CFX_TRANSFER_Q,
    STREAM_STAT_ADDR_TRANSACTION_Q, STREAM_STAT_DAILY_CFX_TRANSFER_Q, STREAM_STAT_DAILY_TOKEN_TRANSFER_Q,
    STREAM_STAT_TOKEN_TRANSFER_Q
} from "../RedisWrap";

export class StatNotifier {

    public static SWITCH_STREAM_STAT = true;

    public static async notifyStat({msg, q}) {
        if (!StatNotifier.filter({msg})) {
            return;
        }
        return RedisWrap.sendStreamMessage(msg, q).then();
    }

    public static async notifyStatTokenTransfer({epochNumber, epochTimestamp, action, tokenTransfer}) {
        const msg = {epochNumber, epochTimestamp, action, statInfo: tokenTransfer};
        return RedisWrap.sendStreamMessage(msg, STREAM_STAT_TOKEN_TRANSFER_Q).then();
    }

    public static async notifyStatAddrTransaction({epochNumber, epochTimestamp, action, txnArray}){
        const statInfo = {};
        txnArray.forEach(txn => {
            if(txn.fromId !== 0) {
                statInfo[txn.fromId] = statInfo[txn.fromId] === undefined ? [0, 0, 0] :  statInfo[txn.fromId];
                statInfo[txn.fromId][0] = statInfo[txn.fromId][0] + 1;
                statInfo[txn.fromId][2] = statInfo[txn.fromId][2] + txn.gas;
            }
            if(txn.toId !== 0) {
                statInfo[txn.toId] = statInfo[txn.toId] === undefined ? [0, 0, 0] :  statInfo[txn.toId];
                statInfo[txn.toId][1] = statInfo[txn.toId][1] + 1;
            }
        });

        const msg = {epochNumber, epochTimestamp, action, statInfo};
        return RedisWrap.sendStreamMessage(msg, STREAM_STAT_ADDR_TRANSACTION_Q).then();
    }

    public static async notifyStatAddrCfxTransfer({epochNumber, epochTimestamp, action, cfxTransferArray}){
        const statInfo = {};
        cfxTransferArray.forEach(transfer => {
            if(transfer.fromId !== 0) {
                statInfo[transfer.fromId] = statInfo[transfer.fromId] === undefined ? [0, 0] :  statInfo[transfer.fromId];
                statInfo[transfer.fromId][0] = statInfo[transfer.fromId][0] + 1;
            }
            if(transfer.toId !== 0) {
                statInfo[transfer.toId] = statInfo[transfer.toId] === undefined ? [0, 0] :  statInfo[transfer.toId];
                statInfo[transfer.toId][1] = statInfo[transfer.toId][1] + 1;
            }
        });

        const msg = {epochNumber, epochTimestamp, action, statInfo};
        return RedisWrap.sendStreamMessage(msg, STREAM_STAT_ADDR_CFX_TRANSFER_Q).then();
    }

    public static async notifyStatDailyCfxTransfer({epochNumber, epochTimestamp, action, cfxTransferArray}){
        if(!cfxTransferArray?.length){
            return ;
        }
        const statInfo = {0: [cfxTransferArray.length]};
        const msg = {epochNumber, epochTimestamp, action, statInfo};
        return RedisWrap.sendStreamMessage(msg, STREAM_STAT_DAILY_CFX_TRANSFER_Q).then();
    }

    public static async notifyStatDailyTokenTransfer({epochNumber, epochTimestamp, action, tokenTransfer}) {
        if(!tokenTransfer?.length){
            return ;
        }
        const statInfo = {0: [tokenTransfer.length]};
        const msg = {epochNumber, epochTimestamp, action, statInfo};
        return RedisWrap.sendStreamMessage(msg, STREAM_STAT_DAILY_TOKEN_TRANSFER_Q).then();
    }

    private static filter({msg}) {
        return StatNotifier.SWITCH_STREAM_STAT === true;
    }
}
