// @ts-ignore
import {format} from "js-conflux-sdk";
import {Epoch} from "../model/Epoch";
import {SyncBase, SyncData} from "./SyncBase";
import {StatApp} from "../StatApp";
import {fmtDtUTC} from "../model/Utils";
import {makeId} from "../model/HexMap";
import {FullMinerBlock} from "../model/FullMinerBlock";
import {Contract} from "../model/Contract";
import {Token} from "../model/Token";
import {TokenAutoDetect} from "../model/TokenAutoDetect";
import {Transaction} from "sequelize";
import {batchFetchBlock} from "./common/utils";
import {base64ToPNG, getImageDir, saveOssUrl, uploadOss} from "./tool/TokenTool";
import {Erc20Transfer} from "../model/Erc20Transfer";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
const lodash = require('lodash');
const zlib = require('zlib');
const CONST = require('./common/constant');

export class EpochSync extends SyncBase{
    protected app;
    private erc721Interface = [0x80, 0xac, 0x58, 0xcd];
    private erc1155Interface = [0xd9, 0xb6, 0x7a, 0x26];
    private whiteListErc20;

    constructor(app: StatApp) {
        super(app);
        this.app = app;
        this.initWhiteListErc20();
    }

    //----------------- implementation method from SyncBase -----------------
    async getData(epochNumber): Promise<SyncData> {
        const epoch = await this.getEpoch(epochNumber);
        const minerBlockArray = await this.getMinerBlockArray(epochNumber);
        const groupedLogs = await this.getLogsGrouped(epochNumber);
        const announceInfo = await this.getAnnounceInfo(epochNumber, groupedLogs.announcementArray);
        const tokenArray = await this.getTokensAutoDetected(groupedLogs);
        const syncData = {
            parentHash: epoch.parentHash,
            pivotHash: epoch.pivotHash,
            modelData: {epoch, minerBlockArray, announceInfo, tokenArray},
        };
        return syncData;
    }

    async validate(epochNumber, modelData) {
        const blockArray = modelData.minerBlockArray;
        const revertBlockArray = blockArray.filter(block => block.epoch !== epochNumber);
        if(revertBlockArray.length){
            console.log(`epoch-sync.validate epoch:${epochNumber}, minerBlockArray:${JSON.stringify(blockArray)}`)
            return Promise.resolve(false);
        }

        return Promise.resolve(true);
    }

    async save(epochNumber, modelData) {
        await Epoch.sequelize.transaction(async (dbTx) => {
            await Epoch.add(modelData.epoch, dbTx);
            await FullMinerBlock.bulkCreate(modelData.minerBlockArray, {transaction: dbTx});
            await this.saveAnnounceInfo(epochNumber, modelData.announceInfo, dbTx);
        });

        const tokenArray = modelData.tokenArray;
        for(const token of tokenArray){
            try{
                if(token.type !== CONST.TRANSFER_TYPE.ERC20){ // auto detect erc721 and erc1155
                    await Token.upsert(token);
                }
            }catch (e) {
                console.log(`epoch-sync.createTokensAutoDetected fail,token:${JSON.stringify(token)}`, e);
            }
        }

        try{
            const {tokenArray} = modelData.announceInfo;
            const {dir} = getImageDir();
            for (const token of tokenArray) {
                if (token.icon) {
                    const dbIcon = await Token.findOne({where: {base32: token.base32}});
                    setTimeout(()=>{
                        base64ToPNG(dbIcon, dir).then(({absPath, filename})=>{
                            return uploadOss(absPath, filename)
                        }).then(res=>{
                            return saveOssUrl(dbIcon, res)
                        }).catch(err=>{
                            console.log(`epoch-sync.create one TokenIcon url fail: ${token.base32}`, err);
                        })
                    }, 10_000)
                }
            }
        } catch (e){
            console.log(`epoch-sync, createTokenIcon url fail`, e);
        }

        if (epochNumber % 100 === 0) {
            console.log(`${fmtDtUTC(new Date())} insert full_epoch at epoch:${epochNumber}`)
        }
        return Promise.resolve();
    }

