import {ContractImpl} from "../../model/ContractImpl";
import {getContractQuery} from "../ContractQuery";
import {getAddrId} from "../../model/HexMap";
import {format} from "js-conflux-sdk";
import {StatApp} from "../../StatApp";
import {Op, QueryTypes} from "sequelize";
import {AbiInfo, ContractABI} from "../../model/ContractInfo";

async function mergeVerifiedImplAbi(ref: IContractImplAbiRef) {
	const proxyC = await getContractQuery().queryVerify(ref.base32)
	if (!proxyC) {
		return;
	}
	const implInfo = await ContractImpl.findOne({
		where: {cid: ref.contractId}, raw: true,
	})
	if (!implInfo) {
		getContractQuery().getImpl(ref.base32).then(async res=>{
			const {implementation} = res || {};
			const implId = await getAddrId(implementation);
			await ContractImpl.bulkCreate([{
				cid: ref.contractId, implId: implId, proxyType: '',
			}], {
				updateOnDuplicate: ['implId', 'updatedAt'],
			})
		}).catch(err=>{
			console.log(`failed to cache contract implementation, contract ${ref.base32} `, err);
		})
		return; //
	}
	if (!implInfo.implId || implInfo.implId < 0) {
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
	implAbiMap?: Map<string, AbiInfo>;
}
export async function fillMethodInfo(list:{method?:string, to?:string}[],
                                     toIdArr: number[],
                                     isOpenApi: boolean = false) {
	const toIdSet = new Set<number>(toIdArr);
	toIdSet.delete(0); // remove placeholder
	if (toIdSet.size === 0) {
		return;
	}
	const cImplAbiMap = new Map<number, IContractImplAbiRef>();
	const taskArr = [];
	list.forEach((row, idx)=>{
		if (row.to) {
			const toId = toIdArr[idx];
			const toBase32 = row.to.startsWith('0x') ? format.address(row.to, StatApp.networkId, false) : row.to;
			let ref = cImplAbiMap.get(toId);
			if (!ref) {
				ref = {contractId: toId, base32: toBase32};
				cImplAbiMap.set(toId, ref);
				taskArr.push(mergeVerifiedImplAbi(ref));
			}
		}
	})
	await Promise.all(taskArr).catch(err=>{
		console.log(`failed to fetch impl methodInfo:`, err);
	});

	// find abi of verified contracts
	const verifiedAbiMap = await queryContractMethods(toIdSet);

	// build pure abi map
	const poorAbiMap = new Map<string, AbiInfo>()
	list.map(row=>row.method).filter(methodId=>{
		return Boolean(methodId)
	}).forEach(methodId=>{
		poorAbiMap.set(methodId, null)
	})
	const dupAbiMap = new Map<string, number>();
	await AbiInfo.findAll({
		where:{
			hash:{[Op.in]:[...poorAbiMap.keys()]},
			type: 'function',
		},
		raw: true,
		// , logging: console.log
	}).then(list=>{
		poorAbiMap.clear();
		list.forEach(info=>{
			if (dupAbiMap.has(info.hash)) {
				// nothing, do not use it
			} else if (poorAbiMap.has(info.hash)) {
				// we have multiple abi. mark.
				dupAbiMap.set(info.hash, 2);
				// remove
				poorAbiMap.delete(info.hash);
			} else {
				poorAbiMap.set(info.hash, info)
			}
		})
	}).catch(err=>{
		console.log(`build method map fail:`, err)
	})
	list.forEach((row, index)=>{
		const toId = toIdArr[index];
		const verifiedContractAbi = verifiedAbiMap.get(toId)?.get(row.method)?.fullName;
		const verifiedImplAbi = cImplAbiMap.get(toId)?.implAbiMap?.get(row.method)?.fullName;
		// use verified abi prior to pure abi.
		const useMethod =  verifiedContractAbi || verifiedImplAbi || poorAbiMap.get(row.method)?.fullName;
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
		// console.log(`set full name ${fullName} to ${row.method} , map v ${map.get(row.method)}`)
	})
}


async function queryContractMethods(toIdSet: Iterable<number>) {
	const toIdStr = [...toIdSet].join(',');
	const sql = ` select c.contractId, abi.* from (
    select * from ${ContractABI.getTableName()} WHERE contractId in (${toIdStr})
    ) c
    left join ${AbiInfo.getTableName()} abi on c.abiId = abi.id and abi.type='function'`;
	const list = await AbiInfo.sequelize.query(sql, {type: QueryTypes.SELECT, raw: true})
	.then(res=> res as unknown as (AbiInfo & ContractABI)[])
	.catch(error=>{
		console.log(`failed to query contract abi \n ${sql} \n ${error.message}`);
		return []
	});

	const map = new Map<number, Map<string, AbiInfo>>();
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
