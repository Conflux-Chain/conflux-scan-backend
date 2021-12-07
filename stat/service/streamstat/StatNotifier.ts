import {RedisWrap} from "../RedisWrap";

export class StatNotifier {

    public static SWITCH_STREAM_STAT = true;

    public static async notifyStat({msg, q}) {
        if (!StatNotifier.filter({msg})) {
            return;
        }
        return RedisWrap.sendStreamMessage(msg, q).then();
    }

    public static async notifyStatTokenTransfer({msg, q}) {
        return StatNotifier.notifyStat({msg, q});
    }

    private static filter({msg}) {
        return StatNotifier.SWITCH_STREAM_STAT === true;
    }
}
