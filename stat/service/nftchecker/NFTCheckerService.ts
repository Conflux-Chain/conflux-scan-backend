import { NFTMap } from './NFTInfo';
const abi = require('../abi/ScanUtilitiesProxy.json');

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

    public async getNFTBalances( ownerAddress: string, nftContractAddresses: string[] ){
        try {
            return this.contract.getBalances( ownerAddress, nftContractAddresses );
        } catch (e) {
            console.error(e);
            return null;
        }
    };

    public async getNFTTokens ( ownerAddress: string, tokenAddress: string | undefined, offset: number, limit: number ){
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
