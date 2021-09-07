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
    getTableName() {
        return 'token_balance'
    }
    async destroy({where = {}, ...rest} = {}) {
        return TokenBalance.destroy({
            where: {contractId: this.contractId, ...where},
            // logging: console.log,
            ...rest,
        })
    }

    async findAll({where = {}, ...rest} = {}) {
        return TokenBalance.findAll({
            where: {contractId: this.contractId, ...where},
            ...rest,
        })
    }

    async upsert(bean, options) {
        return TokenBalance.upsert({
            contractId: this.contractId, ...bean
        }, options)
    }
}