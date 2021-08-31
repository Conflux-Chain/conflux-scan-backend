// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {Model, Op} from "sequelize";
import {
    Balance,
    Balance_ACGNFT,
    Balance_ARTT,
    Balance_cAMP,
    Balance_cBAND,
    Balance_cBNB,
    Balance_cBTC,
    Balance_cCOMP,
    Balance_cDAI,
    Balance_cDF,
    Balance_cDPI,
    Balance_cETH,
    Balance_CF,
    Balance_cFLUX,
    Balance_cFOR,
    Balance_CG,
    Balance_cHBTC,
    Balance_cITF,
    Balance_cKNC,
    Balance_cKP3R,
    Balance_cLEND,
    Balance_cLINK,
    Balance_cMBTM,
    Balance_cMOON,
    Balance_cOKT,
    Balance_conDragon,
    Balance_CRCL_BTC_symbol,
    Balance_cSNX,
    Balance_csUSD,
    Balance_cSWRV,
    Balance_CTN,
    Balance_cUMA,
    Balance_cUSDC,
    Balance_cYFI,
    Balance_cYFII, Balance_DAN,
    Balance_EPIK_NFT,
    Balance_FC,
    Balance_K,
    Balance_MNNFT,
    Balance_PHM_NFT,
    Balance_POOLGO,
    Balance_POS,
    Balance_TD,
    Balance_TREA,
    Balance_YAO,
    CfxBalance,
    DexCfxBalance,
    DexUSDTBalance,
    USDTBalance,
    WCfxBalance
} from "../../model/Balance";
import {KEY_BALANCE_POS_PREFIX, KEY_NFT_TOKEN_ID_POS, KV} from "../../model/KV";
import {Hex40Map, makeId} from "../../model/HexMap";
import {fmtDtUTC} from "../../model/Utils";
import {StatConfig} from "../../config/StatConfig";
import {hex} from "../../test/GenData";
import {NftId} from "../../model/Token";
import {BatchBalanceWatcher} from "./BatchBalanceWatcher";
import {StatApp} from "../../StatApp";
import {DynamicBalanceModel} from "./DynamicBalanceModel";
const BigFixed = require('bigfixed');
const superagent = require("superagent")
const NodeCache = require( "node-cache" );

/**
 * Scan all address's balance of configured contracts.
 * For erc1155, we also need maintain all the token ids, by calling scan json rpc.
 */
export class BalanceWatcher{
    //
    static watcherMap = new Map<string, BalanceWatcher>()
    //
    private miniERC20: any;
    private miniERC1155: any;
    protected cfx: Conflux;
    protected fraction = BigInt(1e+18) // hard code, please search 1e+18 globally when fixing it.
    protected addressPos = -1;
    protected model: typeof Balance
    protected name:string
    protected tokenType:string
    // save address position in DB, in order to `scan` balance of all addresses.
    protected addressPosKey:string
    private config: {scanJsonRpcUrl:string};
    private readonly contractAddress: string;
    private contractHex40id:number
    private tokenIdsCache

    constructor(name:string, contractAddr: string, cfx:Conflux, config:{tokenType:string}) {
        this.tokenIdsCache = new NodeCache()
        this.name = name
        this.contractAddress = contractAddr
        this.cfx = cfx;
        this.tokenType = config.tokenType || 'NotSet'
        this.model = BalanceWatcher.mapModel(name) // by configuration, will be deprecated.
        this.addressPosKey = KEY_BALANCE_POS_PREFIX + this.name;
        if (contractAddr) {
            const {abi, bytecode} = require('./contract/miniERC20.json');
            this.miniERC20 = cfx.Contract({abi, bytecode, address: contractAddr});

            const {abi: abi1155} = require('./contract/miniERC1155.json');
            this.miniERC1155 = cfx.Contract({abi:abi1155, address: contractAddr});

            BalanceWatcher.watcherMap.set(name, this)
        }
    }