    async delete(epochNumber, modelData) {
        await Epoch.sequelize.transaction(async (dbTx) => {
            const epochDel = await Epoch.destroy({where:{epoch: epochNumber}, transaction: dbTx});
            const minerBlockDel = await FullMinerBlock.destroy({where: {epoch: epochNumber}, transaction: dbTx});
            console.log(`epoch-sync.delete epoch:${epochNumber}, epochDel:${epochDel}, minerBlockDel:${minerBlockDel}`)
        });
    }

    //---------------------- business method for epoch -----------------------
    private async getEpoch(epochNumber) {
        const {
            app: { cfx },
        } = this;

        const pivotBlock = await cfx.getBlockByEpochNumber(epochNumber, false).catch(async err=>{
            const msg = `${err}`
            if (msg.includes('expected a numbers with less than largest epoch number.')) {
                const latest = await cfx.getEpochNumber('latest_state');
                console.log(`epoch-sync.pivotBlock epoch:${epochNumber} latestState:${latest} not executed`)
            } else {
                console.log(`epoch-sync.pivotBlock epoch:${epochNumber} error:${msg}`)
            }
            throw err;
            //return {};
        });
        pivotBlock.timestamp = Number(pivotBlock.timestamp);
        const now = Math.floor(Date.now() / 1000);
        const timestamp = lodash.min([pivotBlock.timestamp, now]);// XXX: for filter negative timestamp

        return {
            epoch: epochNumber,
            pivotHash: pivotBlock.hash.substr(2),
            parentHash: pivotBlock.parentHash.substr(2),
            timestamp: new Date(timestamp * 1000),
        };
    }

    //------------------- business method for miner block --------------------
    private async getMinerBlockArray(epochNumber) {
        const {
            app: { cfx },
        } = this;

        const blockHashArray = await cfx.getBlocksByEpochNumber(epochNumber).catch(async err=>{
            const msg = `${err}`
            if (msg.includes('expected a numbers with less than largest epoch number.')) {
                const latest = await cfx.getEpochNumber('latest_state');
                console.log(`epoch-sync.blockHashArray epoch:${epochNumber} latestState:${latest} not executed`)
            } else {
                console.log(`epoch-sync.blockHashArray epoch:${epochNumber} error:${msg}`)
            }
            return [];
        });
        const blockArray = await batchFetchBlock(cfx,  blockHashArray, false)
        let minerBlockArray = await Promise.all(blockArray.map(async (block: any, position) => {
            const hex40 = format.hexAddress(block.miner);
            const blockDt = new Date(block.timestamp * 1000);
            const hex40Id = (await makeId(hex40, undefined, {dt: blockDt})).id;
            return {minerId: hex40Id, epoch: block.epochNumber, position, createdAt: blockDt};
        }));
        minerBlockArray = lodash.orderBy(minerBlockArray, 'position', 'desc');

        return minerBlockArray;
    }

    //--------------------- business method for announce ---------------------
    private async saveAnnounceInfo(epochNumber, {tokenArray, contractArray}, dbTx: Transaction = undefined) {
        const {dir} = getImageDir();
        for (const token of tokenArray) {
            const tokenDb: Token = await Token.findOne({where: {base32: token.base32},
                transaction: dbTx, raw: true});
            if(tokenDb){
                const updateInfo = lodash.defaults({}, {icon: token.icon, quoteUrl: token.quoteUrl,
                    marketCapId: token.marketCapId, moonDexSymbol: token.moonDexSymbol,
                    binanceSymbol: token.binanceSymbol, updatedAt: new Date()});
                const t = lodash.assign(tokenDb, updateInfo);
                await Token.update(t, {where: {id: tokenDb.id}, transaction: dbTx});
            } else{
                const t = lodash.assign(token, {holder: 0});
                await Token.add(t, dbTx);
            }
        }
        for (const contract of contractArray) {
            const contractDb: Contract = await Contract.findOne({where: {base32: contract.base32},
                transaction: dbTx, raw: true});
            if(contractDb){
                const updateInfo = lodash.defaults({}, {epoch: epochNumber, name: contract.name, website: contract.website,
                    abi: contract.abi, sourceCode: contract.sourceCode, icon: contract.icon, updatedAt: new Date()});
                const c = lodash.assign(contractDb, updateInfo);
                await Contract.update(c, {where: {id: contractDb.id}, transaction: dbTx});
            } else{
                const c = lodash.assign(contract, {epoch: epochNumber});
                await Contract.add(c, dbTx);
            }
        }
    }

