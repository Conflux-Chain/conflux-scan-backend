import {Op} from "sequelize";
import {format} from "js-conflux-sdk";
import {fmtAddr, StatApp} from "../StatApp";
import {TraceCreateContract} from "../model/TraceCreateContract";
import {
    ESpaceHex40Map,
    Hex40Map,
    POCKET_ADDRESS_MAP,
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
import {AuthAction} from "../model/EIP7702model";
import {TokenQuery} from "./TokenQuery";
import {ContractQuery} from "./ContractQuery";
import {CONST} from "./common/constant";

const lodash = require('lodash');
const BigFixed = require('bigfixed');

let _accountQuery: AccountQuery = null;
export function getAccountQuery() {
    return _accountQuery;
}

export class AccountQuery {
    public cautionLabels: Set<string> = new Set<string>();

    private app: any;
    private CAUTION_LABEL_FLUSH_INTERVAL = 180_000; // 3 min
    private cautionLabelLoadTimestamp;

    constructor(app: any) {
        this.app = app;
        _accountQuery = this;
    }

    async list(
        addresses: string[],
        options: {
            withContractInfo?: boolean,
            withESpaceInfo?: boolean,
            withENSInfo?: boolean,
            withNameTagInfo?: boolean
            withByte32NameTagInfo?: boolean
        } = {
            withContractInfo: true,
            withESpaceInfo: true,
            withENSInfo: true,
            withNameTagInfo: true,
            withByte32NameTagInfo: true,
    }) {
        const [addresses1, addresses2] = lodash.partition(
            [...new Set(addresses.filter(item => item.trim()))],
            (item: string) => ethers.utils.isHexString(item) && item.length === 66,
        );

        const map = await this._list(addresses2, options);

        if (options.withByte32NameTagInfo) {
            const nameTags = await this._listBytes32NameTagInfos(addresses1);
            Object.keys(nameTags).forEach(item => {
                map[item] = {nameTag: nameTags[item]};
            });
        }

        return map;
    }

    async getTabSwitches(address: string) {
        const addressInfo = await Hex40Map.findOne({
            where: {hex: format.hexAddress(address).substr(2)},
            raw: true,
        });

        if (!addressInfo) {
            return {
                cfxTransferTab: 0,
                erc20TransferTab: 0,
                erc721TransferTab: 0,
                erc1155TransferTab: 0,
                nftAssetTab: 0,
                minedBlockTab: 0,
                authorizationsTab: 0,
            };
        }

        const tabSwitches = {
            cfxTransferTab: {model: AddressCfxTransfer, field: 'addressId'},
            erc20TransferTab: {model: AddressErc20Transfer, field: 'addressId'},
            erc721TransferTab: {model: AddressErc721Transfer, field: 'addressId'},
            erc1155TransferTab: {model: AddressErc1155Transfer, field: 'addressId'},
            nftAssetTab: {model: NftMint, field: 'toId'},
            nftAssetTab2: {model: Erc1155Data, field: 'addressId'},
            minedBlockTab: {model: FullMinerBlock, field: 'minerId'},
            authorizationsTab: {model: AuthAction, field: 'author', value: `0x${addressInfo.hex}`},
        } as any;

        await Promise.all(Object.keys(tabSwitches).map((tab) => {
            const {model, field, value} = tabSwitches[tab];
            return model.findOne({
                where: {[field]: value || addressInfo.id},
            }).then((record: any) => {
                tabSwitches[tab] = record ? 1 : 0;
            });
        }));

        tabSwitches.nftAssetTab = tabSwitches.nftAssetTab || tabSwitches.nftAssetTab2;
        delete tabSwitches.nftAssetTab2;

        return tabSwitches;
    }

    async getStorageCollaterals(address: string) {
        if (StatApp.isEVM) {
            return;
        }

        const accountInfo = await this.app.cfx.getAccount(address);
        const sponsorInfo = await this.app.cfx.getSponsorInfo(address);

        const usedStoragePoints = BigFixed(sponsorInfo.usedStoragePoints ?? 0);
        const usedStoragePointsInCFX = usedStoragePoints.div(BigFixed(1024)).mul(BigFixed(1e18));
        const usedRefundableInCFX = BigFixed(accountInfo.collateralForStorage).sub(BigFixed(usedStoragePointsInCFX));

        const availStoragePoints = BigFixed(sponsorInfo.availableStoragePoints ?? 0);
        const availRefundableInCFX = BigFixed(sponsorInfo.sponsorBalanceForCollateral);

        return {
            storageUsed: {
                storagePoint: usedStoragePoints, // in points
                storageCollateral: usedRefundableInCFX, // in drip
            },
            storageQuota: {
                storagePoint: availStoragePoints, // in points
                storageCollateral: availRefundableInCFX, // in drip
            },
        };
    }

    private async _list(
        addresses: string[],
        options: {
            withContractInfo?: boolean,
            withESpaceInfo?: boolean,
            withENSInfo?: boolean,
            withNameTagInfo?: boolean
        } = {
            withContractInfo: true,
            withESpaceInfo: true,
            withENSInfo: true,
            withNameTagInfo: true,
        }) {
        const hexes: string[] = addresses.map(format.hexAddress);

        if (!hexes.length) {
            return {};
        }

        const mapIdToHex = await Hex40Map.findAll({
            where: {hex: {[Op.in]: hexes.map(item => item.substr(2))}},
        }).then(list => Object.fromEntries(
            list.map(item => [
                item.id,
                `0x${item.hex}`
            ])
        ));

        if (!Object.keys(mapIdToHex).length) {
            return {};
        }

        const [{contracts, tokens, verifies, impls}, evmSpaceInfos, ensInfos, nameTagInfos] = await Promise.all([
            options.withContractInfo ? this._listContractInfos(mapIdToHex) :
                {contracts: {}, tokens: {}, verifies: {}, impls: {}},
            options.withESpaceInfo ? this._listEVMSpaceInfos(mapIdToHex) : {},
            options.withENSInfo ? this._listENSInfos(mapIdToHex) : {},
            options.withNameTagInfo ? this._listNameTagInfos(mapIdToHex) : {},
        ]);

        const map = Object.fromEntries(Object.values(mapIdToHex).map(hex => [
            StatApp.isEVM ? ethers.utils.getAddress(hex) : format.address(hex, StatApp.networkId),
            lodash.omitBy({
                contract: contracts[hex],
                token: tokens[hex],
                verification: verifies[hex],
                eSpace: evmSpaceInfos[hex] ? {address: ethers.utils.getAddress(hex)} : undefined,
                ens: ensInfos[hex],
                nameTag: nameTagInfos[hex],
                implementation: impls[hex],
            }, lodash.isNil)
        ]));

        return lodash.omitBy(map, lodash.isEmpty);
    }

    // contracts:  hex => {name}
    // verifies: hex => boolean
    // tokens: hex => token
    private async _listContractInfos(mapIdToHex: {[id: number]: string}) {
        const {
            app: {tokenQuery, contractQuery, service},
        } = this;

        const addresses = await TraceCreateContract.findAll({
            where: {to: {[Op.in]: Object.keys(mapIdToHex)}}
        }).then(list => list.map(item => mapIdToHex[item.to]));

        const contractSrv: ContractQuery = contractQuery || service.contractQuery;
        const tokenSrv: TokenQuery = tokenQuery || service.tokenQuery;

        const impls = lodash.zipObject(addresses, await Promise.all(addresses.map(item => contractSrv.getImpl(item))));
        addresses.push(...Object.values(impls).filter(Boolean).map((item: any) => item.implementation));

        const fieldMapper = (item: any) => [format.hexAddress(item.address), {name: item.name}];

        const [contracts, verifies, tokens] = await Promise.all([
            contractSrv.list(addresses).then( // hex => {name}
                list => Object.fromEntries(list.filter((item: any) => item.name?.trim()).map(fieldMapper))
            ),
            contractSrv.listVerifyInBatch(addresses).then( // hex => {name}
                list => Object.fromEntries(list.map(fieldMapper))
            ),
            tokenSrv.list({addresses}).then( // hex => token
                page => Object.fromEntries(page.list.map(item => [
                    format.hexAddress(item.address),
                    lodash.omitBy({
                            ...lodash.pick(item, ['name', 'symbol', 'decimals', 'iconUrl', 'website']),
                            tokenType: item.transferType,
                        },
                        lodash.isNil,
                    )
                ]))
            ),
        ]);

        for (const address of Object.values(mapIdToHex)) {
            const internal = CONST.INTERNAL_ADDR_CONTRACT_MAP[address];
            if (internal) {
                contracts[address] = {name: internal.name};
                verifies[address] = {name: internal.name};
            }
        }

        Object.entries(impls).forEach(([item, impl]: [string, any]) => { // hex => {name, address, proxyPattern}
            const verify = impl && verifies[format.hexAddress(impl.implementation)];
            impls[item] = verify ? {
                name: verify.name,
                address: fmtAddr(impl.implementation, StatApp.networkId),
                proxyPattern: impl.proxyPattern,
            } : undefined;
        });

        return {contracts, tokens, verifies, impls};
    }

    // hex => boolean
    private async _listEVMSpaceInfos(mapIdToHex: {[id: number]: string}) {
        const list = await ESpaceHex40Map.findAll({
            where: {hex: {[Op.in]: Object.values(mapIdToHex).map(hex => hex.substr(2))}},
        });

        return Object.fromEntries(
            list.map(item => [`0x${item.hex}`, true])
        );
    }

    // hex => {name}
    private async _listENSInfos(mapIdToHex: {[id: number]: string}) {
        const {
            app: {ensCheckerQuery, service},
        } = this;

        return (ensCheckerQuery || service.ensCheckerQuery).nameBatch(Object.values(mapIdToHex));
    }

    // hex => {nameTag, website, desc, labels, caution}
    private async _listNameTagInfos(mapIdToHex: {[id: number]: string}) {
        await this._refreshCautionLabelsIfNeeded();

        const list = await NameTag.findAll({where: {hex40id: {[Op.in]: Object.keys(mapIdToHex)}}, raw: true});

        return Object.fromEntries(
            list.map(item => {
                const nameTag = lodash.omitBy(lodash.pick(item, ['nameTag', 'website', 'desc', 'labels']), lodash.isNil);

                if (nameTag?.labels) {
                    const labels: string[] = nameTag.labels.split(NAME_TAG_SPLIT);
                    const caution = labels.find(label => this.cautionLabels.has(label));

                    nameTag.labels = caution ? [caution] : labels;
                    nameTag.caution = caution ? 1 : 0;
                }

                return [mapIdToHex[item.hex40id], nameTag];
            })
        );
    }

    // hex => {nameTag, website, desc}
    private async _listBytes32NameTagInfos(hexes: string[]) {
        if (!hexes?.length) {
            return {};
        }

        const list = await NameTag.findAll({
            where: {base32: {[Op.in]: hexes.map(hex => hex.substr(2))}}, raw: true
        });

        return Object.fromEntries(
            list.map(item => [
                `0x${item.base32}`,
                lodash.omitBy(lodash.pick(item, ['nameTag', 'website', 'desc']), lodash.isNil),
            ])
        );
    }

    private async _refreshCautionLabelsIfNeeded() {
        if (!this.cautionLabels.size ||
            (Date.now() - this.cautionLabelLoadTimestamp >= this.CAUTION_LABEL_FLUSH_INTERVAL)) {
            this.cautionLabels = new Set((await KV.getString(KEY_CAUTION_LABELS, '')).split(',').filter(Boolean));
            this.cautionLabelLoadTimestamp = Date.now();
        }
    }

    public async listPatchInfo(
        addresses: string[],
        options: {
            withContractInfo?: boolean,
            withEVMSpaceInfo?: boolean,
            withENSInfo?: boolean,
            withNameTagInfo?: boolean
        } = {
            withContractInfo: true,
            withEVMSpaceInfo: true,
            withENSInfo: true,
            withNameTagInfo: true
        }) {
        const accounts = await this.list(addresses, options);

        let map = Object.fromEntries(Object.entries(accounts).map(([address, info]: [string, any]) => [
            address,
            {
                contract: {
                    name: info.contract?.name,
                    isVirtual: POCKET_ADDRESS_MAP[info.contract?.name] == format.hexAddress(address),
                    verify: {
                        result: info.verification?.name ? 1 : 0,
                    }
                },
                token: info.token,
                eSpace: info.eSpace,
                ens: info.ens,
                nameTag: info.nameTag,
            },
        ]));

        map = lodash.omitBy(map, lodash.isEmpty);

        return { total: Object.keys(map).length, map };
    }

    public async patchAddressInfo(list: any[], fromKey: string, toKey: string) {
        let addressArray = [];
        list.forEach((tx) => {
            tx[fromKey] && addressArray.push(tx[fromKey].toString());
            tx[toKey] && (addressArray.push(tx[toKey].toString()));
        });
        const accountQuery = this;
        const accountBasic = await accountQuery.listPatchInfo(addressArray);
        list.forEach((tx) => {
            tx.fromENSInfo = accountBasic.map[tx[fromKey]]?.ens;
            tx.fromNameTagInfo = accountBasic.map[tx[fromKey]]?.nameTag;
            const info = accountBasic.map[tx[toKey]];
            if (info) {
                tx.toContractInfo = info.contract;
                tx.toTokenInfo = info.token;
                tx.toENSInfo = info.ens;
                tx.toNameTagInfo = info.nameTag;
            }
        });
    }
}
