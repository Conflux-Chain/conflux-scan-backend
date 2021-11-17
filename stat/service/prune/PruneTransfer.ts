import {PruneBase} from "./PruneBase";
import {StatApp} from "../../StatApp";
import {PruneType} from "../../model/PruneInfo";
import {AddressCfxTransfer, CfxTransfer} from "../../model/CfxTransfer";
import {AddressErc20Transfer, Erc20Transfer} from "../../model/Erc20Transfer";
import {AddressErc721Transfer, Erc721Transfer} from "../../model/Erc721Transfer";
import {AddressErc1155Transfer, Erc1155Transfer} from "../../model/Erc1155Transfer";

export class PruneTransfer extends PruneBase {
    protected app: StatApp;

    constructor(app: StatApp) {
        super(app);
        this.app = app;
    }

    public getModel(type): any{
        let model;
        switch (type) {
            case PruneType.CFX_TRANSFER:
                model = CfxTransfer;
                break;
            case PruneType.ADDR_CFX_TRANSFER:
                model = AddressCfxTransfer;
                break;
            case PruneType.ERC20_TRANSFER:
                model = Erc20Transfer;
                break;
            case PruneType.ADDR_ERC20_TRANSFER:
                model = AddressErc20Transfer;
                break;
            case PruneType.ERC721_TRANSFER:
                model = Erc721Transfer;
                break;
            case PruneType.ADDR_ERC721_TRANSFER:
                model = AddressErc721Transfer;
                break;
            case PruneType.ERC1155_TRANSFER:
                model = Erc1155Transfer;
                break;
            case PruneType.ADDR_ERC1155_TRANSFER:
                model = AddressErc1155Transfer;
                break;
            default:
                throw new Error(`unknown prune type:${type}`);
        }
        return model;
    }

    public buildBaseQuery({type, pruneParas}): { where: any; key: any } {
        const {addressId, contractId} = pruneParas;
        if (this.TYPE_TOKEN_TRANSFER.has(type)) {
            return {where: {contractId}, key: {id: contractId, type}};
        }
        if (this.TYPE_ADDR_TOKEN_TRANSFER.has(type) || PruneType.ADDR_CFX_TRANSFER === type) {
            return {where: {addressId}, key: {id: addressId, type}};
        }
        return {where: undefined, key: {id: 0, type}};
    }
}