import {intParam, mustBeEnumParamIfPresent, mustBeIntParamIfPresent} from "../../stat/service/common/utils";
import {Hex40Map} from "../../stat/model/HexMap";
import {Op} from "sequelize";
import {fmtAddr, StatApp} from "../../stat/StatApp";
import {setBody} from "../router/middleware";
import {LIMIT_MAX} from "../../stat/router/ParamChecker";
import {Errors} from "../../stat/service/common/LogicError";

export async function listAccountsByCursor(ctx) {
	mustBeIntParamIfPresent(ctx.request.query, "id", "limit");
	mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC']);
	let {sort = 'DESC'} = ctx.request;
	const id = intParam(ctx.request.query, "id", 0);
	const limit = intParam(ctx.request.query, "limit", 10);
	if (limit > LIMIT_MAX) {
		throw new Errors.ParameterError(`Parameter <limit exceeds ${LIMIT_MAX}`);
	}
	const idOption = {id:{[sort == "ASC" ? Op.gt : Op.lt] : id}};
	if (!id) {
		delete idOption['id']
	}
	const list = await Hex40Map.findAll({where: idOption, order: [['id', sort]], limit, raw: true});

	const addr= list.map(bean=>{
		return {address: fmtAddr(`0x${bean.hex}`, StatApp.networkId), id: bean.id}
	})

	setBody(ctx, addr)
}
