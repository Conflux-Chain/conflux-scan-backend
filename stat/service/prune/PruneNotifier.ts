import {RedisWrap, PRUNE_Q, xLen} from "../RedisWrap";
import {PruneType} from "../../model/PruneInfo";
import {Erc20Transfer} from "../../model/Erc20Transfer";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";

export class PruneNotifier {

    private static LEN_QUEUE_TOTAL = 10000;

    // message format:
    // {
    //     [PruneType.ERC20_TRANSFER]: [{pruneLoop,delRowsPerLoop,sleepMsPerLoop,addressId},],
    //     [PruneType.ADDR_ERC20_TRANSFER]: [{pruneLoop,delRowsPerLoop,sleepMsPerLoop,addressId},],
    // }
    public static async notifyPrune(msg){
        if(!(await PruneNotifier.checkEnqueueAble())) {
            return;
        }
        return RedisWrap.sendStreamMessage(msg, PRUNE_Q).then();
    }

    public static async notifyBlock(minerBlockArray){
        const minerIdSet = new Set<number>();
        minerBlockArray.forEach(block => minerIdSet.add(block.minerId));

        const msg = {
            [PruneType.MINER_BLOCK]: [...minerIdSet],
        };
        // console.log(`prune_notify[type=block],queueLen:${await xLen(PRUNE_Q)},msg:${JSON.stringify(msg)}`);
        return PruneNotifier.notifyPrune(msg);
    }

    public static async notifyTransaction(executedTxArr){
        const addressIdSet = new Set<number>();
        executedTxArr.forEach(transaction => {
            if(transaction.fromId !== 0) addressIdSet.add(transaction.fromId);
            if(transaction.toId !== 0) addressIdSet.add(transaction.toId);
        });

        const msg = {
            [PruneType.ADDR_TX]: [...addressIdSet],
        };
        // console.log(`prune_notify[type=tx],queueLen:${await xLen(PRUNE_Q)},msg:${JSON.stringify(msg)}`);
        return PruneNotifier.notifyPrune(msg);
    }

    public static async notifyCFXTransfer(addressCfxTransferArray){
        const addressIdSet = new Set<number>();
        addressCfxTransferArray.forEach(cfxTransfer => {
            if(cfxTransfer.addressId !== 0) addressIdSet.add(cfxTransfer.addressId);
        });

        const msg = {
            [PruneType.ADDR_CFX_TRANSFER]: [...addressIdSet],
        };
        // console.log(`prune_notify[type=cfxTransfer],queueLen:${await xLen(PRUNE_Q)},msg:${JSON.stringify(msg)}`);
        return PruneNotifier.notifyPrune(msg);
    }

    public static async notifyTokenTransfer(model, contractIdAndAddressSetMap: Map<number,Set<number>>){
        const contractIdArray = [];
        const addressIdSet = new Set<number>();
        contractIdAndAddressSetMap.forEach((addrIdSet, contractId) => {
            if(contractId === 13870862){
                contractIdArray.push(contractId);
                addrIdSet.forEach(addrId => addressIdSet.add(addrId));
            } else{
                // NO-OP
            }
        });
        const addressIdArray = [...addressIdSet];

        const msg = {};
        if(model === Erc20Transfer){
            msg[PruneType.ERC20_TRANSFER] = contractIdArray;
            msg[PruneType.ADDR_ERC20_TRANSFER] = addressIdArray;
        } else if(model === Erc721Transfer){
            msg[PruneType.ERC721_TRANSFER] = contractIdArray;
            msg[PruneType.ADDR_ERC721_TRANSFER] = addressIdArray;
        } else if(model === Erc1155Transfer){
            msg[PruneType.ERC1155_TRANSFER] = contractIdArray;
            msg[PruneType.ADDR_ERC1155_TRANSFER] = addressIdArray;
        } else {
            return;
        }

        // console.log(`prune_notify[type=tokenTransfer],queueLen:${await xLen(PRUNE_Q)},msg:${JSON.stringify(msg)}`);
        return PruneNotifier.notifyPrune(msg);
    }

    private static async checkEnqueueAble() {
        const len = await xLen(PRUNE_Q);
        return len <= PruneNotifier.LEN_QUEUE_TOTAL;
    }
}