    static mapModel(name:string, silent:boolean = false, contractId: number = -1)/*: typeof Balance | DynamicBalanceModel*/{
        let ret;
        switch (name) {
            case 'WCFX':
            case 'wcfx':        ret = WCfxBalance;       break;
            case 'dex-cfx':     ret = DexCfxBalance;     break;
            case 'cUSDT':
            case 'usdt':        ret = USDTBalance;       break;
            case 'dex-usdt':    ret = DexUSDTBalance;    break;
            case 'cfx':         ret = CfxBalance;    break;

            case 'CRCL_BTC_symbol':         ret = Balance_CRCL_BTC_symbol;    break;
            case 'cMOON':         ret = Balance_cMOON;    break;
            // case 'cUSDT':         ret = BalancecUSDT;    break;
            case 'cETH':         ret = Balance_cETH;    break;
            case 'FC':         ret = Balance_FC;    break;
            // case 'WCFX':         ret = BalanceWCFX;    break;
            case 'cDAI':         ret = Balance_cDAI;    break;
            case 'cUSDC':         ret = Balance_cUSDC;    break;
            case 'cLEND':         ret = Balance_cLEND;    break;
            case 'cFOR':         ret = Balance_cFOR;    break;
            case 'cLINK':         ret = Balance_cLINK;    break;
            case 'cCOMP':         ret = Balance_cCOMP;    break;
            case 'cBAND':         ret = Balance_cBAND;    break;
            case 'cBTC':         ret = Balance_cBTC;    break;
            case 'cYFI':         ret = Balance_cYFI;    break;
            case 'cDF':         ret = Balance_cDF;    break;
            case 'cYFII':         ret = Balance_cYFII;    break;
            case 'cSWRV':         ret = Balance_cSWRV;    break;
            case 'cKP3R':         ret = Balance_cKP3R;    break;
            case 'cUMA':         ret = Balance_cUMA;    break;
            case 'cKNC':         ret = Balance_cKNC;    break;
            case 'cSNX':         ret = Balance_cSNX;    break;
            case 'csUSD':         ret = Balance_csUSD;    break;
            case 'MNNFT':         ret = Balance_MNNFT;    break;
            case 'cITF':         ret = Balance_cITF;    break;
            case 'conDragon':         ret = Balance_conDragon;    break;
            case 'CF':         ret = Balance_CF;    break;
            case 'CG':         ret = Balance_CG;    break;
            case 'cAMP':         ret = Balance_cAMP;    break;
            case 'cDPI':         ret = Balance_cDPI;    break;
            case 'TD':         ret = Balance_TD;    break;
            case 'cFLUX':         ret = Balance_cFLUX;    break;
            case 'cBNB':         ret = Balance_cBNB;    break;
            case 'cMBTM':         ret = Balance_cMBTM;    break;
            case 'cHBTC':         ret = Balance_cHBTC;    break;
            case 'TREA':         ret = Balance_TREA;    break;
            case 'YAO':         ret = Balance_YAO;    break;
            case 'cOKT':         ret = Balance_cOKT;    break;
            case 'K':         ret = Balance_K;    break;
            case 'ACGNFT':         ret = Balance_ACGNFT;    break;
            case 'EPIK-NFT':         ret = Balance_EPIK_NFT;    break;
            case 'POOLGO':         ret = Balance_POOLGO;    break;
            case 'POS':         ret = Balance_POS;    break;
            case 'ARTT':         ret = Balance_ARTT;    break;
            case 'CTN':         ret = Balance_CTN;    break;
            case 'PHM-NFT':         ret = Balance_PHM_NFT;    break;
            case 'DAN':         ret = Balance_DAN;    break;
            default:
                if (contractId > -1) {
                    return new DynamicBalanceModel(contractId)
                }
                if (silent) {
                    return null
                }
                throw new Error('unknown balance type, please fix the mapping code. name:'+name)
        }
        return ret;
    }

    async schedule(delay:number = 100) {
        //
        const position = await KV.findOne({where:{key: this.addressPosKey}})
        if (position == null) {
            await KV.create({key: this.addressPosKey, value: "0"})
        } else if (position.value === '-1') {
            // console.log(`reach max ${this.addressPosKey}, do not schedule.`)
            return;
        }
        //
        const that = this;
        async function repeat() {
            let goOn = await that.run().catch(err=>{
                console.log(`balance watcher ${that.name} fail:`, err)
                return true
            })
            if (goOn) {
                setTimeout(repeat, delay)
            }
        }
        repeat().then()
        console.log(`schedule balance watcher : ${this.name}`)
    }

    public async run() :Promise<boolean> {
        // console.log(`run balance watcher ${this.name}`)
        let lastId = await KV.getNumber(this.addressPosKey)
        if (lastId < 0) {
            return false;
        }
        if (this.name !== 'cfx'){
            // erc 20, 721, 1155
            await this.batchErc(lastId, this.tokenType.includes('1155'));
            return true
        }
        let curId = lastId + 1
        this.addressPos = curId
        const hex = await Hex40Map.findByPk(curId)
        if (hex !== null) {
            await this.queryBalance('0x'+hex.hex, hex.id)
        } else if (curId > (await Hex40Map.max("id"))){
            console.log(`${fmtDtUTC(new Date())} ${this.addressPosKey} reach max, id: ${curId}`)
            curId = -1
        }
        await this.savePosition(curId);
        return true
    }

    private async savePosition(curId: number) {
        await KV.update({value: curId.toString()}, {where: {key: this.addressPosKey}})
    }

