import {RedisWrap, PRUNE_Q, xLen} from "../RedisWrap";
import {PruneType} from "../../model/PruneInfo";
import {hex40IdMap} from "../../model/HexMap";
import {format} from "js-conflux-sdk";

export class PruneNotifier {

    private static LEN_QUEUE_TOTAL = 10000;

    // message format:
    // {
    //     [PruneType.ERC20_TRANSFER]: [...hex40id],
    //     [PruneType.ADDR_ERC20_TRANSFER]: [...hex40id],
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
        return PruneNotifier.notifyPrune(msg);
        // console.log(`prune_notify[type=block],queueLen:${await xLen(PRUNE_Q)},msg:${JSON.stringify(msg)}`);
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
        return PruneNotifier.notifyPrune(msg);
        // console.log(`prune_notify[type=tx],queueLen:${await xLen(PRUNE_Q)},msg:${JSON.stringify(msg)}`);
    }

    public static async notifyCFXTransfer(addressCfxTransferArray){
        const addressIdSet = new Set<number>();
        addressCfxTransferArray.forEach(cfxTransfer => {
            if(cfxTransfer.addressId !== 0) addressIdSet.add(cfxTransfer.addressId);
        });

        const msg = {
            [PruneType.ADDR_CFX_TRANSFER]: [...addressIdSet],
        };
        return PruneNotifier.notifyPrune(msg);
        // console.log(`prune_notify[type=cfxTransfer],queueLen:${await xLen(PRUNE_Q)},msg:${JSON.stringify(msg)}`);
    }

    public static async notifyTokenTransfer(groupedLogs){
        const { transfer20Array, transfer721Array, transfer1155Array } = groupedLogs;

        // collect hex
        const allAddrSet = new Set<string>();
        const addressInfoArray = [transfer20Array, transfer721Array, transfer1155Array].map(transferArray => {
            const contractSet = new Set<string>();
            const addressSet = new Set<string>();
            transferArray?.forEach(transfer => {
                const from = format.hexAddress(transfer.from);
                const to = format.hexAddress(transfer.to);
                const contract = format.hexAddress(transfer.address);
                addressSet.add(from);
                addressSet.add(to);
                contractSet.add(contract);
                allAddrSet.add(from);
                allAddrSet.add(to);
                allAddrSet.add(contract);
            });
            return {contractArray: [...contractSet], addressArray: [...addressSet]}
        });

        // query db
        if(allAddrSet.size === 0) return;
        const addressHexIdMap = await hex40IdMap([... allAddrSet]);

        // collect hex id
        const addressIdInfoArray = addressInfoArray.map(addressInfo => {
            const {contractArray, addressArray} = addressInfo;
            const contractIdArray = contractArray.map(addressHex => addressHexIdMap.get(addressHex.substr(2)));
            const addressIdArray = addressArray.map(addressHex => addressHexIdMap.get(addressHex.substr(2)));
            return {contractIdArray, addressIdArray};
        });

        // assemble message
        const msg = {};
        addressIdInfoArray.forEach((addressIdInfo, i) =>{
            const {contractIdArray, addressIdArray} = addressIdInfo;
            if(i === 0){
                msg[PruneType.ERC20_TRANSFER] = contractIdArray;
                msg[PruneType.ADDR_ERC20_TRANSFER] = addressIdArray;
            }
            if(i === 1){
                msg[PruneType.ERC721_TRANSFER] = contractIdArray;
                msg[PruneType.ADDR_ERC721_TRANSFER] = addressIdArray;
            }
            if(i === 2){
                msg[PruneType.ERC1155_TRANSFER] = contractIdArray;
                msg[PruneType.ADDR_ERC1155_TRANSFER] = addressIdArray;
            }
        });
        return PruneNotifier.notifyPrune(msg);
        // console.log(`prune_notify[type=tokenTransfer],queueLen:${await xLen(PRUNE_Q)},msg:${JSON.stringify(msg)}`);
    }

    private static async checkEnqueueAble() {
        const len = await xLen(PRUNE_Q);
        return len <= PruneNotifier.LEN_QUEUE_TOTAL;
    }
}
