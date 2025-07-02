import {getAccountQuery} from "../AccountQuery";

export async function patchAddressInfo(list: any[], fromKey: string, toKey: string) {
	let addressArray = [];
	list.forEach((tx) => {
		fromKey && addressArray.push(tx[fromKey].toString());
		tx[toKey]&& (addressArray.push(tx[toKey].toString()));
	});
	const accountQuery = getAccountQuery();
	const accountBasic = await accountQuery.listPatchInfo(addressArray);
	list.forEach((tx) => {
		tx.fromENSInfo = accountBasic.map[tx[fromKey]]?.ens;
		tx.fromNameTagInfo = accountBasic.map[tx[fromKey]]?.nameTag;
		tx[toKey]&& (tx.toContractInfo = accountBasic.map[tx[toKey]]?.contract);
		tx[toKey]&& (tx.toTokenInfo = accountBasic.map[tx[toKey]]?.token);
		tx[toKey]&& (tx.toENSInfo = accountBasic.map[tx[toKey]]?.ens);
		tx[toKey]&& (tx.toNameTagInfo = accountBasic.map[tx[toKey]]?.nameTag);
	});
}
