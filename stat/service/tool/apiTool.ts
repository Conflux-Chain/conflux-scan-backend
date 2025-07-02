import {getAccountQuery} from "../AccountQuery";

export async function patchAddressInfo(list: any[], fromKey: string, toKey: string) {
	let addressArray = [];
	list.forEach((tx) => {
		fromKey && addressArray.push(tx[fromKey].toString());
		tx[toKey] && (addressArray.push(tx[toKey].toString()));
	});
	const accountQuery = getAccountQuery();
	const accountBasic = await accountQuery.listPatchInfo(addressArray);
	list.forEach((tx) => {
		tx.fromENSInfo = accountBasic.map[tx[fromKey]]?.ens;
		tx.fromNameTagInfo = accountBasic.map[tx[fromKey]]?.nameTag;
		const info = accountBasic.map[tx[toKey]];
		if (info) {
			tx.toContractInfo = info.contract;
			tx.toTokenInfo = info.token;
			tx.toENSInfo = info.ens;
			tx.toNameTagInfo = info.nameTag;
		}
	});
}
