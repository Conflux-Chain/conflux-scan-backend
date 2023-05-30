import {ethers} from "ethers";
import {format} from "js-conflux-sdk";
import {gql, GraphQLClient} from "graphql-request";
import { AbortController } from "node-abort-controller";
import { formatsByCoinType } from '@web3identity/address-encoder';
import {StatApp} from "../../StatApp";
import {abi as abiENSChecker} from "../abi/ENSChecker";
import {abi as abiENS} from "../abi/ENS";
import {abi as abiReverseRegistrar} from "../abi/ReverseRegistrar";
import {abi as abiBaseRegistrar} from "../abi/BaseRegistrar";
import {abi as abiResolver} from "../abi/Resolver";
import {abi as abiReverseRecords} from "../abi/ReverseRecords";
const lodash = require('lodash');
const CFX_COIN_TYPE = 503;

export class ENSCheckerQuery {
    protected cfx;
    protected ensEnable;
    protected ensCheckerAddr;
    protected ensAddr;
    protected reverseRegistrarAddr;
    protected baseRegistrarAddr;
    protected reverseRecordsAddr;
    protected ensSubGraphUrl;

    protected ensChecker;
    protected ens;
    protected reverseRegistrar;
    protected baseRegistrar;
    protected reverseRecords;
    protected graphql;

    public constructor(app) {
        this.cfx = app.cfx;
        this.ensEnable = app.config.ensEnable;
        this.ensCheckerAddr = app.config.ensChecker;
        this.ensAddr = app.config.ens;
        this.reverseRegistrarAddr = app.config.reverseRegistrar;
        this.baseRegistrarAddr = app.config.baseRegistrar;
        this.reverseRecordsAddr = app.config.reverseRecords;
        this.ensSubGraphUrl = app.config.ensSubGraphUrl;

        this.ensChecker = this.cfx.Contract({abi: abiENSChecker, address: this.ensCheckerAddr});
        this.ens = this.cfx.Contract({abi: abiENS, address: this.ensAddr});
        this.reverseRegistrar = this.cfx.Contract({abi: abiReverseRegistrar, address: this.reverseRegistrarAddr});
        this.baseRegistrar = this.cfx.Contract({abi: abiBaseRegistrar, address: this.baseRegistrarAddr});
        this.reverseRecords = this.cfx.Contract({abi: abiReverseRecords, address: this.reverseRecordsAddr});
        this.graphql = new GraphQLClient(this.ensSubGraphUrl);
    }

    public async addr(name: string) {
        return this.ensChecker.getAddrOfName(this.ensAddr, this.reverseRegistrarAddr, name);
    }

    public async name(addr: string) {
        return this.ensChecker.getReverseNameByAddress(this.ensAddr, this.reverseRegistrarAddr, addr);
    }

    public async nameBatch(addressArray: string[]) {
        const result = {};
        if(!this.ensEnable) {
            return result;
        }

        const base32Array = [...new Set(addressArray.filter(Boolean).map(a => format.address(a, StatApp.networkId)))];
        /*const nameArray = await this.ensChecker.matchNames(this.ensAddr, this.reverseRegistrarAddr, base32Array)*/
        const nameArray = await this.reverseRecords.getNames(base32Array)
            .catch(e => {
                console.log(`nameBatch ens ${this.ensAddr} reverse ${this.reverseRegistrar} error`, e);
                return result;
            });

        for (let i = 0; i < base32Array.length; i++) {
            result[base32Array[i]] = {name: nameArray[i] || ''};
        }

        return result;
    }

    public async resolveName(name) {
        const nameHash = ethers.utils.namehash(name);
        const label = this.extractLabelFromName(name);
        const labelHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(label));
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
        const resolvedAddress = format.address(format.hexAddress(net1029Address), StatApp.networkId);

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

        const labelHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(label));
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
        const data = await this.requestWithAbort(query, {addr: format.hexAddress(address)});
        return data;
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
        const data = await this.requestWithAbort(query, {addr: format.hexAddress(address)});
        return data;
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
