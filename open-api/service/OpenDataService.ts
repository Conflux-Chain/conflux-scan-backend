import {intParam, mustBeEnumParamIfPresent, mustBeIntParamIfPresent} from "../../stat/service/common/utils";
import {buildHexSet, Hex40Map} from "../../stat/model/HexMap";
import {Op} from "sequelize";
import {fmtAddr, StatApp} from "../../stat/StatApp";
import {setBody} from "../router/middleware";
import {LIMIT_MAX} from "../../stat/router/ParamChecker";
import {Errors} from "../../stat/service/common/LogicError";
import {Erc20Transfer} from "../../stat/model/Erc20Transfer";
import {getApiService} from "../ApiServer";

export async function listAccountsByCursor(ctx) {
	mustBeIntParamIfPresent(ctx.request.query, "id", "limit");
	mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC']);
	let {id, sort = 'DESC'} = ctx.request.query;
	const limit = intParam(ctx.request.query, "limit", 10);
	if (limit > LIMIT_MAX) {
		throw new Errors.ParameterError(`Parameter <limit exceeds ${LIMIT_MAX}`);
	}
	const idOption = {id:{[sort == "ASC" ? Op.gt : Op.lt] : id}};
	if (id == undefined) {
		delete idOption['id']
	}
	const list = await Hex40Map.findAll({where: idOption, order: [['id', sort]], limit, raw: true});

	const addr= list.map(bean=>{
		return {address: fmtAddr(`0x${bean.hex}`, StatApp.networkId), id: bean.id}
	})

	setBody(ctx, addr)
}

export async function listErc20transferByCursor(ctx) {
	mustBeIntParamIfPresent(ctx.request.query, "limit");
	mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC']);
	let {sort = 'DESC', cursor} = ctx.request.query;
	if (cursor && !/\d+_\d+_\d+_\d+/.test(cursor)) {
		throw new Errors.ParameterError(`Parameter cursor is invalid`);
	}
	const [epoch, blockPosition, txPosition, txLogIndex] = (cursor || "").split("_").map(str=>parseInt(str));
	let op = sort === 'DESC' ? Op.lt : Op.gt;
	const limit = intParam(ctx.request.query, "limit", 10);
	if (limit > LIMIT_MAX) {
		throw new Errors.ParameterError(`Parameter limit exceeds ${LIMIT_MAX}`);
	}
	let where = undefined
	if (cursor) {
		where = {
			[Op.or]: [
				// epoch > ?
				{epoch: {[op]: epoch}},
				// or ( epoch = ? and blockPosition > ?)
				{
					[Op.and]: [
						{epoch: epoch},
						{blockPosition: {[op]: blockPosition}},
					]
				},
				// or ( epoch = ? and blockPosition = ? and txPosition > ?)
				{
					[Op.and]: {
						epoch: epoch,
						blockPosition: blockPosition,
						txPosition: {[op]: txPosition},
					}
				},
				// or ( epoch = ? and blockPosition = ? and txPosition = ? and txLogIndex > ?)
				{
					[Op.and]: {
						epoch: epoch,
						blockPosition: blockPosition,
						txPosition,
						txLogIndex: {[op]: txLogIndex},
					}
				},
			]
		}
	}
	const list = await Erc20Transfer.findAll({where,
		order: [['epoch', sort], ['blockIndex', sort], ['txIndex', sort], ['txLogIndex', sort]],
		limit, raw: true}
	);

	const filledList = await getApiService().crc20transferQuery.processList(list, undefined)
	const addrArr = buildHexSet(undefined, filledList, 'address');
	const tokens = await getApiService().tokenQuery.list({addressArray: [...addrArr]});

	setBody(ctx, {list: filledList, tokenMap: lodash.keyBy(tokens, 'address')})
}
