import {ContractImpl} from "../../model/ContractImpl";
import {getContractQuery} from "../ContractQuery";
import {format} from "js-conflux-sdk";
import {StatApp} from "../../StatApp";
import {Op, QueryTypes} from "sequelize";
import {AbiSignature, ContractAbiSignature} from "../../model/ContractInfo";

async function mergeVerifiedImplAbi(ref: IContractImplAbiRef) {
	const proxyC = await getContractQuery().queryVerify(ref.base32);
	if (!proxyC) {
		return;
	}

	const implInfo = await ContractImpl.findOne({
		where: {cid: ref.contractId}, raw: true,
	});
	if (!implInfo || implInfo.implId < 0) {
		return;
	}

	const implId = implInfo.implId;
	const map = await queryContractMethods([implId])
	ref.implAbiMap = map.get(implId);
	ref.implId = implId;
}

interface IContractImplAbiRef {
	contractId: number;
	base32?: string;
	implBase32?: string;
	implId?: number;
	implAbiMap?: Map<string, AbiSignature>;
}

export async function fillMethodInfo(
	list:{method?:string, to?:string}[],
	toIdArr: number[],
	isOpenApi: boolean = false,
	formatWithArg: boolean = false,
) {
	const toIdSet = new Set<number>(toIdArr);
	toIdSet.delete(0); // remove placeholder
	if (toIdSet.size === 0) {
		return;
	}

	// get abi of verified implementation contracts
	const verifiedImplAbiMap = new Map<number, IContractImplAbiRef>();
	const taskArr = [];
	list.forEach((row, idx)=>{
		if (row.to) {
			const toId = toIdArr[idx];
			const toBase32 = row.to.startsWith('0x') ? format.address(row.to, StatApp.networkId, false) : row.to;
			let ref = verifiedImplAbiMap.get(toId);
			if (!ref) {
				ref = {contractId: toId, base32: toBase32};
				verifiedImplAbiMap.set(toId, ref);
				taskArr.push(mergeVerifiedImplAbi(ref));
			}
		}
	})
	await Promise.all(taskArr).catch(err=>{
		console.log(`failed to fetch impl methodInfo:`, err);
	});

	// get abi of verified contracts
	const verifiedContractAbiMap = await queryContractMethods(toIdSet);

	// get pure abi by methodId array
	const pureAbiMap = new Map<string, AbiSignature>()
	list.map(row=>row.method).filter(methodId=>{
		return Boolean(methodId)
	}).forEach(methodId=>{
		pureAbiMap.set(methodId, null)
	})
	const dupAbiMap = new Map<string, number>();
	await AbiSignature.findAll({
		where:{
			hash:{[Op.in]:[...pureAbiMap.keys()]},
			type: 'function',
		},
		raw: true,
	}).then(list=>{
		pureAbiMap.clear();
		list.forEach(info=>{
			if (dupAbiMap.has(info.hash)) {
				// nothing, do not use it
			} else if (pureAbiMap.has(info.hash)) {
				// we have multiple abi. mark.
				dupAbiMap.set(info.hash, 2);
				// remove
				pureAbiMap.delete(info.hash);
			} else {
				pureAbiMap.set(info.hash, info)
			}
		})
	}).catch(err=>{
		console.log(`build method map fail:`, err)
	})

	list.forEach((row, index)=>{
		const toId = toIdArr[index];
		const fieldName = formatWithArg ? "fullFormat" : "signature";
		const verifiedContractAbi = verifiedContractAbiMap.get(toId)?.get(row.method)?.[fieldName];
		const verifiedImplAbi = verifiedImplAbiMap.get(toId)?.implAbiMap?.get(row.method)?.[fieldName];
		// use verified abi prior to pure abi.
		const useMethod = verifiedContractAbi || verifiedImplAbi || pureAbiMap.get(row.method)?.[fieldName];
		if(isOpenApi){
			row['methodId'] = row.method
			if(useMethod) {
				row.method = useMethod
			} else {
				delete row.method
			}
		} else{
			row.method = useMethod || row.method
		}
	})
}


async function queryContractMethods(toIdSet: Iterable<number>) {
	const toIdStr = [...toIdSet].join(',');
	const sql = ` select c.contractId, abi.* from (
    select * from ${ContractAbiSignature.getTableName()} WHERE contractId in (${toIdStr})
    ) c
    left join ${AbiSignature.getTableName()} abi on c.abiId = abi.id and abi.type='function'`;
	const list = await AbiSignature.sequelize.query(sql, {type: QueryTypes.SELECT, raw: true})
	.then(res=> res as unknown as (AbiSignature & ContractAbiSignature)[])
	.catch(error=>{
		console.log(`failed to query contract abi \n ${sql} \n ${error.message}`);
		return []
	});

	const map = new Map<number, Map<string, AbiSignature>>();
	list.forEach(info=>{
		let subM = map.get(info.contractId);
		if (!subM) {
			subM = new Map();
			map.set(info.contractId, subM);
		}
		subM.set(info.hash, info);
	})
	return map;
}
