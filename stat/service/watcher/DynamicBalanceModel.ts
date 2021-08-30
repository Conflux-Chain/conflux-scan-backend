import {TokenBalance} from "../../model/Balance";

/**
 * Since we use one table to save all balance of an address in each token,
 * We use this class to perform actions of an BalanceModel.
 */
export class DynamicBalanceModel {
    private readonly contractId: number;
    constructor(contractId:number) {
        this.contractId = contractId
    }
    async count() {
        return TokenBalance.count({
            where: {contractId: this.contractId}
        })
    }

    async destroy({where0 = {}, ...rest} = {}) {
        return TokenBalance.destroy({
            where: {contractId: this.contractId, ...where0},
            ...rest,
        })
    }

    async findAll({where0 = {}, ...rest} = {}) {
        return TokenBalance.findAll({
            where: {contractId: this.contractId, ...where0},
            ...rest,
        })
    }

    async upsert(bean, options) {
        return TokenBalance.upsert({
            contractId: this.contractId, ...bean
        }, options)
    }
}