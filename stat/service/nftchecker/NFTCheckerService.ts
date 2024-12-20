import {NFTMapPlus} from "./NFTInfo";
import {Erc1155Data, NftMint, Token} from "../../model/Token";
import {Op, QueryTypes, Sequelize} from "sequelize";
import {KEY_NFT_FROM_DB, KV} from "../../model/KV";
import {getNftBalances} from "../NftService";
import {Desensitizer} from "../Desensitizer";
import {
    convert2base32map,
    getAddrId,
    getAddrIdArray,
    getAddrIdBase32Map,
    hex40IdMap,
    idHex40Map
} from "../../model/HexMap";
import {TokenBalance} from "../../model/Balance";
import {CONST} from "../common/constant"
import {NftMetaFts} from "./NftMetaStorage";
import {format} from "js-conflux-sdk";
import {TokenQuery} from "../TokenQuery";
import {toBase32} from "../tool/AddressTool";
import {emptyField} from "../common/utils";
import {getNFTOwnerCount} from "../../model/TransferCount";
import {AddressNfts} from "../../model/AddrNft";
import {fmtAddr} from "../../StatApp";

const lodash = require('lodash');
const {abi} = require('../abi/ScanUtilitiesProxy');

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
        lodash.defaults(NFTMapPlus, NFTMapDb);// will change NFTMapPlus

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

        nftBalances?.forEach(nftBalance => {
            nftBalance.type = Desensitizer.mosaicStr(nftBalance.address, nftBalance.type);
            nftBalance.name.zh = Desensitizer.mosaicStr(nftBalance.address, nftBalance.name.zh);
            nftBalance.name.en = Desensitizer.mosaicStr(nftBalance.address, nftBalance.name.en);
        });
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
            // logging: buildSqlLog('count nft balances'), benchmark: true,
        }).then(list => {
            return Number(list[0]['cntr'])
        })
        const list = await TokenBalance.sequelize.query(`${sqlSelectClause}${sqlFromClause}${sqlOrderClause}${sqlLimitClause}`, {
            type: QueryTypes.SELECT,
            replacements: [ownerAddressId, skip, limit],
            // logging: buildSqlLog('query nft balances'), benchmark: true,
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

    public async getNftTokensForOpenApiPro({owner, contract, tokenId, sort = 'DESC', sortField = 'latest_update_time', cursor = 0, skip = 0, limit = 10}
        : { owner?: string, contract?: string[], tokenId?: string, sort?: string, sortField?: string, cursor?: number, skip?: number, limit?: number}) {
        const ownerId = owner ? await getAddrId(owner) : owner;
        const contractIdArray = contract ? await getAddrIdArray(contract) : contract;
        if ((owner && !ownerId) || ( contract?.length && !contractIdArray?.length)) {
            return {total: 0, list: []};
        }

        const cursorField = sortField === 'latest_update_time' ? 'updatedCursor' : 'id'
        const cursorValue = cursor
        async function doQuery(model) {
            if(cursor > 0 && skip === 0) {
                delete options.offset;
                options.where[cursorField] = {[sort === 'DESC' ? Op.lt : Op.gt]: cursorValue};
                const rows = await model.findAll(options);
                delete options.attributes;
                delete options.where[cursorField];
                const count = await model.count(options);
                page = {count, rows};
            } else{
                page = await model.findAndCountAll(options);
            }
            return page;
        }

        let page;
        const options: any = { offset: skip, limit, raw: true, order: [[cursorField, sort]] };
        const contractLen = contractIdArray?.length;
        const contractId = contractLen ? (contractLen === 1 ? contractIdArray[0] : {[Op.in]: contractIdArray}) : undefined;
        options.attributes = ['id', 'contractId', 'addressId', 'tokenId', 'value', 'type', 'updatedCursor'];
        options.where = emptyField({addressId: ownerId, contractId, tokenId, value: {[Op.gt]: 0}});
        page = await doQuery(AddressNfts);

        const list = [];
        const {count: total, rows} = page;
        if (rows?.length) {
            const idBase32Map = await getAddrIdBase32Map(rows, 'contractId', 'addressId');
            rows.forEach(item => list.push({
                owner: idBase32Map.get(item.addressId),
                contract: idBase32Map.get(item.contractId),
                tokenId: item.tokenId,
                amount: item.value,
                type: item.type === CONST.ADDRESS_TRANSFER_TYPE.ERC721.code ? 'CRC721' : 'CRC1155',
            }));
        }

        return {total, list, next: rows?.length ? rows[rows.length-1][cursorField] : 0};
    }

    public async getNftTokensByFtsForOpenApi({contract, name}: {contract?: string, name: string}) {
        const RESULT_LIMIT_BY_FTS = 10;
        if(!name) {
            return {total: 0, list: []};
        }

        const cid = contract ? await getAddrId(contract): contract;
        let sql;
        if(cid) {
            sql = `select contractId, tokenId from nft_metadata_fts where contractId = ${cid} and match(name) against('${name}') limit 500;`;
        } else{
            sql = `select contractId, tokenId from nft_metadata_fts where match(name) against('${name}') limit 500;`;
        }
        let nftFtsList = await NftMetaFts.sequelize.query(sql, {
            type: QueryTypes.SELECT,
            raw: true,
            logging: sql => console.log(`NftMeta group sql ${sql}`)
        }) as any[];
        if(!nftFtsList?.length) {
            return {total: 0, list: []};
        }

        const contractIdSet = new Set<number>();
        const tokenIdSet = new Set<string>();
        nftFtsList.forEach(nftFts => {
            contractIdSet.add(nftFts.contractId);
            tokenIdSet.add(nftFts.tokenId);
        });
        const page = await NftMetaFts.findAndCountAll({
            attributes: ['contractId', 'tokenId', 'name'],
            where: {
                contractId: {[Op.in]: [...contractIdSet]},
                tokenId: {[Op.in]: [...tokenIdSet]},
                name: {[Op.like]: `%${name}%`}
            },
            limit: RESULT_LIMIT_BY_FTS,
            raw: true,
        });
        const total = Math.min(page?.count || 0, RESULT_LIMIT_BY_FTS);
        const list = (page?.rows || []) as any[];

        if(list?.length){
            const hex40IdSet = new Set<number>();
            list.forEach(row => hex40IdSet.add(Number(row.contractId)));
            const hex40Map = await idHex40Map([...hex40IdSet]);
            list.forEach(row=>{
                row.contract = fmtAddr(`0x${hex40Map.get(Number(row.contractId))}`, this.app?.networkId);
                delete row.contractId;
            })
        }
        return {total, list};
    }

    public async getNftOwnersForOpenApi({contract, tokenId, cursor = 0, limit = 10}
        : {contract: string, tokenId?: string, cursor: number, limit: number}) {
        const contractId = contract ? await getAddrId(contract) : contract;
        const byCollection = tokenId === undefined;
        if (!contract || !contractId) {
            return {total: 0, list: []};
        }

        const {type} = await TokenQuery.detectTokenType({hex40id: contractId});
        const {ERC721, ERC1155} = CONST.TRANSFER_TYPE;
        if (type !== ERC721 && type !== ERC1155) {
            return {total: 0, list: []};
        }

        const total = await getNFTOwnerCount(contractId as number, tokenId, type);
        let rows;
        if(byCollection) {
            const options: any = {
                attributes: [['addressId','id'], 'addressId', ['balance', 'amount']],
                where: {addressId: {[Op.gt]: cursor}, contractId}, order: [['addressId', 'asc']], limit, raw: true
            };
            rows = await TokenBalance.findAll(options);
        } else {
            const options: any = {
                where: {id: {[Op.gt]: cursor}, contractId, tokenId}, order: [['id', 'asc']], limit, raw: true
            };
            if (type === ERC721) {
                rows = await NftMint.findAll(lodash.assign(options, {attributes: ['id', ['toId', 'addressId']]}));
            } else {
                rows = await Erc1155Data.findAll(lodash.assign(options, {attributes: ['id', 'addressId', 'amount']}));
            }
        }

        const list = rows?.map(item => {
            return lodash.assign(item, {amount: (type === ERC721 && !byCollection) ? 1 : item.amount});
        });
        const next = list?.length ? list[list.length-1].id : 0;
        if (list?.length) {
            const addressIdSet = new Set(list.map(item => item.addressId));
            const hexIdHexMap = await idHex40Map([...addressIdSet] as number[]);
            const hexIdBase32Map = convert2base32map(hexIdHexMap);
            list.forEach(item => {
                item['address'] = hexIdBase32Map.get(item.addressId);
                delete item.id;
                delete item.addressId;
            });
        }

        return {total, next, list: list || []};
    }
}
