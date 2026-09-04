import {DataTypes, Model, Sequelize} from "sequelize";

/**
 * Partner (a.k.a. `source_id`) chain metrics, for the Solutions Hub dashboard.
 *
 * `sourceId` is the same identity the Router/PC module attributes usage with,
 * carried by the `X-0G-Source-Id` request header. It is an opaque tag, not a
 * registered entity there, so the mapping from a partner to its on-chain
 * contracts only exists in `partner_contract` below.
 */

// The Router side has no documented length/charset constraint for the header
// value. 64 is our own cap; widen it if partners register longer ids.
export const LEN_SOURCE_ID = 64;

export interface IPartner {
    id?: number
    sourceId: string
    name: string
    createdAt?: Date
    updatedAt?: Date
}

export class Partner extends Model<IPartner> implements IPartner {
    id?: number;
    sourceId: string;
    name: string;

    static register(seq: Sequelize) {
        Partner.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            sourceId: {type: DataTypes.STRING(LEN_SOURCE_ID), allowNull: false},
            name: {type: DataTypes.STRING(128), allowNull: false, defaultValue: ''},
        }, {
            sequelize: seq,
            tableName: 'partner',
            timestamps: true,
            indexes: [{
                name: 'uk_sourceId', fields: ['sourceId'], unique: true,
            }]
        })
    }
}

export interface IPartnerContract {
    id?: number
    sourceId: string
    hex40id: number
    effectiveFrom: Date
    effectiveTo?: Date
    createdAt?: Date
    updatedAt?: Date
}

/**
 * A contract belongs to at most one partner at any point in time. Overlapping
 * windows for the same `hex40id` would double count in the daily aggregation,
 * so keep them disjoint when registering.
 */
export class PartnerContract extends Model<IPartnerContract> implements IPartnerContract {
    id?: number;
    sourceId: string;
    hex40id: number;
    effectiveFrom: Date;
    effectiveTo?: Date;

    static register(seq: Sequelize) {
        PartnerContract.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            sourceId: {type: DataTypes.STRING(LEN_SOURCE_ID), allowNull: false},
            // matches full_tx.toId, keep it unsigned so the join needs no cast
            hex40id: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            effectiveFrom: {type: DataTypes.DATE, allowNull: false, defaultValue: '1970-01-01 00:00:00'},
            effectiveTo: {type: DataTypes.DATE, allowNull: true},
        }, {
            sequelize: seq,
            tableName: 'partner_contract',
            timestamps: true,
            indexes: [{
                name: 'uk_source_contract', fields: ['sourceId', 'hex40id', 'effectiveFrom'], unique: true,
            }, {
                name: 'idx_hex40id', fields: ['hex40id'],
            }]
        })
    }
}

export interface IDailyPartnerStat {
    id?: number
    sourceId: string
    statTime: Date
    txSuccess: number
    txFailed: number
    gasFeeSum: string
    gasFeeFailed: string
    activeAddr: number
    nativeValue: string
    txSuccessCum: number
    gasFeeSumCum: string
    createdAt?: Date
    updatedAt?: Date
}

/**
 * `gasFeeSum` covers successful *and* failed transactions -- gas is paid either
 * way, which is what the PRD asks for ("gas fees paid on transactions touching
 * the partner's contracts"). `gasFeeFailed` is broken out so the other reading
 * is a subtraction rather than a re-run.
 *
 * Amounts are wei / neuron (1 0G = 1e18), same convention as the Router's
 * `cost` field. Serve them as integer strings, never as JS numbers.
 *
 * `activeAddr` is deduped *within* the day and therefore cannot be summed
 * across days -- use `daily_partner_addr` for any multi-day distinct count.
 */
export class DailyPartnerStat extends Model<IDailyPartnerStat> implements IDailyPartnerStat {
    id?: number;
    sourceId: string;
    statTime: Date;
    txSuccess: number;
    txFailed: number;
    gasFeeSum: string;
    gasFeeFailed: string;
    activeAddr: number;
    nativeValue: string;
    txSuccessCum: number;
    gasFeeSumCum: string;

    static register(seq: Sequelize) {
        DailyPartnerStat.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            sourceId: {type: DataTypes.STRING(LEN_SOURCE_ID), allowNull: false},
            statTime: {type: DataTypes.DATE, allowNull: false},
            txSuccess: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, defaultValue: 0},
            txFailed: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, defaultValue: 0},
            gasFeeSum: {type: DataTypes.DECIMAL(65, 0), allowNull: false, defaultValue: 0},
            gasFeeFailed: {type: DataTypes.DECIMAL(65, 0), allowNull: false, defaultValue: 0},
            activeAddr: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, defaultValue: 0},
            nativeValue: {type: DataTypes.DECIMAL(65, 0), allowNull: false, defaultValue: 0},
            txSuccessCum: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, defaultValue: 0},
            gasFeeSumCum: {type: DataTypes.DECIMAL(65, 0), allowNull: false, defaultValue: 0},
        }, {
            sequelize: seq,
            tableName: 'daily_partner_stat',
            timestamps: true,
            indexes: [{
                name: 'uk_source_statTime', fields: ['sourceId', 'statTime'], unique: true,
            }, {
                name: 'idx_statTime', fields: ['statTime'],
            }]
        })
    }
}

/** tokenId value standing in for the chain's native token, which has no contract */
export const NATIVE_TOKEN_ID = 0;