    async batchErc(lastId:number, flag1155:boolean = false) {
        const batch = 100
        let left = lastId + 1; //include
        let right = left + batch - 1;//include
        this.addressPos = right
        const hexBeanList = await Hex40Map.findAll({
            where: {id: {[Op.between]:[left, right]}}
        })
        if (hexBeanList.length === 0) {
            if (right > ((await Hex40Map.max("id")))) {
                console.log(`${fmtDtUTC(new Date())} ${this.addressPosKey} batch reach max, id: ${right}`)
                await this.savePosition(-1)
            } else {
                await this.savePosition(right)
            }
            return
        }
        const hexList = hexBeanList.map(bean=>`0x${bean.hex}`);
        const utilContractAddr = await BatchBalanceWatcher.getUtilContractAddr()
        let bans = flag1155
            ? await BatchBalanceWatcher.allTokenContract.getBalances(hexList, this.contractAddress).catch(err=>{
                console.log(` allTokenContract.getBalances error ${err}, util contract ${utilContractAddr}, token ${this.contractAddress}`)
                return []
            })
            : await BatchBalanceWatcher.contract.balances(hexList, [this.contractAddress])
        if (bans.length === 0) {
            return;
        }
        let i = 0;
        for (const bean of hexBeanList) {
            await this.save(bean.id, bans[i], !flag1155)
            i++
        }
        // console.log(`batch erc balance, ${this.name}, count ${bans.length}`)
        await this.savePosition(right)
    }

    // Deprecated
    async queryBalanceErc1155(hex:string) {
        let tokenIdList = this.tokenIdsCache.get(this.contractHex40id)
        if (tokenIdList === undefined) {
            tokenIdList = await NftId.findAll({where: {contractHexId: this.contractHex40id}})
            const ttl = 60 + Math.round(Math.random() * 60) //second
            this.tokenIdsCache.set(this.contractHex40id, tokenIdList, ttl)
            console.log(`build token id list cache ${this.contractHex40id}`)
        }
        // else console.log(`hit cache ${this.contractHex40id}`)
        if (tokenIdList.length === 0) {
            return null
        }
        const tokenIds = tokenIdList.map(tk=>tk.nftId)
        const addrArr = tokenIdList.map(tk=>hex)
        let baList = await this.miniERC1155.balanceOfBatch(addrArr, tokenIds).catch(err=>{
            console.log(`balance of batch fail, ${this.name} ${this.contractAddress}:`, err)
            return null;
        });
        return baList
    }
    async queryBalance(hex: string, addrId: number) {
        let isNFT = this.tokenType === 'erc1155';
        if (isNFT) {
            const baList = await this.queryBalanceErc1155(hex)
            if (baList === null) {
                return
            }
            const currentAddressHasHowManyToken = baList.filter(n=>n > 0).length;
            await this.save(addrId, currentAddressHasHowManyToken, false)
        } else {
            await this.queryBalanceErc20(hex, addrId)
        }
    }
    async queryBalanceErc20(hex: string, addrId: number) {
        try {
            // @ts-ignore
            const ban = await this.miniERC20.balanceOf(format.address(hex, StatApp.networkId));
            await this.save(addrId, ban);
            if (this.addressPos % 100 === 0) {
                console.log(`${fmtDtUTC(new Date())} update balance, position of ${this.addressPosKey
                } is ${this.addressPos}`)
            }
        } catch (err) {
            console.log(`execute fail:`, err)
        }

    }

    protected async save(addrId: number, ban: any, needScale = true) {
        await BalanceWatcher.saveModel(this.model, addrId, ban, needScale, this.fraction)
    }
    public static async saveModel(model, addrId: number, ban: any, needScale = true, fraction: any) {
        if (ban < 1) {
            await model.destroy({where: {addressId: addrId}})
            return Promise.resolve();
        }
        if (needScale) {
            ban = BalanceWatcher.drip2cfx(ban, fraction)
        }
        await model.upsert({addressId:addrId, balance: ban}, {});
    }

    public static drip2cfx(drip, fraction) {
        return BigFixed(drip).div(BigFixed(fraction))
    }
}
export class CfxWatcher extends BalanceWatcher{
    constructor(name:string, cfx:Conflux) {
        super(name, null, cfx, {tokenType: 'CFX'});
    }
    async queryBalance(hex: string, addrId: number): Promise<void> {
        try {
            // @ts-ignore
            const accountInfo:any = await this.cfx.getAccount(format.address(hex, StatApp.networkId))
            if (accountInfo.balance < 1 && accountInfo.stakingBalance < 1) {
                await this.model.destroy({where: {addressId: addrId}})
                return Promise.resolve();
            }
            const cfx:any = BalanceWatcher.drip2cfx(accountInfo.balance, this.fraction)
            const staking:any = BalanceWatcher.drip2cfx(accountInfo.stakingBalance, this.fraction)
            const total = cfx.add(staking)
            await CfxBalance.upsert({addressId: addrId, balance:cfx, stakingBalance: staking,
                total: total})
        } catch (err) {
            console.log(`query cfx account fail:`, err)
        }
    }
}
export class Erc20Watcher extends BalanceWatcher{
}
