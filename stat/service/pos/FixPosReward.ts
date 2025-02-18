import {IPosReward, PosAccount, PosEpochRewardHash, PosReward} from "../../model/PoS";
import {Op} from "sequelize";
import {Conflux} from "js-conflux-sdk";

export async function fixPosRewardAll(epoch:number = 0, cfx: Conflux, dryRun = true) {
	epoch -= 1;
	do {
		const base = await PosReward.findOne({where: {epoch: {[Op.gt]: epoch}}, order: [['epoch', 'asc']]}).then(res=>res?.epoch);
		if (!base) {
			break;
		}
		const n = await fixRewardByEpoch(base, cfx, dryRun);
		if (n != 1) {
			break;
		}
		epoch = base;
	} while(true);
	console.log(`ok`)
}
export async function fixRewardByEpoch(epoch:number, cfx: Conflux, dryRun: boolean) {
	let rewardInfo = await cfx.pos.getRewardsByEpoch(epoch)
	if (!rewardInfo) {
		console.log(` pos reward is ${rewardInfo} at epoch ${epoch}`);
		return -1;
	}
	const accountRewards = rewardInfo.accountRewards;
	const posAddrArr = accountRewards.map(r=>r.posAddress)
	const accounts = await PosAccount.findAll({
		attributes: ['id','hex'],
		where: {hex: {[Op.in]:posAddrArr}}
	})
	const accountMap = new Map<string, {id: number}>()
	accounts.forEach(a=>accountMap.set(a.hex, a))
	//@ts-ignore
	const rewardBeans:IPosReward[] = accountRewards.map(r=>{
		const account = accountMap.get(r.posAddress);
		if (!account) {
			throw new Error(`account not found, pos addr ${r.posAddress}, \n in ${JSON.stringify(accounts)}`)
		}
		const accountId = account.id;
		return {
			accountId: accountId,
			reward: r.reward,
			epoch,
		}
	})
	const dbBeanArr = await PosReward.findAll({where: {epoch}});
	if (dbBeanArr.length != rewardBeans.length) {
		console.log(`bean length is wrong ${dbBeanArr.length} reward ${rewardBeans.length} epoch ${epoch}`);
		process.exit(1)
	}
	const rMap = new Map<number, IPosReward>();
	dbBeanArr.forEach(r=>rMap.set(r.accountId, r));
	await PosReward.sequelize.transaction(async (dbTx)=>{
		for (let i=0; i<dbBeanArr.length; i++) {
			const newV = rewardBeans[i];
			const dbV = rMap.get(newV.accountId);
			if (dbV.accountId != newV.accountId) {
				console.log(`account id is wrong ${dbV.accountId} vs ${newV.accountId}`);
				process.exit(1);
			}
			if (dbV.reward == newV.reward) {
				continue;
			}
			const diff = BigInt(newV.reward) - BigInt(dbV.reward);
			console.log(`different epoch ${epoch} account ${dbV.accountId} db ${dbV.reward} new ${newV.reward} diff ${diff}`);
			if (dryRun) {
				continue
			}
			await PosReward.update({reward: newV.reward}, {where: {id: dbV.id}, transaction: dbTx});
			await PosAccount.increment('totalReward',
				{by: diff as any as number,
					where: {id: dbV.accountId},
					transaction: dbTx,
				})
		}
	})
	if (epoch % 100 == 0) {
		console.log(`${new Date().toISOString()} progress epoch `, epoch)
	}
	return 1; // indicate increase epoch by 1
}
