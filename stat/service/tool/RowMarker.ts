import {BlockRowMark, markBlockPosition} from "../../model/FullBlock";
import {init} from "./FixDailyTokenStat";

async function markBloc() {

}
const args = process.argv.slice(2)
if ('block' === args[0]) {
    init().then( ()=>
        markBlockPosition(Number(args[1] || 1))
    ).then(()=>{
        BlockRowMark.sequelize.close()
    }).then()
} else {
    console.log(`what ?`)
}