import {StatConfig} from "../../config/StatConfig";
import {PRUNE_Q, RedisWrap, xLen} from "../RedisWrap";
import {init} from "./FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {initCfxSdk} from "../common/utils";
import {PruneHandler} from "../prune/PruneHandler";
import {PruneNotifier} from "../prune/PruneNotifier";
import {PruneInfo, PruneType} from "../../model/PruneInfo";
import {Token} from "../../model/Token";
import {TokenBalance} from "../../model/Balance";
import {Erc20Transfer} from "../../model/Erc20Transfer";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";
import {PruneBase} from "../prune/PruneBase";
import {sleep} from "./ProcessTool";
import {CONST} from "../common/constant"
import {Hex40Map} from "../../model/HexMap";
import {Op, QueryTypes} from "sequelize";
import {AddressTransfer} from "../../model/AddrTransfer";
import {KV} from "../../model/KV";
import * as Process from "process";

let config:StatConfig;
let cfx:Conflux;
let pruneHandler: PruneHandler;

let type: number; // para0
let contractId: number;  // para1
let transferType: string;  // para2
let needSend: number;  // para3, 0-not send, 1-send

async function getTokenArray(){
    return Token.findAll({
        attributes:['id','hex40id','type'],
        where:{auditResult: true},
        raw: true
    });
}

async function getHolderIdArray({contractId}){
    const tokenBalanceList = await TokenBalance.findAll({
        attributes:['contractId','addressId'],
        where:{contractId}
    });
    return tokenBalanceList.map(tokenBalance => tokenBalance.addressId);
}

async function buildPruneMessageByToken({contractId, transferType}){
    const pruneType = getPruneType({transferType, isAddressModule: false});
    const addressPruneType = getPruneType({transferType, isAddressModule: true});
    const holderIdArray = await getHolderIdArray({contractId});

    const pruneMessageArray = holderIdArray.map(holderId =>
        ({
            [addressPruneType]: [
                {
                    pruneLoop: 30000, // optional
                    delRowsPerLoop: 500, // optional
                    sleepMsPerLoop: 20, // optional
                    addressId: holderId,
                }
            ],
        })
    );

    pruneMessageArray.push({
        [pruneType]: [
            {
                pruneLoop: 30000, // optional
                delRowsPerLoop: 500, // optional
                sleepMsPerLoop: 20, // optional
                addressId: contractId,
            }
        ],
    });
    return pruneMessageArray;
}

function getPruneType({transferType, isAddressModule}){
    if(transferType === CONST.TRANSFER_TYPE.ERC20){
        if(isAddressModule)
            return PruneType.ADDR_ERC20_TRANSFER;
        else
            return PruneType.ERC20_TRANSFER;
    }

    if(transferType === CONST.TRANSFER_TYPE.ERC721){
        if(isAddressModule)
            return PruneType.ADDR_ERC721_TRANSFER;
        else
            return PruneType.ERC721_TRANSFER;
    }

    if(transferType === CONST.TRANSFER_TYPE.ERC1155){
        if(isAddressModule)
            return PruneType.ADDR_ERC1155_TRANSFER;
        else
            return PruneType.ERC1155_TRANSFER;
    }
}

async function getStorageRowsByToken({type, hex40id}) {
    let model;
    if(type === CONST.TRANSFER_TYPE.ERC20){
        model = Erc20Transfer;
    } else if (type === CONST.TRANSFER_TYPE.ERC721){
        model = Erc721Transfer;
    } else if (type === CONST.TRANSFER_TYPE.ERC1155){
        model = Erc1155Transfer;
    } else {
        return 0;
    }
    const cntr = await model.count({
        where: {contractId: hex40id}
    });

    return cntr;
}

async function getPrunedRowsByToken({type, hex40id}) {
    let pruneType;
    if(type === CONST.TRANSFER_TYPE.ERC20){
        pruneType = PruneType.ERC20_TRANSFER;
    } else if (type === CONST.TRANSFER_TYPE.ERC721){
        pruneType = PruneType.ERC721_TRANSFER;
    } else if (type === CONST.TRANSFER_TYPE.ERC1155){
        pruneType = PruneType.ERC1155_TRANSFER;
    } else {
        return 0;
    }
    const pruneInfo = await PruneInfo.findOne({where: {addressId: hex40id, type: pruneType}});
    return pruneInfo !== null ? pruneInfo.pruned : 0;
}

