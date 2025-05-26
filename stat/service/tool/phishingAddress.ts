import {AddressTransactionIndex} from "../../model/FullBlock";
import {Op} from "sequelize";
import {buildHexSet, getAddrId, idHex40Map, mapProp} from "../../model/HexMap";
import {fmtAddr, StatApp} from "../../StatApp";
import { CONST } from "../common/constant";
import {AddressErc20Transfer} from "../../model/Erc20Transfer";
import {AddressErc721Transfer} from "../../model/Erc721Transfer";
import {AddressErc1155Transfer} from "../../model/Erc1155Transfer";
import {AddressCfxTransfer} from "../../model/CfxTransfer";

let zeroAddr = '';
export async function detectFishingAddress(addrId: number, list: any[], type?: string): Promise<AddressTransactionIndex> {
	if (list.length === 0) {
		return;
	}
	const startMs = Date.now();
	// cfx:aak...7gahxs5y
	let headChars = 7, tailChars = 4;
	switch (StatApp.networkId) {
		case 1: headChars = 'cfxtest:'.length + 3; tailChars=4; break;
		case 1029: headChars = 'cfxtest:'.length + 3; tailChars=8; break;
		case 8888: headChars = 'net8888:'.length + 3; tailChars=4; break;
	}
	if (StatApp.isEVM) {
		headChars = 6; // include 0x
		tailChars = 4;
	}
	let model: any = AddressTransactionIndex;
	switch (type) {
		case CONST.TRANSFER_TYPE.CFX: model = AddressCfxTransfer; break;
		case CONST.TRANSFER_TYPE.ERC20: model = AddressErc20Transfer; break;
		case CONST.TRANSFER_TYPE.ERC721: model = AddressErc721Transfer; break;
		case CONST.TRANSFER_TYPE.ERC1155: model = AddressErc1155Transfer; break;
		default: model = type ? undefined : model; break;
	}
	if (!model) {
		console.log(`${__filename} unknown type ${type}`);
		return ;
	}
	const {epoch: maxEpoch} = list[0];
	const {epoch: minEpoch} = list[list.length - 1];
	const [laterTxArr, earlierTxArr] = await Promise.all([
		model.findAll({
			where: {addressId: addrId, epoch: {[Op.gte]: maxEpoch}}, order: [['epoch', 'asc']], limit: 100, raw: true,
		}),
		model.findAll({
			where: {addressId: addrId, epoch: {[Op.lte]: minEpoch}}, order: [['epoch', 'desc']], limit: 100, raw: true,
		}),
	]);
	const ids = buildHexSet(null, laterTxArr, 'toId', 'fromId');
	buildHexSet(ids, earlierTxArr, 'toId', 'fromId');
	ids.delete(await getAddrId(CONST.ZERO_ADDRESS));
	if (!zeroAddr) {
		zeroAddr = fmtAddr(CONST.ZERO_ADDRESS, StatApp.networkId);
	}
	let addressMap = await idHex40Map([...ids], true);
	if (StatApp.isEVM) {
		let base32map: Map<number, string>;
		base32map = new Map<number, string>();
		addressMap.forEach((v, k)=>{
			base32map.set(k, fmtAddr(v, StatApp.networkId));
		})
		addressMap = base32map;
	}
	mapProp(addressMap, laterTxArr, 'fromId', 'from');
	mapProp(addressMap, earlierTxArr, 'toId', 'to');
	// Abbreviation map
	const abMap = new Map<string, Set<string>>();
	fillAbbreviationMap(abMap, list, headChars, tailChars);
	fillAbbreviationMap(abMap, laterTxArr, headChars, tailChars);
	fillAbbreviationMap(abMap, earlierTxArr, headChars, tailChars);

	const objResult = {duration: Date.now() - startMs, type} as any;
	abMap.forEach((v, k)=>{
		objResult[k] = [...v];
	})
	return objResult;
}

function fillAbbreviationMap(abMap: Map<string, Set<string>>, list: any[], headChars: number, tailChars: number) {

	function putAddr(addr: string) {
		if (!addr || addr.length < 40 || addr === zeroAddr) {// not an address
			return;
		}
		addr = addr.toLowerCase();
		const ab = addr.substr(0, headChars) + '...' + addr.substr(addr.length - tailChars);
		let set = abMap.get(ab);
		if (!set) {
			set = new Set<string>();
			abMap.set(ab, set);
		}
		set.add(addr);
	}

	for (const row of list) {
		const {from, to} = row;
		putAddr(from);
		putAddr(to);
	}
}
