import {DataTypes, Model, Sequelize, Transaction, Op} from "sequelize";
import {KV} from "./KV";

export type CompilerVersionType = 'solc' | 'solc-vulnerability' | 'vyper' | 'fe';

interface ICompilerVersion {
    id?: number;
    type: CompilerVersionType;
    version: string;
    description?: string;
    commit?: string;
    vulnerabilityCount?: number;
}

const LEGACY_KEYS = [
    'SOLC_VERSIONS',
    'SOLC_VULNERABILITIES',
    'VYPER_VERSIONS',
    'FE_VERSIONS',
];
const LEGACY_MIGRATED_KEY = 'COMPILER_VERSIONS_MIGRATED';

export class CompilerVersion extends Model<ICompilerVersion> implements ICompilerVersion {
    private static legacyMigrationPromise?: Promise<void>;
    id?: number;
    type: CompilerVersionType;
    version: string;
    description?: string;
    commit?: string;
    vulnerabilityCount?: number;

    static register(sequelize: Sequelize) {
        CompilerVersion.init({
            id: {type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true},
            type: {type: DataTypes.STRING(32), allowNull: false},
            version: {type: DataTypes.STRING(64), allowNull: false},
            description: {type: DataTypes.STRING(255)},
            commit: {type: DataTypes.STRING(64)},
            vulnerabilityCount: {type: DataTypes.INTEGER},
        }, {
            sequelize,
            tableName: 'compiler_version',
            indexes: [
                {name: 'uk_compiler_version_type_version', fields: ['type', 'version'], unique: true},
                {name: 'idx_compiler_version_type', fields: ['type']},
            ],
            timestamps: true,
        });
    }

    static async replace(type: CompilerVersionType, rows: Array<Partial<ICompilerVersion>>, transaction?: Transaction) {
        const run = async (dbTx: Transaction) => {
            await CompilerVersion.destroy({where: {type}, transaction: dbTx});
            if (rows.length) {
                await CompilerVersion.bulkCreate(rows.map(row => ({...row, type})), {transaction: dbTx});
            }
        };
        if (transaction) {
            return run(transaction);
        }
        return CompilerVersion.sequelize.transaction(run);
    }

    static async list(type: CompilerVersionType) {
        await CompilerVersion.migrateLegacy();
        return CompilerVersion.findAll({where: {type}, order: [['version', 'ASC']], raw: true, useMaster: true});
    }

    static migrateLegacy() {
        if (!CompilerVersion.legacyMigrationPromise) {
            CompilerVersion.legacyMigrationPromise = CompilerVersion.migrateLegacyInternal().catch(error => {
                CompilerVersion.legacyMigrationPromise = undefined;
                throw error;
            });
        }
        return CompilerVersion.legacyMigrationPromise;
    }

    private static async migrateLegacyInternal() {
        if (!CompilerVersion.sequelize) {
            return;
        }
        await CompilerVersion.sequelize.transaction(async transaction => {
            // Lock the legacy rows so concurrent processes cannot import the same snapshot.
            const legacyRows = await KV.findAll({
                where: {key: {[Op.in]: LEGACY_KEYS}},
                order: [['key', 'ASC']],
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            const migrated = await KV.findOne({
                where: {key: LEGACY_MIGRATED_KEY},
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!migrated) {
                const legacy = new Map<string, string>(legacyRows.map(row => [row.key, row.value]));
                const [solc, vulnerabilities, vyper, fe] = LEGACY_KEYS.map(key => {
                    const value = legacy.get(key);
                    return value ? JSON.parse(value) : {};
                });
                if (Object.keys(solc).length) {
                    await CompilerVersion.replace('solc', Object.entries(solc).map(([version, description]) => ({version, description: String(description)})), transaction);
                }
                if (Object.keys(vulnerabilities).length) {
                    await CompilerVersion.replace('solc-vulnerability', Object.entries(vulnerabilities).map(([version, count]) => ({version, vulnerabilityCount: Number(count)})), transaction);
                }
                if (Object.keys(vyper).length) {
                    await CompilerVersion.replace('vyper', Object.entries(vyper).map(([version, value]: [string, any]) => ({version, description: value.desc, commit: value.commit})), transaction);
                }
                if (Object.keys(fe).length) {
                    await CompilerVersion.replace('fe', Object.entries(fe).map(([version, value]: [string, any]) => ({version, description: value.desc, commit: value.commit})), transaction);
                }
                await KV.upsert({key: LEGACY_MIGRATED_KEY, value: '1'}, {transaction});
            }
            // Leave the marker so later starts cannot import stale values again.
            await KV.destroy({where: {key: {[Op.in]: LEGACY_KEYS}}, transaction});
        });
    }
}