    private async getAnnounceInfo(epochNumber, announceArray) {
        const {
            app: { tokenTool },
        } = this;

        let tokenMap = {};
        let contractMap = {};
        // const announceArray = await this.getAnnounceArray(epochNumber);
        for(const announce of announceArray) {
            const key = Buffer.from(announce.key, 'base64').toString();
            const params = key.split('/');
            console.log(`announcement------epoch:${epochNumber}------${params}`);
            if(params[0] === 'token') {
                EpochSync.parseAnnounce(params, announce, tokenMap);
            }
            if(params[0] === 'contract') {
                EpochSync.parseAnnounce(params, announce, contractMap);
            }
        }

        const tokenArray = [];
        const tokenHexArray = Object.keys(tokenMap);
        for(const hex of tokenHexArray){
            let token = tokenMap[hex];
            token.hex40id = (await makeId(hex)).id;
            token.base32 = format.address(hex, StatApp.networkId);
            const totalSupply = await tokenTool.getTokenTotalSupply(token.base32);
            const tokenInfo = await tokenTool.getToken(token.base32);
            token = lodash.defaults(token, { totalSupply, name: tokenInfo.name, symbol: tokenInfo.symbol,
                decimals: tokenInfo.decimals, granularity: tokenInfo.granularity });
            tokenArray.push(token);
        }
        const contractArray = [];
        const contractHexArray = Object.keys(contractMap);
        for(const hex of contractHexArray){
            let contract = contractMap[hex];
            contract.hex40id = (await makeId(hex)).id;
            contract.base32 = format.address(hex, StatApp.networkId);
            contractArray.push(contract);
        }

        return {tokenArray, contractArray};
    }

    private static parseAnnounce(params, announce, map){
        if(params[1] === 'list'){
            const [ , , hex] = params;
            map[hex] = map[hex] || {};
        } else{
            const [ , hex, field] = params;
            const item = map[hex] || {};
            item[field] = (field === 'abi' || field === 'sourceCode' || field === 'icon')
                ? Buffer.from(zlib.unzipSync(Buffer.from(announce.value, "base64"))).toString()
                : Buffer.from(announce.value, 'base64').toString();

            if (field === 'name' && item[field].length >= 256) {
                item[field] = item[field].substr(0, 256);
            }

            map[hex] = item;
        }
        return map;
    }

    // ----------------------- business method for token ------------------------
    private async getTokensAutoDetected({ epochNumber, transfer20Array, transfer721Array, transfer1155Array }) {
        let tokenArray = [];
        try{
            const [crc20AddressArray, crc721AddressArray, crc1155AddressArray]  = await Promise.all([
                [... new Set(transfer20Array.map(item => item.address).filter(Boolean))],
                [... new Set(transfer721Array.map(item => item.address).filter(Boolean))],
                [... new Set(transfer1155Array.map(item => item.address).filter(Boolean))]
            ]);
            if(crc20AddressArray.length){
                tokenArray = [...tokenArray, ...await this.getTokens(crc20AddressArray, CONST.TRANSFER_TYPE.ERC20)];
            }
            if(crc721AddressArray.length){
                tokenArray = [...tokenArray, ...await this.getTokens(crc721AddressArray, CONST.TRANSFER_TYPE.ERC721)];
            }
            if(crc1155AddressArray.length){
                tokenArray = [...tokenArray, ...await this.getTokens(crc1155AddressArray, CONST.TRANSFER_TYPE.ERC1155)];
            }
        }catch (e){
            console.log(`epoch-sync.getTokensAutoDetected fail`, e);
        }
        return tokenArray;
    }

    private async getTokens(hexAddressArray, transferType){
        const tokenArray = [];
        for(const hex40 of hexAddressArray){
            const token = await this.getToken(hex40, transferType);
            token && tokenArray.push(token);
        }
        return tokenArray;
    }

