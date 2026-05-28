import {Op} from "sequelize";
import {format} from "js-conflux-sdk";
import {fmtAddr, StatApp} from "../StatApp";
import {TraceCreateContract} from "../model/TraceCreateContract";
import {
    ESpaceHex40Map,
    getAddrIdArray,
    Hex40Map,
    idHex40Map,
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
import {formatBlockNumber, formatCallParams, sendRpc, splitFullyQualifiedName} from "./common/utils";
import {ContractImpl} from "../model/ContractImpl";
import {fillMethodInfo} from "./contract/contractTool";

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
            withNameTagInfo?: boolean,
            withByte32NameTagInfo?: boolean,
            withESpaceInfo?: boolean,
            withENSInfo?: boolean,
            withProxyImplInfo?: boolean,
            realtimeProxyImpl?: boolean,
        } = {
            withContractInfo: true,
            withNameTagInfo: true,
            withByte32NameTagInfo: true,
            withESpaceInfo: true,
            withENSInfo: true,
            withProxyImplInfo: false,
            realtimeProxyImpl: false,
    }) {
        const [addresses1, addresses2] = lodash.partition(
            [...new Set(addresses.filter(item => item?.trim()))],
            (item: string) => ethers.isHexString(item) && item.length === 66,
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
            withNameTagInfo?: boolean,
            withESpaceInfo?: boolean,
            withENSInfo?: boolean,
            withProxyImplInfo?: boolean,
            realtimeProxyImpl?: boolean,
        } = {
            withContractInfo: true,
            withNameTagInfo: true,
            withESpaceInfo: true,
            withENSInfo: true,
            withProxyImplInfo: false,
            realtimeProxyImpl: false,
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

        const [{contracts, tokens, verifies, impls}, nameTagInfos, evmSpaceInfos, ensInfos] = await Promise.all([
            options.withContractInfo ? this._listContractInfos(mapIdToHex, options.withProxyImplInfo,
                options.realtimeProxyImpl) : {contracts: {}, tokens: {}, verifies: {}, impls: {}},
            options.withNameTagInfo ? this._listNameTagInfos(mapIdToHex) : {},
            options.withESpaceInfo ? this._listEVMSpaceInfos(mapIdToHex) : {},
            options.withENSInfo ? this._listENSInfos(mapIdToHex) : {},
        ]);

        const map = Object.fromEntries(Object.values(mapIdToHex).map(hex => [
            StatApp.isEVM ? ethers.getAddress(hex) : format.address(hex, StatApp.networkId),
            lodash.omitBy({
                contract: contracts[hex],
                token: tokens[hex],
                verification: verifies[hex],
                eSpace: evmSpaceInfos[hex] ? {address: ethers.getAddress(hex)} : undefined,
                ens: ensInfos[hex],
                nameTag: nameTagInfos[hex],
                implementation: impls ? impls[hex] : undefined,
            }, lodash.isNil)
        ]));

        return lodash.omitBy(map, lodash.isEmpty);
    }

    // contracts:  hex => {name}
    // verifies: hex => {name}
    // tokens: hex => token
    private async _listContractInfos(
        mapIdToHex: { [id: number]: string },
        withProxyImplInfo: boolean = false,
        realtimeProxyImpl: boolean = false
    ) {
        const {
            app: {tokenQuery, contractQuery, service},
        } = this;

        const addresses = await TraceCreateContract.findAll({
            where: {to: {[Op.in]: Object.keys(mapIdToHex)}}
        }).then(list => list.map(item => mapIdToHex[item.to]));

        const contractSrv: ContractQuery = contractQuery || service.contractQuery;
        const tokenSrv: TokenQuery = tokenQuery || service.tokenQuery;

        let impls;
        if (withProxyImplInfo) {
            impls = realtimeProxyImpl ?
                lodash.zipObject(addresses, await Promise.all(addresses.map(item => contractSrv.getImpl(item)))) :
                await this._getContractImpl(mapIdToHex);
            addresses.push(...(lodash.flatten(Object.values(impls).filter(Boolean)
                .map((item: any) => [item.implementation, item.beacon].filter(Boolean)))));
        }

        const fieldMapper = (item: any) => [format.hexAddress(item.address), {name: item.name}];

        const [contracts, verifies, tokens] = await Promise.all([
            contractSrv.list(addresses).then( // hex => {name}
                list => {
                    const map = Object.fromEntries(list.filter((item: any) => item.name?.trim()).map(fieldMapper));
                    return Object.fromEntries(addresses.map(item => [item, map[item] || {}]));
                }
            ),
            contractSrv.listVerifyInBatch(addresses).then( // hex => {name}
                list => {
                    const map = Object.fromEntries(list.map(fieldMapper));
                    Object.keys(map).forEach((key) => {
                        const name = map[key]?.name;
                        if (typeof name === "string" && name.length) {
                            const fqn = splitFullyQualifiedName(name);
                            map[key].name = fqn.contractName;
                        }
                    });
                    return map;
                }
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
            const precompiled = CONST.PRECOMPILED_ADDR_CONTRACT_MAP[address];
            if (precompiled) {
                contracts[address] = {name: precompiled.name};
                verifies[address] = {name: precompiled.name};
            }
        }

        if (withProxyImplInfo) {
            Object.entries(impls).forEach(([item, impl]: [string, any]) => { // hex => {name, beacon, address, proxyPattern}
                const verify = impl && verifies[format.hexAddress(impl.implementation)];
                const beaconVerify = impl && impl.beacon && verifies[format.hexAddress(impl.beacon)];
                impls[item] = impl ? {
                    name: verify?.name,
                    address: fmtAddr(impl.implementation, StatApp.networkId),
                    beaconName: beaconVerify?.name,
                    beaconAddress: fmtAddr(impl.beacon, StatApp.networkId),
                    proxyPattern: impl.proxyPattern,
                } as any : undefined;
                lodash.omitBy(impls[item], lodash.isEmpty);
            });
        }

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

    private async _getContractImpl(mapIdToHex: { [id: number]: string }) {
        const impls = await ContractImpl.findAll({
            where: {cid: {[Op.in]: Object.keys(mapIdToHex)}},
        });
        if (!impls?.length) {
            return {};
        }

        const ids = new Set();
        impls.forEach(item => {
            ids.add(item.implId);
            if (item.beaconId) {
                ids.add(item.beaconId);
            }
        })
        const idArray = [...ids];
        const hexMap = await idHex40Map(idArray, true);

        return Object.fromEntries(impls.filter(item => item.implId > 0).map(item => [
            mapIdToHex[item.cid],
            {
                beacon: hexMap.get(item.beaconId),
                implementation: hexMap.get(item.implId),
                proxyPattern: item.proxyType,
            }
        ]));
    }

    /**
     * @deprecated Use {@link list()} instead.
     */
    public async listPatchInfo(
        addresses: string[],
        options: {
            withContractInfo?: boolean,
            withESpaceInfo?: boolean,
            withNameTagInfo?: boolean,
            withENSInfo?: boolean,
        } = {
            withContractInfo: true,
            withESpaceInfo: true,
            withNameTagInfo: true,
            withENSInfo: true,
        }) {
        const accounts = await this.list(addresses, options);

        let map = Object.fromEntries(Object.entries(accounts).map(([address, info]: [string, any]) => [
            address,
            lodash.omitBy({
                contract: info.contract ? {
                    address,
                    name: info.contract?.name,
                    isVirtual: POCKET_ADDRESS_MAP[info.contract?.name] == format.hexAddress(address),
                    verify: {
                        result: info.verification?.name ? 1 : 0,
                    }
                } : undefined,
                token: info.token ? {
                    address,
                    ...info.token,
                } : undefined,
                eSpace: info.eSpace,
                nameTag: info.nameTag,
                ens: info.ens,
            }, lodash.isNil),
        ]));

        return { total: Object.keys(map).length, map };
    }

    async debugTraceCall(params: any[], needFormat: boolean = false): Promise<any> {
        const len = params?.length || 0;
        if (len < 1) {
            throw new Error("Provide the first parameter at least. [callParams, blockNumber?, tracerOptions?].");
        }
        if (len > 3) {
            throw new Error("Accepts maximum 3 parameters. [callParams, blockNumber?, tracerOptions?].");
        }

        const [callParams, blockNumber, tracerOptions] = params;
        if (!Object.keys(callParams)?.length) {
            throw new Error("The first parameter is an empty object. [callParams, blockNumber?, tracerOptions?].");
        }

        const rpcParams: any[] = [needFormat ? formatCallParams(callParams) : callParams];
        if (blockNumber) {
            rpcParams.push(needFormat ? formatBlockNumber(blockNumber) : blockNumber)
        }
        if (tracerOptions) {
            rpcParams.push(tracerOptions)
        }

        const rpcResp = await sendRpc(this.app.eth, "debug_traceCall", rpcParams);

        const {addresses, methods} = this.extractTraceCall(rpcResp);
        const nameMap = await this.list(addresses, {
            withContractInfo: true,
            withNameTagInfo: true,
            withByte32NameTagInfo: true,
            withESpaceInfo: true,
            withENSInfo: true,
            realtimeProxyImpl: true,
        });
        const methodMap = {};
        if (methods?.length) {
            const ids = await getAddrIdArray(methods.map(item => item.to));
            await fillMethodInfo(methods, ids, true, true);
            methods.forEach(({to, method, methodId}) => {
                methodMap[methodId] ||= {};
                methodMap[methodId][fmtAddr(to, StatApp.networkId)] = method;
            });
        }
        rpcResp.nameMap = nameMap;
        rpcResp.methodMap = methodMap;

        return rpcResp;
    }

    private extractTraceCall(traceResponse: any) {
        const addressSet = new Set<string>();
        const methodMap = new Map<string, Set<string>>(); // methodId => set(address)

        function traverseCall(call: any): void {
            if (!call) {
                return;
            }

            const {from, to, input} = call;
            if (from) {
                addressSet.add(from);
            }
            if (to) {
                addressSet.add(to);
            }
            if (input) {
                if (input.length >= 10 && to) {
                    const methodId = input.substring(0, 10);
                    let set = methodMap.get(methodId);
                    if (!set) {
                        set = new Set<string>();
                        methodMap.set(methodId, set);
                    }
                    set.add(to);
                }
            }

            if (call.calls && Array.isArray(call.calls)) {
                for (const subCall of call.calls) {
                    traverseCall(subCall);
                }
            }
        }

        const topCall = traceResponse?.result ? traceResponse.result : traceResponse;
        const {structLogs, type} = topCall;
        if (structLogs) { // structLogs
            return {addresses: [], methods: []};
        } else if (type) { // callTracer
            traverseCall(topCall);
        } else { // prestateTracer
            Object.keys(topCall).forEach(address => addressSet.add(address));
        }

        const methods = lodash.flatten(
            [...methodMap.keys()].map(
                method => [...methodMap.get(method)].map(
                    to => ({method, to})
                )
            )
        );

        return {
            addresses: [...addressSet],
            methods,
        };
    }
}

export interface CallParams {
    /**
     * basic params
     */
    from?: string;
    to?: string;
    gas?: bigint | string | number;
    gasPrice?: bigint | string | number;
    nonce?: bigint | string | number;
    value?: bigint | string | number;
    data?: string;
    input?: string; // alias of data field
    chainId?: bigint | string | number;

    /**
     * tx type
     * 0 - Legacy
     * 1 - EIP-2930 (Access List)
     * 2 - EIP-1559 (Dynamic Fee)
     * 3 - EIP-4844 (Blob)
     * 4 - EIP-7702 (Set Code)
     */
    type?: number | string;

    /**
     * EIP-1559 params
     */
    maxPriorityFeePerGas?: bigint | string | number;
    maxFeePerGas?: bigint | string | number;

    /**
     * EIP-2930 params
     */
    accessList?: Array<{
        address: string;
        storageKeys: string[];
    }>;

    /**
     * EIP-7702 params
     */
    authorizationList?: Authorization[];
}

export interface Authorization {
    chainId: bigint | string | number;
    address: string;
    nonce: bigint | string | number;
    yParity: number;
    r: string;
    s: string;
}

export interface TracerOptions {
    tracer?: string; // tracer type: callTracer, prestateTracer, structLogs
    tracerConfig?: Record<string, any>; // tracer config details
}
