import {Op} from "sequelize";
import {format} from "js-conflux-sdk";
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
import {Erc1155Data, NftMint} from "../model/Token";
import {NameTag} from "../model/NameTag";
import {KEY_CAUTION_LABELS, KV} from "../model/KV";
import {NAME_TAG_SPLIT} from "./EpochSync";
import {ethers} from "ethers";

const lodash = require('lodash');
const BigFixed = require('bigfixed');

export class AccountQuery {
    protected app: any;
    protected CAUTION_FLUSH_INTERVAL = 180_000; // 3 min
    protected cautionLoadTimestamp;
    public cautionSet: Set<string> = new Set<string>();


    constructor(app: any) {
        this.app = app;
    }

    public async listPatchInfo(addrArray, options : {
        withContractInfo?: boolean, withESpaceInfo?: boolean, withEns?: boolean, withNameTag?: boolean
    } = {withContractInfo: true, withESpaceInfo: true, withEns: true, withNameTag: true}) {
        const hexArray = [...new Set(addrArray?.filter(Boolean).map(item => format.hexAddress(item)))];
        if (hexArray.length === 0) {
            return { total: 0, map: {} };
        }

        const idHexMap = await this.idHex40Map(hexArray);
        const [contractResp, eSpaceResp, ensResp, nameTagResp] = await Promise.all([
            options.withContractInfo ? this.listContractInfo(idHexMap) : {} as any,
            options.withESpaceInfo ? this.listESpaceInfo(idHexMap) : {} as any,
            options.withEns ? this.listEnsInfo(idHexMap) : {} as any,
            options.withNameTag ? this.listNameTagInfo(idHexMap) : {} as any,
        ]);

        const map = {};
        [ensResp, eSpaceResp, contractResp, nameTagResp].forEach(
            resp => {
                if(!resp?.total) return;
                Object.keys(resp.map).forEach(address => {
                    const newObj = resp.map[address];
                    let preObj = map[address] || {};
                    if (StatApp.isEVM) {
                        // translate each key and value.address
                        address = ethers.utils.getAddress(format.hexAddress(address))
                        Object.keys(newObj).forEach(p=>{
                            if (newObj[p].address) {
                                newObj[p].address = address
                            }
                        })
                    }
                    map[address] = lodash.defaults(preObj, newObj);
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
                name: contract.name  || undefined,
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
                name: token.name || undefined,
                symbol: token.symbol || undefined,
                decimals: token.decimals || undefined,
                icon: token.icon || undefined,
                iconUrl: token.iconUrl || undefined,
                website: token.website || undefined,
                tokenType: token.transferType || undefined,
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

    public async listNameTagInfo(idHexMap) {
        // filter by tld
        const {
            app: { config },
        } = this;
        if(config?.tldOpenapi === 'net') {
            return {total: 0, map: {}};
        }

        // init caution labels
        if(!this.cautionSet.size || (Date.now() - this.cautionLoadTimestamp >= this.CAUTION_FLUSH_INTERVAL)) {
            const cautionLabels = await KV.getString(KEY_CAUTION_LABELS, '');
            cautionLabels.split(',').forEach(label => this.cautionSet.add(label));
            this.cautionLoadTimestamp = Date.now();
        }

        // query name tag
        const base32Array = Object.values(idHexMap).map(item => format.address(item, StatApp.networkId));
        const nameTagArray = await NameTag.findAll({
            attributes: ['base32', 'nameTag', 'website', 'desc', 'labels'],
            where: {base32: {[Op.in]: [...base32Array]}}, raw: true
        });

        // build map
        const map = {};
        nameTagArray.forEach(item => {
            const nameTag = lodash.pick(item, ['nameTag', 'website', 'desc', 'labels']);
            if(nameTag?.labels) {
                nameTag.labels = nameTag.labels.split(NAME_TAG_SPLIT);
                const caution = nameTag.labels.find(label => this.cautionSet.has(label));
                nameTag.labels = caution ? [caution] : nameTag.labels;
                nameTag.caution = caution ? 1 : 0;
            }
            map[item.base32] = {nameTag};
        });

        return {total: Object.keys(map).length, map};
    }

    public async listBytes32NameTagInfo(hex64Array) {
        const hex64List = [...hex64Array].filter(Boolean).map(hex => hex.startsWith('0x') ? hex.substr(2) : hex)
        if (!hex64List?.length) {
            return {total: 0, map: {}}
        }

        // query name tag
        const nameTagArray = await NameTag.findAll({
            attributes: ['base32', 'nameTag', 'website', 'desc'],
            where: {base32: {[Op.in]: hex64List}}, raw: true
        });

        // build map
        const map = {};
        nameTagArray.forEach(item => {
            map[`0x${item.base32}`] = {byte32NameTag: lodash.pick(item, ['nameTag', 'website', 'desc'])}
        });

        return {total: Object.keys(map).length, map};
    }

    public async getBasicInfo(addr) {
        const addrId = await getAddrId(addr);
        if(!addrId) {
           return {
                cfxTransferTab: 0,
                erc20TransferTab: 0,
                erc721TransferTab: 0,
                erc1155TransferTab: 0,
                nftAssetTab: 0,
                minedBlockTab: 0,
            };
        }

        const tabMap = {
            cfxTransferTab: {model: AddressCfxTransfer, addressIdFieldName: 'addressId'},
            erc20TransferTab: {model: AddressErc20Transfer, addressIdFieldName: 'addressId'},
            erc721TransferTab: {model: AddressErc721Transfer, addressIdFieldName: 'addressId'},
            erc1155TransferTab: {model: AddressErc1155Transfer, addressIdFieldName: 'addressId'},
            nftAssetTab: {model: NftMint, addressIdFieldName: 'toId'},
            nftAssetTab2: {model: Erc1155Data, addressIdFieldName: 'addressId'},
            minedBlockTab: {model: FullMinerBlock, addressIdFieldName: 'minerId'},
        } as any;

        await Promise.all(Object.keys(tabMap).map((tabType)=>{
            const {model, addressIdFieldName} = tabMap[tabType];
            return model.findOne({where: {[addressIdFieldName]: addrId}}).then(record=>{
                tabMap[tabType] = record ? 1 : 0;
            });
        }))
        tabMap.nftAssetTab = tabMap.nftAssetTab || tabMap.nftAssetTab2;
        delete tabMap.nftAssetTab2;

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

    public async getCollateralForStorageInfo(addr) {
        const {
            app: { cfx },
        } = this;

        if(StatApp.isEVM) {
            return undefined;
        }

        const accountInfo = await cfx.getAccount(addr);
        const sponsorInfo = await cfx.getSponsorInfo(addr);

        const usedStoragePoints = BigFixed(sponsorInfo.usedStoragePoints??0);
        const usedStoragePointsInCFX = usedStoragePoints.div(BigFixed(1024)).mul(BigFixed(1e18));
        const usedRefundableInCFX = BigFixed(accountInfo.collateralForStorage).sub(BigFixed(usedStoragePointsInCFX));

        const totalStoragePoints = BigFixed(sponsorInfo.availableStoragePoints??0).add(BigFixed(sponsorInfo.usedStoragePoints??0));
        const totalRefundableInCFX = BigFixed(sponsorInfo.sponsorBalanceForCollateral).add(usedRefundableInCFX);

        const availStoragePoints = BigFixed(sponsorInfo.availableStoragePoints??0);
        const availRefundableInCFX = BigFixed(sponsorInfo.sponsorBalanceForCollateral);

        return {
            storageUsed: {
                storagePoint: usedStoragePoints, // in points
                storageCollateral: usedRefundableInCFX, // in drip
            },
            storageQuota: {
                storagePoint: availStoragePoints, // in points
                storageCollateral: availRefundableInCFX, // in drip
            }
        };
    }
}
