import {RedisWrap, STREAM_STAT_ADDR_TRANSACTION_Q, STREAM_STAT_TOKEN_TRANSFER_Q} from "../RedisWrap";

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
                statInfo[txn.fromId] = statInfo[txn.fromId] === undefined ? [0, 0] :  statInfo[txn.fromId];
                statInfo[txn.fromId][0] = statInfo[txn.fromId][0] + 1;
            }
            if(txn.toId !== 0) {
                statInfo[txn.toId] = statInfo[txn.toId] === undefined ? [0, 0] :  statInfo[txn.toId];
                statInfo[txn.toId][1] = statInfo[txn.toId][1] + 1;
            }
        });

        const msg = {epochNumber, epochTimestamp, action, statInfo};
        return RedisWrap.sendStreamMessage(msg, STREAM_STAT_ADDR_TRANSACTION_Q).then();
    }

    private static filter({msg}) {
        return StatNotifier.SWITCH_STREAM_STAT === true;
    }
}