    private async getToken(hexAddress, transferType){
        const {
            app: { tokenTool },
        } = this;

        const hex40id = (await makeId(hexAddress)).id;
        const tokenDb = await Token.findOne({where: {hex40id}, raw: true});
        if(tokenDb && tokenDb.type){
            return undefined;
        }

        const base32 = format.address(hexAddress, StatApp.networkId);
        const [ totalSupply, tokenInfo, erc721Interface, erc1155Interface ] = await Promise.all([
            tokenTool.getTokenTotalSupply(base32),
            tokenTool.getToken(base32),
            tokenTool.supportsInterface(base32, this.erc721Interface),
            tokenTool.supportsInterface(base32, this.erc1155Interface),
        ]);
        if((transferType === CONST.TRANSFER_TYPE.ERC721 && erc721Interface === false) ||
            (transferType === CONST.TRANSFER_TYPE.ERC1155 && erc1155Interface === false)){
            return undefined;
        }

        let token = lodash.defaults({}, { hex40id, base32, name: tokenInfo.name, symbol: tokenInfo.symbol,
            decimals: tokenInfo.decimals, granularity: tokenInfo.granularity, totalSupply,
            type: transferType});
        const transferCount = await this.countTransfer(hex40id, transferType);
        const auditResult = token.name !== undefined && token.symbol !== undefined
            && (this.whiteListErc20.has(token.base32) || token.type !== CONST.TRANSFER_TYPE.ERC20);
        token = lodash.defaults(token, {transfer: transferCount,  auditResult, fetchBalance: true });
        return token;
    }

    private async countTransfer(addressId, transferType) {
        if(transferType === CONST.TRANSFER_TYPE.ERC20)
            return 0; //Erc20Transfer.count({ where: { contractId: addressId }});
        if(transferType === CONST.TRANSFER_TYPE.ERC721)
            return Erc721Transfer.count({ where: { contractId: addressId }});
        if(transferType === CONST.TRANSFER_TYPE.ERC1155)
            return Erc1155Transfer.count({ where: { contractId: addressId }});
    }

