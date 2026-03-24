import {Erc1155Data, NftMint} from "../../model/Token";
import {Op, QueryTypes} from "sequelize";
import {
    convert2base32map,
    getAddrId,
    getAddrIdArray,
    getAddrIdBase32Map,
    idHex40Map
} from "../../model/HexMap";
import {TokenBalance} from "../../model/Balance";
import {CONST} from "../common/constant"
import {NftMetaFts} from "./NftMetaStorage";
import {TokenQuery} from "../TokenQuery";
import {emptyField} from "../common/utils";
import {getNFTOwnerCount} from "../../model/TransferCount";
import {AddressNfts} from "../../model/AddrNft";
import {fmtAddr, StatApp} from "../../StatApp";
import {ethers} from "ethers";
import {format} from "js-conflux-sdk";
import {safeAddErrorLog} from "../../monitor/ErrorMonitor";
import {checkAccount1155balance} from "../watcher/AccountChecker";

const lodash = require('lodash');

export class NFTCheckerService {
    private app;

    constructor(app: any) {
        this.app = app;
    }

    public async listNftTokensForOpenApiPro(
        {
            owner,
            contract,
            tokenId,
            sort = 'DESC',
            sortField = 'latest_update_time',
            cursor = 0,
            skip = 0,
            limit = 10,
            type,
        }: {
            owner?: string,
            contract?: string[],
            tokenId?: string,
            sort?: string,
            sortField?: string,
            cursor?: number,
            skip?: number,
            limit?: number,
            type?: NFTType,
        }) {
        const ownerId = owner ? await getAddrId(owner) : owner;
        const contractIds = contract ? await getAddrIdArray(contract) : contract;
        if ((owner && !ownerId) || (contract?.length && !contractIds?.length)) {
            return {total: 0, list: []};
        }

        const cursorField = sortField === 'latest_update_time' ? 'updatedCursor' : 'id';
        const cursorValue = cursor;

        async function doQuery() {
            let page;
            if (cursor > 0 && skip === 0) {
                delete options.offset;
                options.where[cursorField] = {[sort === 'DESC' ? Op.lt : Op.gt]: cursorValue};
                const rows = await AddressNfts.findAll(options);
                delete options.attributes;
                delete options.where[cursorField];
                const count = await AddressNfts.count(options);
                page = {count, rows};
            } else {
                if (cursorField === 'id') {
                    options.order.unshift(['updatedAt', sort]);
                }
                page = await AddressNfts.findAndCountAll(options);
            }
            return page;
        }

        const options: any = {offset: skip, limit, raw: true, order: [[cursorField, sort]]};
        const contractLen = contractIds?.length;
        const contractId = contractLen ? (contractLen === 1 ? contractIds[0] : {[Op.in]: contractIds}) : undefined;
        options.attributes = ['id', 'contractId', 'addressId', 'tokenId', 'value', 'type', 'updatedCursor'];
        options.where = emptyField({
            addressId: ownerId, contractId, tokenId, value: {[Op.gt]: 0},
            type: type ? parseInt(type.substr(-2)) : type
        });

        const {count: total, rows} = await doQuery();

        let list = [];
        if (rows?.length) {
            const mapIdToHex = await idHex40Map([...new Set(rows.flatMap(r => [r.addressId, r.contractId]))], true);

            const addressMapper = (address) => {
                return StatApp.isEVM ?
                    ethers.getAddress(format.hexAddress(address)) :
                    format.address(address, StatApp.networkId);
            }

            list = rows.map(item =>
                ({
                    owner: addressMapper(mapIdToHex.get(item.addressId)),
                    contract: addressMapper(mapIdToHex.get(item.contractId)),
                    tokenId: item.tokenId,
                    amount: item.value,
                    type: item.type === CONST.ADDRESS_TRANSFER_TYPE.ERC721.code ? 'CRC721' : 'CRC1155',
                })
            );
        }

        if (contractIds.length == 1) {
            try {
                checkAccount1155balance(contractIds[0] as number, ownerId as number, total);
            } catch (e) {
                safeAddErrorLog('api', 'nft-checker-service', e);
            }
        }

        return {total, list, next: rows?.length ? rows[rows.length - 1][cursorField] : 0};
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
                row.contract = fmtAddr(`0x${hex40Map.get(Number(row.contractId))}`, StatApp.networkId);
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

export type NFTType = 'ERC721' | 'ERC1155';
