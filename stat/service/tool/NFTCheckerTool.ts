import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {Conflux} from "js-conflux-sdk";
import {NFTCheckerService} from "../nftchecker/NFTCheckerService";
import {NFTPreviewService} from "../nftchecker/NFTPreviewService";
import {NFTMap} from '../nftchecker/NFTInfo';

let cfx;
let checker;
let previewer;
async function init() {
    const config = loadConfig('Prod')
    let seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)
    cfx = new Conflux({...config.conflux})
    let app = {cfx};
    checker = new NFTCheckerService(app);
    previewer = new NFTPreviewService(app);
}

async function run(arg0, arg1, arg2, arg3, arg4) {
    await init();
    // await getNFTInfo(arg0, arg1);
    // await getNFTBalances(arg0);
    await getNFTTokens(arg0, arg1, arg2, arg3, arg4);
}

const args = process.argv.slice(2)
run(args[0], args[1], args[2], args[3], args[4]).then();

//========================================================================
async function getNFTInfo(contractAddress, tokenId) {
    const nftInfo = await previewer.getNFTInfo({ contractAddress, tokenId });
    console.info(`nftInfo-------------------------------${JSON.stringify(nftInfo)}`);
}

async function getNFTBalances(ownerAddress) {
    const nftContractAddresses = Object.values(NFTMap).map(nft => nft.address);
    const balances = await checker.getNFTBalances(ownerAddress, nftContractAddresses);
    const nftBalances = Object.keys(NFTMap)
        .map((type, index) => ({
            type,
            address: NFTMap[type].address,
            name: NFTMap[type].name,
            balance: balances[index],
        }))
        .filter(n => n.balance > 0);
    console.info(`nftBalances-------------------------------${JSON.stringify(nftBalances)}`);
}

async function getNFTTokens(ownerAddress, contractAddress, currentNFTType, offsetStr, limitStr) {
    const offset = Number(offsetStr);
    const limit = Number(limitStr);
    console.info(`ownerAddress:${ownerAddress}, contractAddress:${contractAddress}, offset:${offset}, limit:${limit}`)
    const nftTokens = await checker.getNFTTokens(
        ownerAddress,
        contractAddress || NFTMap[currentNFTType].address,
        offset,
        limit,
    );
    console.info(`nftTokens-------------------------------${JSON.stringify(nftTokens)}`);
}
