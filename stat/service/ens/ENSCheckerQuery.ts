import {ethers} from "ethers";
import {Conflux, format} from "js-conflux-sdk";
import {gql, GraphQLClient} from "graphql-request";
import { AbortController } from "node-abort-controller";
import { formatsByCoinType } from '@web3identity/address-encoder';
import {fmtAddr, StatApp} from "../../StatApp";
import {abi as abiENSChecker} from "../abi/ENSChecker";
import {abi as abiENS} from "../abi/ENS";
import {abi as abiReverseRegistrar} from "../abi/ReverseRegistrar";
import {abi as abiBaseRegistrar} from "../abi/BaseRegistrar";
import {abi as abiResolver} from "../abi/Resolver";
import {abi as abiReverseRecords} from "../abi/ReverseRecords";
import {CONST} from "../common/constant";

const lodash = require('lodash');
const CFX_COIN_TYPE = 503;

export class ENSCheckerQuery {
    protected cfx;
    protected config: ENSOptions;

    protected ensChecker;
    protected ens;
    protected reverseRegistrar;
    protected baseRegistrar;
    protected reverseRecords;
    protected graphql;

    public constructor(cfx: Conflux) {
        const config: ENSOptions | undefined = CONST.ENS[StatApp.networkId];
        if (!config) {
            console.log("ENS service disabled!");
            return;
        }

        if (
            !config.ensChecker ||
            !config.ens ||
            !config.reverseRegistrar ||
            !config.baseRegistrar ||
            !config.reverseRecords ||
            !config.ensSubGraphUrl
        ) {
            throw new Error(`
            ENS service configurations (ensChecker/ens/reverseRegistrar/baseRegistrar/reverseRecords/ensSubGraphUrl) 
            should be provided!
            `);
        }

        this.cfx = cfx;
        this.config = config;

        this.ensChecker = this.cfx.Contract({abi: abiENSChecker, address: config.ensChecker});
        this.ens = this.cfx.Contract({abi: abiENS, address: config.ens});
        this.reverseRegistrar = this.cfx.Contract({abi: abiReverseRegistrar, address: config.reverseRegistrar});
        this.baseRegistrar = this.cfx.Contract({abi: abiBaseRegistrar, address: config.baseRegistrar});
        this.reverseRecords = this.cfx.Contract({abi: abiReverseRecords, address: config.reverseRecords});
        this.graphql = new GraphQLClient(config.ensSubGraphUrl);
    }

    public async addr(name: string) {
        return this.ensChecker.getAddrOfName(this.config.ens, this.config.reverseRegistrar, name);
    }

    public async name(addr: string) {
        return this.ensChecker.getReverseNameByAddress(this.config.ens, this.config.reverseRegistrar, addr);
    }

    public async nameBatch(addresses: string[]) {
        if (!this.config) {
            return {};
        }

        if (!addresses?.length) {
            return {}
        }

        const hexes = [...new Set(addresses.filter(item => item?.trim()).map(item => format.hexAddress(item)))];

        const names = await this.reverseRecords.getNames(hexes).catch(err => {
            console.log(`List ENS names error, ens ${this.config.ens} reverse ${this.config.reverseRegistrar}`, err);
            this.config = undefined;
            return {};
        });

        return Object.fromEntries(hexes
            .map((hex, index) => names[index] ? [hex, {name: names[index]}] : undefined)
            .filter(Boolean)
        );
    }

    public async resolveName(name) {
        const nameHash = ethers.namehash(name);
        const label = this.extractLabelFromName(name);
        const labelHash = ethers.keccak256(ethers.toUtf8Bytes(label));
        const tokenId = format.bigInt(labelHash);

        const [resolverAddr, owner, expiresDate, registrant] = await Promise.all([
            this.ens.resolver(nameHash),
            this.ens.owner(nameHash),
            this.baseRegistrar.nameExpires(tokenId),
            this.baseRegistrar.ownerOf(tokenId),
        ]);

        const resolver = this.cfx.Contract({
            abi: abiResolver,
            address: resolverAddr,
        });
        const coinTypeInstance = formatsByCoinType[CFX_COIN_TYPE]
        const net1029AddressBytes = await resolver.addr(nameHash, coinTypeInstance.coinType);
        const net1029Address = coinTypeInstance.encoder(net1029AddressBytes);
        const resolvedAddress = fmtAddr(format.hexAddress(net1029Address), StatApp.networkId);

        return {
            resolvedAddress,
            expiresDate,
            registrant,
            controller: owner,
            dnsOwner: owner,
            tokenId: format.bigInt(nameHash),
        };
    }

    public async lookupAddress(address) {
        const result = {};

        const nameHash = await this.reverseRegistrar.node(address);
        const resolver = await this.ens.resolver(nameHash);
        const contractResolver = this.cfx.Contract({
            abi: abiResolver,
            address: resolver,
        });
        const reverseRecord = await contractResolver.name(nameHash);
        if (!reverseRecord) {
            return result;
        }

        const label = this.extractLabelFromName(reverseRecord);
        if (!label) {
            lodash.assign(result, {reverseRecord})
            return result;
        }

        const labelHash = ethers.keccak256(ethers.toUtf8Bytes(label));
        const tokenId = format.bigInt(labelHash);
        const registrant = await this.baseRegistrar.ownerOf(tokenId);
        lodash.assign(result, {reverseRecord, registrant})
        return result;
    }

    public async getNameRegistrations(skip = 0, limit = 10) {
        const query = gql`
            query EthereumNameRegistrations($skip: Int, $limit: Int) {
                registrations(skip: $skip, first: $limit, orderBy: registrationDate, orderDirection: desc) {
                  registrant {
                    id
                  }
                  registrationDate
                  domain {
                    name
                  }
                  expiryDate
                }
            }`

        let data = await this.requestWithAbort(query, {skip, limit});
        return data?.registrations?.map(item => ({
            registrant: item.registrant.id,
            registrationDate: item.registrationDate,
            name: item.domain.name,
            expiryDate: item.expiryDate,
        })) || [];
    }

    public async getOwnedNames(address) {
        const query = gql`
            query OwnedEthereumNames($addr: String!) {
                account(id: $addr) {
                    registrations(first: 10, orderBy: expiryDate, orderDirection: asc) {
                      labelName
                      expiryDate
                    }
                }
            }`;
        return this.requestWithAbort(query, {addr: format.hexAddress(address)});
    }

    public async getResolvedNames(address) {
        const query = gql`
            query Forward_Resolved_Names($addr: String!) {
                account(id: $addr) {
                    domains(first: 10, orderBy: createdAt, orderDirection: desc) {
                      name
                      createdAt
                    }
                }
            }`
        return this.requestWithAbort(query, {addr: format.hexAddress(address)});
    }

    private async requestWithAbort(query, variables) {
        let timer;
        try{
            const controller = new AbortController();
            timer = setTimeout(() => {
                console.log(`requestWithAbort variables ${JSON.stringify(variables)}`);
                controller.abort();
            }, 3_000);
            return this.graphql.request({ document: query, variables, signal: controller.signal });
        } finally {
            timer && clearTimeout(timer);
        }
    }

    private extractLabelFromName(name) {
        const index = name.lastIndexOf('.');
        return index >= 0 ? name.substr(0, index) : name;
    }
}

interface ENSOptions {
    ens: string;
    reverseRegistrar: string;
    baseRegistrar: string;
    ensChecker: string;
    reverseRecords: string;
    ensSubGraphUrl: string;
}