    private initWhiteListErc20(){
        this.whiteListErc20 = new Set<string>([
            'cfx:acg158kvr8zanb1bs048ryb6rtrhr283ma70vz70tx',
            'cfx:acbgx6fr4erywfs1u8jysdjkdyw697386ykw31nddj',
            'cfx:acf2rcsh8payyxpg6xj7b0ztswwh81ute60tsw35j7',
            'cfx:achcuvuasx3t8zcumtwuf35y51sksewvca0h0hj71a',
            'cfx:acdrf821t59y12b4guyzckyuw2xf1gfpj2ba0x4sj6',
            'cfx:achc8nxj7r451c223m18w2dwjnmhkd6rxawrvkvsy2',
            'cfx:acd3fhs4u0yzx7kpzrujhj15yg63st2z6athmtka95',
            'cfx:aca13suyk7mbgxw9y3wbjn9vd136swu6s21tg67xmb',
            'cfx:acff13n54n4t02cy6uc8xfdxrf4enanr5jh6vy761g',
            'cfx:acc1uh4ftd4jhser99uk8nk8unkbz8ykmyxt0n27v5',
            'cfx:accuj4mt4kmnhzr1b3xe653n63694tc0cjuzkj5t94',
            'cfx:accedvremfhmym60f9u4nghb8utxcgbtb2acewunwh',
            'cfx:acbyc3ahvctpx5cabfw6n1s9fv40trur6ydbu1zr4x',
            'cfx:acbb225r9wc7a2kt1dz9gw0tuv5v1kgdjuh5akdh3t',
            'cfx:acfezfepc4wuxj2fmfya1w9kwjutk7wtaudbz0k6dj',
            'cfx:acc3hzr7e570ccnrb91wgufwcs6a171jvuax68krfm',
            'cfx:accxdrf7c3vntwyyhj8ws8mcatd433k8sjvrjbx39r',
            'cfx:acdkf73rh2ewwm3hbwddd00wy3v3fyau3ew61jbrbj',
            'cfx:acdcap62vh2km00y4fh117ngz8jauj19g618km65m6',
            'cfx:ach3cmt7wze9tkhxctkdzfsaf0azcppgvpfwfdzmku',
            'cfx:acamc98zc1a93ap8u9xaruc2kefpd6mpy6089w6yv0',
            'cfx:acg797d4c6v007y46hj1juk7z0ac86m04uc13n4bcg',
            'cfx:achj7swfxkg634hcvg70ttywtgyn2w619jxscmjdp3',
            'cfx:acc8599utu7nayj50w393eycznhv4e23g2ys6xmvf5',
            'cfx:acdkyd8tmezzs6cvmfwtpkg7y9k8cnhdapfcganwt9',
            'cfx:acekx06rp1bcdkup1ubr2vw77tsrw81ysy0d3n7x5s',
            'cfx:acgbjtsmfpex2mbn97dsygtkfrt952sp0psmh8pnvz',
            'cfx:acczy0zs2fu03pnx0w1u19pkprsm6r50spkz7eg4c3',
            'cfx:ace09320r53kxk8tx07wz1mx5dwhcaumk2etx52tt6',
            'cfx:acdz7hfvku8fm0j8k065urs2n59k0e33npbjtyp2bv',
            'cfx:acb9wkgbefcja9rkpds5ve4cm5643jmebae7xjzz8f',
            'cfx:acaucwuza1nm7wfj1bwkjttz7b0eh4ak7ur7fue1dy',
            'cfx:acbvymbs1ck1gve4yzubavvj7my5h7b8yutaagrsrx',
            'cfx:acc8ya1f2a2bfphxg5ax7a8h29k47d5xsebxfj24nd',
            'cfx:achgfs1uu8drfvy8ju05grkwgct9pfdckym9pc15dc',
            'cfx:acbyzcbfpymaz43rr6s1gtx0fb08guj88uzc05rchf',
        ]);
    }

    // -------------------------------- event log -------------------------------
    private async getLogsGrouped(epochNumber) {
        const {
            app: { tokenTool },
        } = this;

        const eventLogArray = await this.getLogs(epochNumber);
        const groupedLogs = {
            epochNumber,
            transfer20Array: [],
            transfer721Array: [],
            transfer1155Array: [],
            announcementArray: [],
        };

        for(const eventLog of eventLogArray) {
            const [transfer20, transfer721, transfer1155, announcement] = await Promise.all([
                tokenTool.decodeERC20Transfer(eventLog),
                tokenTool.decodeERC721Transfer(eventLog),
                tokenTool.decodeERC1155TransferArray(eventLog),
                tokenTool.decodeAnnounce(eventLog),
            ]);
            if(transfer20) {groupedLogs.transfer20Array.push(transfer20);}
            if(transfer721) {groupedLogs.transfer721Array.push(transfer721);}
            if(transfer1155) {groupedLogs.transfer1155Array.push(transfer1155);}
            if(announcement) {groupedLogs.announcementArray.push(announcement);}
        }
        return groupedLogs;
    }

    private async getLogs(epochNumber) {
        const {
            app: { cfx },
        } = this;

        const eventLogArray = await cfx.getLogs({fromEpoch: epochNumber, toEpoch: epochNumber}).catch(async err=>{
            const msg = `${err}`
            if (msg.includes('expected a numbers with less than largest epoch number.')) {
                const latest = await cfx.getEpochNumber('latest_state');
                console.log(`epoch-sync.eventLogArray epoch:${epochNumber} latestState:${latest} not executed`)
            } else {
                console.log(`epoch-sync.eventLogArray epoch:${epochNumber} error:${msg}`)
            }
            return [];
        });
        return eventLogArray.map((v) => EpochSync.parseEventLog(v));
    }

    private static parseEventLog(eventLog) {
        eventLog.epochNumber = Number(eventLog.epochNumber);
        eventLog.address = format.hexAddress(eventLog.address);
        eventLog.transactionLogIndex = Number(eventLog.transactionLogIndex);
        return eventLog;
    }
}
