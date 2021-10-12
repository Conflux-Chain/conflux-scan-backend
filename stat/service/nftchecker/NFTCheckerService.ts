import {NFTMap, NFTMapPlus} from "./NFTInfo";
import {Token} from "../../model/Token";
import {Op} from "sequelize";
import {KEY_NFT_FROM_DB, KV} from "../../model/KV";
import {getNftBalances} from "../NftService";

const lodash = require('lodash');
const {abi} = require('../abi/ScanUtilitiesProxy');
const CONST = require('../common/constant');

export class NFTCheckerService {
    private scanUtilContractAddress = 'cfx:acef1ym9m16fc94x29h0800k0ugnaj91sjjbm60hfh';
    private app;
    private cfx;
    private readonly contract;

    constructor(app: any, utilContractAddr = undefined) {
        this.app = app;
        this.cfx = app.cfx;
        this.contract = this.cfx.Contract({abi, address: utilContractAddr || this.scanUtilContractAddress});
    }

    public async getNFTBalances({ownerAddress}) {
        const options = {
            attributes: ['base32', 'name'],
            where: { type: {[Op.in]: [CONST.TRANSFER_TYPE.ERC721, CONST.TRANSFER_TYPE.ERC1155]}, auditResult: true},
            raw: true,
        };
        const tokenArray = await Token.findAll(options);
        const NFTArray = tokenArray.map(token => {
            return {
                address: token.base32,
                type: token.name.replace(/\s+/g,""),
                name: {
                    zh: token.name,
                    en: token.name,
                }
            };
        });
        const NFTMapDb = lodash.keyBy(NFTArray, 'address');
        // will change NFTMapPlus
        lodash.defaults(NFTMapPlus, NFTMapDb);

        const contractAddresses = Object.keys(NFTMapPlus);
        const balances = await this._getNFTBalances({ownerAddress, contractAddresses});
        const nftBalances = Object.keys(NFTMapPlus)
            .map((address, index) => ({
                address,
                type: NFTMapPlus[address].type,
                name: NFTMapPlus[address].name,
                balance: balances[index],
            }))
            .filter(n => n.balance > 0);
        return nftBalances;
    }

    public async getNFTTokens({ ownerAddress, contractAddress, offset = 0, limit = 12 }
    : { ownerAddress: string, contractAddress: string, offset?: number, limit?: number }
    ){
        const nftTokens = await this._getNFTTokens({ownerAddress, contractAddress, offset, limit});
        return nftTokens;
    }

    private async _getNFTBalances({ ownerAddress, contractAddresses }
    : { ownerAddress: string, contractAddresses: string[] }
    ) : Promise<any[]>{
        const useDb = await KV.getString(KEY_NFT_FROM_DB, '')
        try {
            return Boolean(useDb) ?
                getNftBalances(ownerAddress, contractAddresses)
                :
                this.contract.getBalances( ownerAddress, contractAddresses );
        } catch (e) {
            console.error(`getNFTBalances, ownerAddress:${ownerAddress}, contractAddresses:${contractAddresses}`, e);
            return null;
        }
    };

    public async _getNFTTokens( {ownerAddress, contractAddress, offset, limit}
    : { ownerAddress: string, contractAddress: string | undefined, offset?: number, limit?: number }
    ){
        try {
            if (!contractAddress) {
                return null;
            }
            console.info(`ownerAddress:${ownerAddress}, contractAddress:${contractAddress}, offset:${offset}, limit:${limit}`)
            return this.contract.getTokens( contractAddress, ownerAddress, offset, limit );
        } catch (e) {
            console.error(`getNFTTokens, ownerAddress:${ownerAddress}, contractAddress:${contractAddress}`, e);
            return null;
        }
    };
}
