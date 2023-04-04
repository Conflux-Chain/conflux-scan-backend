import {Op} from "sequelize";
import { format } from "js-conflux-sdk";
import {StatApp} from "../StatApp";
import {Contract} from "../model/Contract";
import {TraceCreateContract} from "../model/TraceCreateContract";
import {
    POCKET_ADDRESS_MAP, ESpaceHex40Map, Hex40Map, getAddrId
} from "../model/HexMap";
import {AddressCfxTransfer} from "../model/CfxTransfer";
import {AddressErc20Transfer} from "../model/Erc20Transfer";
import {AddressErc721Transfer} from "../model/Erc721Transfer";
import {AddressErc1155Transfer} from "../model/Erc1155Transfer";
import {FullMinerBlock} from "../model/FullMinerBlock";
import {NftMint} from "../model/Token";

const lodash = require('lodash');

export class AccountQuery {
    protected app: any;

    constructor(app: any) {
        this.app = app;
    }

    public async listPatchInfo(addrArray) {
        const hexArray = [...new Set(addrArray?.filter(Boolean).map(item => format.hexAddress(item)))];
        if (hexArray.length === 0) {
            return { total: 0, map: {} };
        }

        const idHexMap = await this.idHex40Map(hexArray);
        const [contractResp, eSpaceResp, ensResp] = await Promise.all([
            this.listContractInfo(idHexMap),
            this.listESpaceInfo(idHexMap),
            this.listEnsInfo(idHexMap),
        ]);

        const map = {};
        [ensResp, eSpaceResp, contractResp].forEach(
            resp => {
                Object.keys(resp.map).forEach(address => {
                    if(!map[address]) map[address] = {};
                    map[address] = lodash.defaults(map[address], resp.map[address]);
                });
            }
        )

        return { total: Object.keys(map).length, map };
    }

    public async listContractInfo(idHexMap) {
        const {
            app: { tokenQuery, contractQuery, service },
        } = this;

        // get synced info
        const idArray = Object.keys(idHexMap);
        const [traceCreates, registeredContracts] = await Promise.all([
            TraceCreateContract.findAll({attributes: ['to'], where: {to: {[Op.in]: idArray}}}),
            Contract.findAll({attributes: ['hex40id'], where: {hex40id: {[Op.in]: idArray}}}),
        ]);

        // get contract address
        const contractIdArray = [
            ...new Set([...traceCreates.map(item => item.to),
                ...registeredContracts.map(item => item.hex40id)
            ])];
        const addressArray = contractIdArray.map(item => format.address(idHexMap[item], StatApp.networkId));
        if (addressArray.length === 0) {
            return { total: 0, map: {} };
        }

        // init
        const map = {};
        addressArray.forEach((address) => { map[address] = {contract: {address}, token: {address}}; });

        // query contract and token
        const tokenService = tokenQuery || service.tokenQuery || service.tokenRdb;
        const contractService = contractQuery || service.contractQuery || service.contractRdb;
        const [contractArray, verifiedArray, tokenArray] = await Promise.all([
            contractService.list({ addressArray })
                .then(response => response.list.map(contract => ({ address: contract.address, name: contract.name }))),
            contractService.listVerify({ addressArray })
                .then(response => response.list.map(verified => verified.address)),
            tokenService.list({addressArray})
                .then(response => response.list),
        ]);

        // build map
        contractArray.forEach((contract) => {
            map[contract.address].contract = lodash.defaults(map[contract.address].contract, {
                name: contract.name,
                isVirtual: POCKET_ADDRESS_MAP[contract.name] == format.hexAddress(contract.address),
                verify: { result: lodash.includes(verifiedArray, contract.address) ? 1 : 0 },
            });
        });
        verifiedArray.forEach((verifiedAddress) => {
            map[verifiedAddress].contract = lodash.defaults(map[verifiedAddress].contract, {
                verify: { result: 1 },
            });
        });
        tokenArray.forEach((token) => {
            map[token.address].token = lodash.defaults(map[token.address].token, {
                name: token.name,
                symbol: token.symbol,
                decimals: token.decimals,
                icon: token.icon,
                iconUrl: token.iconUrl,
                website: token.website,
                tokenType: token.transferType,
            });
        });

        return { total: Object.keys(map).length, map };
    }

    public async listESpaceInfo(idHexMap) {
        // query eSpace address
        const idArray = Object.keys(idHexMap);
        const eSpaceHexBeanArray = await ESpaceHex40Map.findAll({where: {hexId: {[Op.in]: idArray}}});

        // build map
        const map = {};
        eSpaceHexBeanArray.forEach(item => {
            map[format.address(`${idHexMap[item.hexId]}`, StatApp.networkId)] = {eSpace: {address: `0x${item.hex}`}};
        });

        return { total: Object.keys(map).length, map };
    }

    public async listEnsInfo(idHexMap) {
        const {
            app: { ensCheckerQuery, service },
        } = this;

        // query ens
        const hexArray = Object.values(idHexMap);
        const ensCheckerService = ensCheckerQuery || service.ensCheckerQuery;
        const ensMap = await ensCheckerService.nameBatch(hexArray as string[]);

        // build map
        const map = {};
        Object.keys(ensMap).forEach(base32 => {
            map[base32] = {ens: ensMap[base32]};
        });

        return { total: Object.keys(map).length, map };
    }

    public async getBasicInfo(addr) {
        const addrId = await getAddrId(addr);

        const tabMap = {
            cfxTransferTab: {model: AddressCfxTransfer, addressIdFieldName: 'addressId'},
            erc20TransferTab: {model: AddressErc20Transfer, addressIdFieldName: 'addressId'},
            erc721TransferTab: {model: AddressErc721Transfer, addressIdFieldName: 'addressId'},
            erc1155TransferTab: {model: AddressErc1155Transfer, addressIdFieldName: 'addressId'},
            nftAssetTab: {model: NftMint, addressIdFieldName: 'toId'},
            minedBlockTab: {model: FullMinerBlock, addressIdFieldName: 'minerId'},
        }

        await Promise.all(Object.keys(tabMap).map((tabType)=>{
            const {model, addressIdFieldName} = tabMap[tabType];
            return model.findOne({where: {[addressIdFieldName]: addrId}}).then(record=>{
                tabMap[tabType] = record ? 1 : 0;
            });
        }))

        return tabMap;
    }

    private async idHex40Map(hexArray) {
        hexArray = hexArray.map(hex=>hex.startsWith('0x') ? hex.substr(2) : hex)
        const hexBeanArray = await Hex40Map.findAll({
            where: {hex: {[Op.in]: hexArray}},
        })
        const result = {};
        hexBeanArray.forEach(hexBean=>{
            result[hexBean.id] = `0x${hexBean.hex}`;
        })
        return result;
    }
}
