import {RedisWrap, PRUNE_Q} from "../RedisWrap";
import {PruneType} from "../../model/PruneInfo";
import {Erc20Transfer} from "../../model/Erc20Transfer";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";

export class PruneNotifier {

    public static SWITCH_SYNC_PRUNE = false;

    // message format:
    // {
    //     [PruneType.ERC20_TRANSFER]: [{pruneLoop,delRowsPerLoop,sleepMsPerLoop,addressId},],
    //     [PruneType.ADDR_ERC20_TRANSFER]: [{pruneLoop,delRowsPerLoop,sleepMsPerLoop,addressId},],
    // }
    public static async notifyPrune(msg){
        if(!PruneNotifier.filter(msg)) {
            return;
        }
        return RedisWrap.sendStreamMessage(msg, PRUNE_Q).then();
    }

    public static async notifyBlock(minerBlockArray){
        const minerIdSet = new Set<number>();
        minerBlockArray.forEach(block => minerIdSet.add(block.minerId));
        const pruneInfoArray = [...minerIdSet].map(minerId => ({addressId: minerId}));

        const msg = {
            [PruneType.MINER_BLOCK]: pruneInfoArray,
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
        const pruneInfoArray = [...addressIdSet].map(addressId => ({addressId}));

        const msg = {
            [PruneType.ADDR_TX]: pruneInfoArray,
        };
        // console.log(`prune_notify[type=tx],queueLen:${await xLen(PRUNE_Q)},msg:${JSON.stringify(msg)}`);
        return PruneNotifier.notifyPrune(msg);
    }

    public static async notifyCFXTransfer(addressCfxTransferArray){
        const addressIdSet = new Set<number>();
        addressCfxTransferArray.forEach(cfxTransfer => {
            if(cfxTransfer.addressId !== 0) addressIdSet.add(cfxTransfer.addressId);
        });
        const pruneInfoArray = [...addressIdSet].map(addressId => ({addressId}));

        const msg = {
            [PruneType.ADDR_CFX_TRANSFER]: pruneInfoArray,
        };
        // console.log(`prune_notify[type=cfxTransfer],queueLen:${await xLen(PRUNE_Q)},msg:${JSON.stringify(msg)}`);
        return PruneNotifier.notifyPrune(msg);
    }

    public static async notifyTokenTransfer(model, contractIdAndAddressSetMap: Map<number,Set<number>>){
        const contractIdArray = [];
        const addressIdSet = new Set<number>();
        contractIdAndAddressSetMap.forEach((addrIdSet, contractId) => {
            contractIdArray.push(contractId);
            addrIdSet.forEach(addrId => addressIdSet.add(addrId));
        });
        const addressIdArray = [...addressIdSet];

        const tokenPruneInfoArray = contractIdArray.map(contractId => ({addressId: contractId}));
        const addressPruneInfoArray = addressIdArray.map(addressId => ({addressId}));

        const msg = {};
        if(model === Erc20Transfer){
            msg[PruneType.ERC20_TRANSFER] = tokenPruneInfoArray;
            msg[PruneType.ADDR_ERC20_TRANSFER] = addressPruneInfoArray;
        } else if(model === Erc721Transfer){
            msg[PruneType.ERC721_TRANSFER] = tokenPruneInfoArray;
            msg[PruneType.ADDR_ERC721_TRANSFER] = addressPruneInfoArray;
        } else if(model === Erc1155Transfer){
            msg[PruneType.ERC1155_TRANSFER] = tokenPruneInfoArray;
            msg[PruneType.ADDR_ERC1155_TRANSFER] = addressPruneInfoArray;
        } else {
            return;
        }
        // console.log(`prune_notify[type=tokenTransfer],queueLen:${await xLen(PRUNE_Q)},msg:${JSON.stringify(msg)}`);
        return PruneNotifier.notifyPrune(msg);
    }

    private static filter(msg) {
        let isFiltered = false;

        if (!PruneNotifier.SWITCH_SYNC_PRUNE) {
            return isFiltered;
        }

        // just prune token transfer
        if(msg[PruneType.ERC20_TRANSFER] || msg[PruneType.ADDR_ERC20_TRANSFER]
            || msg[PruneType.ERC721_TRANSFER] || msg[PruneType.ADDR_ERC721_TRANSFER]
            || msg[PruneType.ERC1155_TRANSFER] || msg[PruneType.ADDR_ERC1155_TRANSFER]){
            isFiltered = true;
        }
        delete msg[PruneType.MINER_BLOCK];
        delete msg[PruneType.ADDR_TX];
        delete msg[PruneType.ADDR_CFX_TRANSFER];

        return isFiltered;
    }
}
