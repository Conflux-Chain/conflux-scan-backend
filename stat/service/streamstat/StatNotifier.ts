import {
    GAS_USED_PER_SECOND_Q,
    RedisWrap,
    STREAM_STAT_ADDR_CFX_TRANSFER_Q,
    STREAM_STAT_ADDR_TRANSACTION_Q,
    STREAM_STAT_DAILY_CFX_TRANSFER_Q,
    STREAM_STAT_DAILY_TOKEN_TRANSFER_Q,
    STREAM_STAT_MINER_BLOCK_Q,
    STREAM_STAT_NFT_MINT_Q,
    STREAM_STAT_TOKEN_TRANSFER_Q
} from "../RedisWrap";
import {FullBlock} from "../../model/FullBlock";

export class StatNotifier {

    public static SWITCH_STREAM_STAT = false;
    // stat-block
    public static SWITCH_STAT_MINER_BLOCK = false;
    public static SWITCH_STAT_ADDR_TRANSACTION = false;
    public static SWITCH_STAT_GAS_USED_PER_SECOND = false;
    // scan-cfx-transfer
    public static SWITCH_STAT_DAILY_CFX_TRANSFER = false;
    public static SWITCH_STAT_ADDR_CFX_TRANSFER = false;
    // stat-epoch
    public static SWITCH_STAT_TOKEN_TRANSFER = false;
    public static SWITCH_STAT_DAILY_TOKEN_TRANSFER = false;
    public static SWITCH_STAT_NFT_MINT = false;

    public static async notifyStat({msg, q}) {
        if (!StatNotifier.filter({msg, q})) {
            return Promise.resolve(false);
        }

        const epochNumber = msg.epochNumber;
        if(epochNumber && (epochNumber % 100 === 0)){
            console.log(`[q=${q}]notifyStat msg:${JSON.stringify(msg)}`);
        }

        return RedisWrap.sendStreamMessage(msg, q).then();
    }

    // stat-block
    public static async notifyStatMinerBlock({epochNumber, epochTimestamp, action, blockList}){
        if (!StatNotifier.SWITCH_STAT_MINER_BLOCK) {
            return Promise.resolve(false);
        }

        const blockArray = await FullBlock.findAll({
            attributes: ['hash', 'minerId', 'difficulty'], where: {epoch: epochNumber}, raw: true,
        });
        const blockInfoMap = {};
        blockArray.forEach(block => blockInfoMap[block.hash] = {minerId: block.minerId, difficulty: block.difficulty})

        const statInfo = {};
        blockList.forEach(block => {
            const blockInfo = blockInfoMap[block.hash];
            if(!blockInfo) return;
            const minerId = blockInfo.minerId;
            const difficulty = blockInfo.difficulty;
            if(minerId !== 0) {
                statInfo[minerId] = statInfo[minerId] === undefined ? [0, 0, 0, 0] :  statInfo[minerId];
                statInfo[minerId][0] = statInfo[minerId][0] + 1;
                statInfo[minerId][1] = BigInt(statInfo[minerId][1]) + BigInt(block.totalReward);
                statInfo[minerId][2] = BigInt(statInfo[minerId][2]) + BigInt(block.txFee);
                statInfo[minerId][3] = BigInt(statInfo[minerId][3]) + BigInt(difficulty);
            }
        });

        const msg = {epochNumber, epochTimestamp, action, statInfo};
        return StatNotifier.notifyStat({msg, q: STREAM_STAT_MINER_BLOCK_Q});
    }

    // stat-block
    public static async notifyStatAddrTransaction({epochNumber, epochTimestamp, action, txnArray}){
        if (!StatNotifier.SWITCH_STAT_ADDR_TRANSACTION) {
            return Promise.resolve(false);
        }

        if(!txnArray?.length){
            return Promise.resolve(false);
        }

        const statInfo = {};
        txnArray.forEach(txn => {
            if(txn.fromId !== 0) {
                statInfo[txn.fromId] = statInfo[txn.fromId] === undefined ? [0, 0, 0] :  statInfo[txn.fromId];
                statInfo[txn.fromId][0] = statInfo[txn.fromId][0] + 1;
                statInfo[txn.fromId][2] = BigInt(statInfo[txn.fromId][2]) + BigInt(txn.gas);
            }
            if(txn.toId !== 0) {
                statInfo[txn.toId] = statInfo[txn.toId] === undefined ? [0, 0, 0] :  statInfo[txn.toId];
                statInfo[txn.toId][1] = statInfo[txn.toId][1] + 1;
            }
        });

        const msg = {epochNumber, epochTimestamp, action, statInfo};
        return StatNotifier.notifyStat({msg, q: STREAM_STAT_ADDR_TRANSACTION_Q});
    }