export interface IDailyPartnerTvl {
    id?: number
    sourceId: string
    statTime: Date
    asOf: Date
    tokenId: number
    amount: string
    decimals?: number
    symbol?: string
    priceUsd?: string
    valueUsdMicro?: string
    priceSource?: string
    createdAt?: Date
    updatedAt?: Date
}

/**
 * Daily TVL snapshot, one row per (partner, day, token).
 *
 * Forward-only. Balances live in current-state tables that are overwritten in
 * place, so a past day's holdings cannot be reconstructed -- every day this job
 * does not run is lost permanently. Never backfill this table: doing so would
 * stamp today's balances onto an earlier date.
 *
 * Quantity and price are stored separately, and `valueUsdMicro` is derived from
 * them rather than being the only record. That way, when a price source is
 * finally configured (no token on this chain has one today), history can be
 * re-valued instead of staying wrong forever.
 *
 * `amount` is always RAW/unscaled -- `decimals` says how to scale it. For the
 * native token that means neuron/wei with decimals = 18, the same unit as gas.
 */
export class DailyPartnerTvl extends Model<IDailyPartnerTvl> implements IDailyPartnerTvl {
    id?: number;
    sourceId: string;
    statTime: Date;
    asOf: Date;
    tokenId: number;
    amount: string;
    decimals?: number;
    symbol?: string;
    priceUsd?: string;
    valueUsdMicro?: string;
    priceSource?: string;

    static register(seq: Sequelize) {
        DailyPartnerTvl.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            sourceId: {type: DataTypes.STRING(LEN_SOURCE_ID), allowNull: false},
            // the UTC midnight this snapshot is attributed to
            statTime: {type: DataTypes.DATE, allowNull: false},
            // when the balances were actually read -- recorded honestly rather
            // than pretending the sample landed exactly on statTime
            asOf: {type: DataTypes.DATE, allowNull: false},
            tokenId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            // raw uint256 can need 78 digits, past what DECIMAL(65) holds
            amount: {type: DataTypes.STRING(78), allowNull: false, defaultValue: '0'},
            decimals: {type: DataTypes.INTEGER, allowNull: true},
            symbol: {type: DataTypes.STRING(64), allowNull: true},
            priceUsd: {type: DataTypes.DECIMAL(36, 18), allowNull: true},
            valueUsdMicro: {type: DataTypes.DECIMAL(65, 0), allowNull: true},
            priceSource: {type: DataTypes.STRING(32), allowNull: false, defaultValue: ''},
        }, {
            sequelize: seq,
            tableName: 'daily_partner_tvl',
            timestamps: true,
            indexes: [{
                name: 'uk_source_statTime_token', fields: ['sourceId', 'statTime', 'tokenId'], unique: true,
            }, {
                name: 'idx_statTime', fields: ['statTime'],
            }]
        })
    }
}

export interface IDailyPartnerAddr {
    id?: number
    sourceId: string
    statTime: Date
    addr: number
}

/**
 * Roster of addresses that successfully called a partner's contracts on a given
 * day. Only reason it exists: a distinct-address count over an arbitrary window
 * (the dashboard's "Addr 30d") cannot be derived from per-day counts.
 */
export class DailyPartnerAddr extends Model<IDailyPartnerAddr> implements IDailyPartnerAddr {
    id?: number;
    sourceId: string;
    statTime: Date;
    addr: number;

    static register(seq: Sequelize) {
        DailyPartnerAddr.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            sourceId: {type: DataTypes.STRING(LEN_SOURCE_ID), allowNull: false},
            statTime: {type: DataTypes.DATE, allowNull: false},
            addr: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
        }, {
            sequelize: seq,
            tableName: 'daily_partner_addr',
            timestamps: false,
            indexes: [{
                name: 'uk_source_statTime_addr', fields: ['sourceId', 'statTime', 'addr'], unique: true,
            }, {
                name: 'idx_statTime', fields: ['statTime'],
            }]
        })
    }
}

export interface IPartnerAudit {
    id?: number
    action: string
    sourceId: string
    actor: string
    rateKeyId: number
    detail: string
    ip: string
    createdAt?: Date
}

/**
 * Write-operation log for the partner registry.
 *
 * Attribution decides whose numbers a transaction lands in, so a change here
 * moves figures that are reported to partners. Self-service registration makes
 * that reachable by more than one operator, and this table is what makes an
 * unexpected number traceable back to who changed what.
 */
export class PartnerAudit extends Model<IPartnerAudit> implements IPartnerAudit {
    id?: number;
    action: string;
    sourceId: string;
    actor: string;
    rateKeyId: number;
    detail: string;
    ip: string;

    static register(seq: Sequelize) {
        PartnerAudit.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            action: {type: DataTypes.STRING(32), allowNull: false},
            sourceId: {type: DataTypes.STRING(LEN_SOURCE_ID), allowNull: false},
            // the key's remark, so the log stays readable without joining
            actor: {type: DataTypes.STRING(128), allowNull: false, defaultValue: ''},
            rateKeyId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            detail: {type: DataTypes.STRING(1024), allowNull: false, defaultValue: ''},
            ip: {type: DataTypes.STRING(64), allowNull: false, defaultValue: ''},
        }, {
            sequelize: seq,
            tableName: 'partner_audit',
            // created only, never updated
            timestamps: true,
            updatedAt: false,
            indexes: [{
                name: 'idx_sourceId_createdAt', fields: ['sourceId', {name: 'createdAt', order: 'DESC'}],
            }, {
                name: 'idx_createdAt', fields: [{name: 'createdAt', order: 'DESC'}],
            }]
        })
    }
}
