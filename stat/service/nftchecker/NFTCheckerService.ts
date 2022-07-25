import {NFTMap, NFTMapPlus} from "./NFTInfo";
import {Erc1155Data, NftMint, Token} from "../../model/Token";
import {Op, QueryTypes} from "sequelize";
import {KEY_NFT_FROM_DB, KEY_NFT_FROM_MINT_TABLE, KV} from "../../model/KV";
import {getNftBalances} from "../NftService";
import {Desensitizer} from "../Desensitizer";
import {convert2base32map, getAddrId, idHex40Map} from "../../model/HexMap";
import {TokenBalance} from "../../model/Balance";
import {CONST} from "../common/constant"

const lodash = require('lodash');
const {abi} = require('../abi/ScanUtilitiesProxy');
/*const CONST = require('../common/constant');*/

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

    public async getNFTBalances ({ownerAddress}) {
        const nftBalances = await this.getNFTBalances0({ownerAddress});
        nftBalances?.forEach(nftBalance => {
            nftBalance.type = Desensitizer.mosaicStr(nftBalance.address, nftBalance.type);
            nftBalance.name.zh = Desensitizer.mosaicStr(nftBalance.address, nftBalance.name.zh);
            nftBalance.name.en = Desensitizer.mosaicStr(nftBalance.address, nftBalance.name.en);
        });
        return nftBalances;
    }

    private async getNFTBalances0({ownerAddress}) {
        // const options = {
        //     attributes: ['base32', 'name'],
        //     where: { type: {[Op.in]: [CONST.TRANSFER_TYPE.ERC721, CONST.TRANSFER_TYPE.ERC1155]}, auditResult: true},
        //     raw: true,
        // };
        // const tokenArray = await Token.findAll(options);
        const sql = `select base32, name from token where type in('ERC721', 'ERC1155') 
                                 and (auditResult = 1 or base32 in(select address from blacklist))`;
        const tokenArray: Token[] = await Token.sequelize.query(sql, {type: QueryTypes.SELECT, raw: true});
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

    public async getNftBalancesForOpenApi({owner, skip = 0, limit = 100}
                                    : { owner: string, skip?: number, limit?: number }) {
        const ownerAddressId = await getAddrId(owner);
        if(owner && !ownerAddressId) {
            return {total: 0, list: []};
        }

        const sqlCountClause = `select count(*) as cntr `;
        const sqlSelectClause = `select t.base32, b.balance, t.name, t.symbol, t.decimals, t.type, t.webSite, t.iconUrl `;
        const sqlFromClause = `from token_balance b left join token t on b.contractId = t.hex40id 
            where b.addressId = ? and (t.type = 'ERC721' or t.type = 'ERC1155') and destroyed = 0 and t.name is not null `;
        const sqlLimitClause = `limit ?,? `;
        const sqlOrderClause = `order by b.updatedAt desc `;

        const count = await TokenBalance.sequelize.query(`${sqlCountClause}${sqlFromClause}`, {
            type: QueryTypes.SELECT,
            replacements: [ownerAddressId],
            logging: console.info,
        }).then(list => {
            return Number(list[0]['cntr'])
        })
        const list = await TokenBalance.sequelize.query(`${sqlSelectClause}${sqlFromClause}${sqlOrderClause}${sqlLimitClause}`, {
            type: QueryTypes.SELECT,
            replacements: [ownerAddressId, skip, limit],
            logging: console.info,
        }).then(list => list.map(item => ({
            owner,
            contract: item['base32'],
            balance: item['balance'],
            name: item['name'],
            symbol: item['symbol'],
            type: item['type'],
            webSite: item['webSite'],
            iconUrl: item['iconUrl'],
            })
        ))

        return {total: count ? count : 0, list};
    }

    public async getNftTokensForOpenApi({owner, contract, skip = 0, limit = 10}
                                  : { owner?: string, contract: string, skip: number, limit: number }) {
        // const debug = true
        const ownerAddressId = owner ? await getAddrId(owner) : owner;
        const contractAddressId = contract ? await getAddrId(contract): contract;
        if((owner && !ownerAddressId) || (contract && !contractAddressId)) {
            return {total: 0, list: []};
        }
        const zeroAddressId = await getAddrId(CONST.ZERO_ADDRESS);

        if (contractAddressId) {
            const token = await Token.findOne({
                where: {hex40id: contractAddressId, type: 'ERC1155'},
                attributes: ['type', 'base32']
            })
            if (token) {
                const where: any = {contractId: contractAddressId, addressId: ownerAddressId};
                if (!ownerAddressId) {
                    delete where.addressId
                    where.addressId = {[Op.ne]: zeroAddressId};
                }
                const page = await Erc1155Data.findAndCountAll({
                    where, raw: true,
                    order:[['id','desc']], offset: skip, limit,
                    // benchmark: debug, logging: debug ? console.log : false,
                })
                const list = page?.rows?.map(item => ({contract: token.base32, tokenId: item.tokenId}))
                return {total:  page?.count || 0, list: list || []};
            }
        }

        const where: any = {contractId: contractAddressId, toId: ownerAddressId};
        if (!contractAddressId) {
            delete where.contractId
        }
        if (!ownerAddressId) {
            delete where.toId
            where.toId = {[Op.ne]: zeroAddressId};
        }
        const options: any = {
            where,
            order: [['updatedAt', 'DESC']],
            offset: skip,
            limit,
            raw: true,
            // benchmark: debug, logging: debug ? console.log : false,
        };
        const page = await NftMint.findAndCountAll(options);
        const count = page?.count;
        const nftMintArray = page?.rows;

        let list = [];
        if(nftMintArray){
            list = nftMintArray.map(item => ({contractId: item.contractId, tokenId: item.tokenId}))
            const hexIdSet = new Set(list.map(item => item.contractId));
            const hexIdHexMap = await idHex40Map([...hexIdSet])
            const hexIdBase32Map = convert2base32map(hexIdHexMap)
            list.forEach(item => {
                item['contract'] = hexIdBase32Map.get(item.contractId);
                delete item.contractId;
            });
        }

        return {total: count ? count : 0, list};
    }
}
