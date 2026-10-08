import {Op} from "sequelize";
import {init} from "./FixDailyTokenStat";
import {ESpaceHex40Map, Hex40Map} from "../../model/HexMap";
import {mappedEspaceHex} from "../common/CrossSpaceAddress";

// Run after ESpaceHex40Map.sql:
// node stat/service/tool/BackfillCoreSpaceMapping.js [lastCompletedHexId]
// Walk known address bytes once offline; the API only performs indexed lookups.
export async function backfillCoreSpaceMapping(cursor = '0') {
    while (true) {
        const candidates = await Hex40Map.findAll({
            where: {id: {[Op.gt]: cursor}},
            order: [['id', 'ASC']], limit: 1000, raw: true,
        });
        if (!candidates.length) return;
        const coreByMappedHex = new Map(candidates
            .filter(row => /^[018][0-9a-f]{39}$/.test(row.hex))
            .map(row => [mappedEspaceHex(row.hex), row.hex]));
        if (coreByMappedHex.size) {
            const addresses = await Hex40Map.findAll({
                where: {hex: {[Op.in]: [...coreByMappedHex.keys()]}}, raw: true,
            });
            // hexId is indexed; e_space_hex40.hex is not.
            for (const address of addresses) {
                await ESpaceHex40Map.update({coreHex: coreByMappedHex.get(address.hex)}, {
                    where: {hexId: address.id, coreHex: null},
                });
            }
        }
        cursor = String(candidates[candidates.length - 1].id);
        console.log(`Backfilled through hex40 id ${cursor}`);
    }
}

if (require.main === module) {
    init().then(() => backfillCoreSpaceMapping(process.argv[2] || '0'))
        .then(() => Hex40Map.sequelize.close())
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}