async function run() {
    config = await init();

    cfx = await initCfxSdk(config.conflux);
    console.log(`-----  networkId ${cfx.networkId} ------`)

    await RedisWrap.connect(config.redis);

    const app = {cfx, config};
    if(type === 1){
        pruneHandler = new PruneHandler(app);
        await pruneHandler.scheduleRefreshConfig();
        await pruneHandler.schedule(10);
    }
    if(type === 2){
        const message = {
            // [PruneType.ERC20_TRANSFER]: [
            //     {
            //         pruneLoop: 1000, // optional
            //         delRowsPerLoop: 20000, // optional
            //         sleepMsPerLoop: 20, // optional
            //         addressId: 369958,
            //     }
            // ],
            // [PruneType.ADDR_ERC20_TRANSFER]: [
            //     {
            //         pruneLoop: 1000, // optional
            //         delRowsPerLoop: 20000, // optional
            //         sleepMsPerLoop: 20, // optional
            //         addressId: 33162167,
            //     }
            // ],
        };
        await PruneNotifier.notifyPrune(message);
        console.log(`sendPruneMessage------------${JSON.stringify(message)}`);
    }
    if(type === 3){
        const tokenArray = await getTokenArray();
        console.log(`tokenArray------------${JSON.stringify(tokenArray)}`)
    }
    if(type === 4){
        const holderIdArray = await getHolderIdArray({contractId});
        console.log(`holderIdArray------------${JSON.stringify(holderIdArray)}`)
    }
    if(type === 5){ // prune token transfer one by one
        const messageArray = await buildPruneMessageByToken({contractId, transferType});
        let sent = 0;
        if(needSend===1) {
            for (const message of messageArray) {
                await PruneNotifier.notifyPrune(message);
                sent++;
            }
        }
        console.log(`assemblePruneMessage------------message counter:${messageArray.length},sent:${sent}`)
    }
    if(type === 6){ // fix token's transfer
        const tokenArray = await getTokenArray();
        for (const t of tokenArray) {
            const prunedRows = await getPrunedRowsByToken({type: t.type, hex40id: t.hex40id});
            const storageRows = await getStorageRowsByToken({type: t.type, hex40id: t.hex40id});
            if(prunedRows > 0){
                await Token.update({transfer: storageRows + prunedRows}, {where: {id: t.id}});
                console.log(`updateTokenTransfer.update------------tokenId:${t.hex40id},storageRows:${storageRows},prunedRows:${prunedRows}`)
            }
        }
        for (const t of tokenArray) {
            const prunedRows = await getPrunedRowsByToken({type: t.type, hex40id: t.hex40id});
            const storageRows = await getStorageRowsByToken({type: t.type, hex40id: t.hex40id});
            if(storageRows > PruneBase.KEEP_ROWS){
                console.log(`updateTokenTransfer.needPrune------------tokenId:${t.hex40id},storageRows:${storageRows},prunedRows:${prunedRows}`)
            }
        }
    }
    if(type === 7){ // prune token transfer batch
        do{
            const tokenArray = await getTokenArray();
            let cntr = 0;
            let sent = 0;
            for (const token of tokenArray) {
                const pruneMessageArray = await buildPruneMessageByToken({contractId: token.hex40id, transferType: token.type});
                cntr += pruneMessageArray.length;
                let cntrPerToken = pruneMessageArray.length;
                let sentPerToken = 0;
                if(needSend===1) {
                    for (const message of pruneMessageArray) {
                        await PruneNotifier.notifyPrune(message);
                        sent++;
                        sentPerToken++;
                    }
                    console.log(`assemblePruneMessageBatch------------token:${token.hex40id},message counter:${cntrPerToken},message sent:${sentPerToken}`)
                    const sleepMsPerToken = cntr * 3;
                    await sleep(sleepMsPerToken);
                }
            }
            console.log(`assemblePruneMessageBatch------------token counter:${tokenArray.length},message counter:${cntr},message sent:${sent}`)
        } while (true)
    }
    if(type === 8){
        const batch = 1000
        const keyNextPuneAddrId = 'next_pune_addr_id'
        const nextPuneAddrId = await KV.getNumber(keyNextPuneAddrId)
        let id = nextPuneAddrId ? nextPuneAddrId : 1

        let qLen
        while (true) {
            const addressArray = await Hex40Map.sequelize.query(`select * from hex40 where id >= ? and id < ?`,
                {type: QueryTypes.SELECT, replacements: [id, id + batch]}
            )

            const notifyAddressArray = []
            if(addressArray.length) {
                for (const address of addressArray) {
                    const records = await AddressTransfer.sequelize.query(`select * from address_transfer where addressId = ? limit 20000, 1`,
                        {type: QueryTypes.SELECT, replacements: [address['id']]})
                    if(records.length > 0) {
                        notifyAddressArray.push(address)
                    }
                }

                if(notifyAddressArray.length) {
                    const msg = {
                        [PruneType.ADDR_TRANSFER]: [...new Set(notifyAddressArray.map(item => item['id']))],
                    }
                    await PruneNotifier.notifyPrune(msg);
                    qLen = await xLen(PRUNE_Q)
                    console.log(`prune_notify,queueLen:${qLen},msg:${JSON.stringify(msg)}`);
                }
            }

            id = id + batch
            await KV.upsert({key: keyNextPuneAddrId, value: id.toString()})
            if(id > 74721992) {
                break
            }

            if(qLen > 100) {
                await sleep(1000 * 10)
            } else{
                await sleep(10)
            }
        }
        console.log(`done!`)
    }
    if(type === 9) {
        let errorMessage;
        try {
            const record = {
                addressId: 74709885,
                epoch: 85720932,
                blockIndex: 0,
                txIndex: 1,
                txLogIndex: 0,
                batchIndex: 0,
                fromId: 39855,
                toId: 74709885,
                contractId: 0,
                tokenId: '0',
                value: '1681686603287073031',
                type: 10,
                cursorId: 85720932000001,
                createdAt: new Date('2023-12-18 19:44:33'),
            }
            const result = await AddressTransfer.create(record as AddressTransfer)
            console.log(`---1--- sync_forward sync,result: ${JSON.stringify(result)}`);
        } catch (e) {
            console.log(`---2--- sync_forward sync,error:`, e);
            errorMessage = `${e}`;
            if(errorMessage && errorMessage.includes('UniqueConstraintError')) {
                console.log(`---4--- UniqueConstraintError dump`)
            }
            console.log(`---3--- UniqueConstraintError errorMessage ${errorMessage}`)
            await sleep(10_000);
        }

    }
}

const args = process.argv.slice(2)
if(args[0]){
    type = Number(args[0]);
}
if(args[1]){
    contractId = Number(args[1]);
}
if(args[2]){
    transferType = args[2];
}
if(args[3]){
    needSend = Number(args[3]);
}
// console.log(`DataPruneTool------------type:${type},contractId:${contractId},transferType:${transferType}`);
// PruneNotifier.SWITCH_SYNC_PRUNE = true;
run().then();
