import {NFTMap} from "./NFTInfo";

const {abi} = require('../abi/ScanUtilitiesProxy');

export class NFTCheckerService {
    private scanUtilContractAddress = 'cfx:acef1ym9m16fc94x29h0800k0ugnaj91sjjbm60hfh';
    private app;
    private cfx;
    private readonly contract;

    constructor(app: any) {
        this.app = app;
        this.cfx = app.cfx;
        this.contract = this.cfx.Contract({abi, address: this.scanUtilContractAddress});
    }

    public async getNFTBalances(ownerAddress) {
        const nftContractAddresses = Object.values(NFTMap).map(nft => nft.address);
        const balances = await this._getNFTBalances(ownerAddress, nftContractAddresses);
        const nftBalances = Object.keys(NFTMap)
            .map((type, index) => ({
                type,
                address: NFTMap[type].address,
                name: NFTMap[type].name,
                balance: balances[index],
            }))
            .filter(n => n.balance > 0);
        return nftBalances;
    }

    public async getNFTTokens(ownerAddress: string, contractAddress: string, currentNFTType: string,
                              offset: number = 0, limit: number = 12) {
        const nftTokens = await this._getNFTTokens(
            ownerAddress,
            contractAddress || NFTMap[currentNFTType].address,
            offset,
            limit,
        );
        return nftTokens;
    }

    private async _getNFTBalances( ownerAddress: string, nftContractAddresses: string[] ){
        try {
            return this.contract.getBalances( ownerAddress, nftContractAddresses );
        } catch (e) {
            console.error(e);
            return null;
        }
    };

    public async _getNFTTokens ( ownerAddress: string, tokenAddress: string | undefined, offset: number, limit: number ){
        try {
            if (!tokenAddress) {
                return null;
            }
            console.info(`ownerAddress:${ownerAddress}, tokenAddress:${tokenAddress}, offset:${offset}, limit:${limit}`)
            return this.contract.getTokens( tokenAddress, ownerAddress, offset, limit );
        } catch (e) {
            console.error(e);
            return null;
        }
    };
}