    // stat-block
    public static async notifyStatGasUsedPerSecond({epochNumber, epochTimestamp, action, txnArray}) {
        if (!StatNotifier.SWITCH_STAT_GAS_USED_PER_SECOND) {
            return Promise.resolve(false);
        }

        if(!txnArray?.length){
            return Promise.resolve(false);
        }

        let gasLimitTotal = BigInt(0)
        for (const tx of txnArray) {
            gasLimitTotal =  gasLimitTotal + tx.gasLimit
        }
        const statInfo = {gasLimit: gasLimitTotal};
        const msg = {epochNumber, epochTimestamp, action, statInfo};
        // console.log(`notifyStatGasUsedPerSecond ${JSON.stringify(msg)}`)
        return StatNotifier.notifyStat({msg, q: GAS_USED_PER_SECOND_Q});
    }

    // stat-cfx-transfer
    public static async notifyStatDailyCfxTransfer({epochNumber, epochTimestamp, action, cfxTransferArray}){
        if (!StatNotifier.SWITCH_STAT_DAILY_CFX_TRANSFER) {
            return Promise.resolve(false);
        }

        if(!cfxTransferArray?.length){
            return Promise.resolve(false);
        }

        const valueSum = cfxTransferArray.map(row=>row.value).reduce((a,b)=>a+b, BigInt(0));
        const statInfo = {0: [cfxTransferArray.length, valueSum]};
        const msg = {epochNumber, epochTimestamp, action, statInfo};
        return StatNotifier.notifyStat({msg, q: STREAM_STAT_DAILY_CFX_TRANSFER_Q});
    }

    // stat-cfx-transfer
    public static async notifyStatAddrCfxTransfer({epochNumber, epochTimestamp, action, cfxTransferArray}){
        if (!StatNotifier.SWITCH_STAT_ADDR_CFX_TRANSFER) {
            return Promise.resolve(false);
        }

        if(!cfxTransferArray?.length){
            return Promise.resolve(false);
        }

        const statInfo = {};
        cfxTransferArray.forEach(transfer => {
            if(transfer.fromId !== 0) {
                statInfo[transfer.fromId] = statInfo[transfer.fromId] === undefined ? [0, 0, 0, 0] :  statInfo[transfer.fromId];
                statInfo[transfer.fromId][0] = statInfo[transfer.fromId][0] + 1;
                statInfo[transfer.fromId][2] = BigInt(statInfo[transfer.fromId][2]) + transfer.value;
            }
            if(transfer.toId !== 0) {
                statInfo[transfer.toId] = statInfo[transfer.toId] === undefined ? [0, 0, 0, 0] :  statInfo[transfer.toId];
                statInfo[transfer.toId][1] = statInfo[transfer.toId][1] + 1;
                statInfo[transfer.toId][3] = BigInt(statInfo[transfer.toId][3]) + transfer.value;
            }
        });

        const msg = {epochNumber, epochTimestamp, action, statInfo};
        return StatNotifier.notifyStat({msg, q: STREAM_STAT_ADDR_CFX_TRANSFER_Q});
    }

    // stat-epoch
    public static async notifyStatTokenTransfer({epochNumber, epochTimestamp, action, tokenTransfer}) {
        if (!StatNotifier.SWITCH_STAT_TOKEN_TRANSFER) {
            return Promise.resolve(false);
        }

        const addrIdArray = Object.keys(tokenTransfer)
        if(!addrIdArray?.length){
            return Promise.resolve(false);
        }

        const msg = {epochNumber, epochTimestamp, action, statInfo: tokenTransfer};
        return StatNotifier.notifyStat({msg, q: STREAM_STAT_TOKEN_TRANSFER_Q});
    }

    // stat-epoch
    public static async notifyStatDailyTokenTransfer({epochNumber, epochTimestamp, action, tokenTransfer}) {
        if (!StatNotifier.SWITCH_STAT_DAILY_TOKEN_TRANSFER) {
            return Promise.resolve(false);
        }

        const addrIdArray = Object.keys(tokenTransfer)
        if(!addrIdArray?.length){
            return Promise.resolve(false);
        }

        let transferCntr = 0;
        addrIdArray.forEach(addrId => {
            transferCntr += tokenTransfer[addrId][0];
        });

        const statInfo = {0: [transferCntr]};
        const msg = {epochNumber, epochTimestamp, action, statInfo};
        return StatNotifier.notifyStat({msg, q: STREAM_STAT_DAILY_TOKEN_TRANSFER_Q});
    }

    // stat-epoch
    public static async notifyStatNFTMint({epochNumber, epochTimestamp, action, nftMint}){
        if (!StatNotifier.SWITCH_STAT_NFT_MINT) {
            return Promise.resolve(false);
        }

        const addrIdArray = Object.keys(nftMint)
        if(!addrIdArray?.length){
            return Promise.resolve(false);
        }

        const msg = {epochNumber, epochTimestamp, action, statInfo: nftMint};
        // console.log(`notifyStatNFTMint ${JSON.stringify(msg)}`);
        return StatNotifier.notifyStat({msg, q: STREAM_STAT_NFT_MINT_Q});
    }

    private static filter({msg, q}) {
        return StatNotifier.SWITCH_STREAM_STAT === true;
    }
}
