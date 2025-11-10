import {Model,Sequelize,DataTypes} from "sequelize";

export interface ITokenSecurityAudit{
    id?:number
    // basic info
    hex40id:number
    base32:string
    // common audit
    verify?:boolean
    audit?:boolean
    auditUrl?:string
    sponsor?:boolean
    zeroAdmin?:boolean
    // cex audit
    cexBinance?: string
    cexHuobi?: string
    cexOKEx?: string
    // dex audit
    dexMoonSwap?: string
    // track audit
    trackCoinMarketCap?: string
    // official mark
    officialLabels?: string
}

export class TokenSecurityAudit extends Model<ITokenSecurityAudit> implements ITokenSecurityAudit{
    id?:number
    // basic info
    hex40id:number
    base32:string
    // common audit
    verify?:boolean
    audit?:boolean
    auditUrl?:string
    sponsor?:boolean
    zeroAdmin?:boolean
    // cex audit
    cexBinance?: string
    cexHuobi?: string
    cexOKEx?: string
    // dex audit
    dexMoonSwap?: string
    // track audit
    trackCoinMarketCap?: string
    // official mark
    officialLabels?: string
    // insert into config values('KEY_OFFICIAL_LABELS', 'Verified');
    // alter table token_security_audit add column `officialLabels` char(255) DEFAULT NULL after `trackCoinMarketCap`;

    static register(seq:Sequelize) {
        TokenSecurityAudit.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            // basic info
            hex40id: {type: DataTypes.BIGINT, allowNull: false, unique: true },
            base32: {type: DataTypes.CHAR(64), allowNull: false, unique: true},
            // common audit
            verify: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            audit: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            auditUrl: {type: DataTypes.CHAR(255), allowNull: true, },
            sponsor: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            zeroAdmin: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            // cex audit
            cexBinance: {type: DataTypes.CHAR(255), allowNull: true, },
            cexHuobi: {type: DataTypes.CHAR(255), allowNull: true, },
            cexOKEx: {type: DataTypes.CHAR(255), allowNull: true, },
            // dex audit
            dexMoonSwap: {type: DataTypes.CHAR(255), allowNull: true, },
            // track audit
            trackCoinMarketCap: {type: DataTypes.CHAR(255), allowNull: true, },
            // official labels
            officialLabels: {type: DataTypes.CHAR(255), allowNull: true, },
        },{
            tableName: 'token_security_audit',
            sequelize: seq,
            timestamps: true,
        })
    }

    static async add(token: TokenSecurityAudit, dbTx = undefined): Promise<TokenSecurityAudit> {
        return await TokenSecurityAudit.create({
            // basic info
            hex40id:token.hex40id,
            base32:token.base32,
            // common audit
            sponsor: token.sponsor, // cfx.getSponsorInfo(address)
            zeroAdmin: token.zeroAdmin, // cfx.getAccount(address)
            verify: token.verify, // get field verifyResult from table contract_verify
            audit: token.audit,
            auditUrl: token.auditUrl,
            // cex audit
            cexBinance: token.cexBinance,
            cexHuobi: token.cexHuobi,
            cexOKEx: token.cexOKEx,
            // dex audit
            dexMoonSwap: token.dexMoonSwap,
            trackCoinMarketCap: token.trackCoinMarketCap,
        }, {
            transaction: dbTx
        })
    }
}

