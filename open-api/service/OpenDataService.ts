import {intParam, mustBeEnumParamIfPresent, mustBeIntParamIfPresent} from "../../stat/service/common/utils";
import {ESpaceHex40Map, Hex40Map} from "../../stat/model/HexMap";
import {Op} from "sequelize";
import {fmtAddr, StatApp} from "../../stat/StatApp";
import {setBody} from "../router/middleware";
import {LIMIT_MAX} from "../../stat/router/ParamChecker";
import {Errors} from "../../stat/service/common/LogicError";
import {keccak256} from "ethers";

export async function listAccountsByCursor(ctx) {
	mustBeIntParamIfPresent(ctx.request.query, "id", "limit");
	mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['asc', 'desc', 'ASC', 'DESC']);
	let {id, sort = 'DESC'} = ctx.request.query;
	const limit = intParam(ctx.request.query, "limit", 10);
	if (limit > LIMIT_MAX) {
		throw new Errors.ParameterError(`Parameter <limit exceeds ${LIMIT_MAX}`);
	}
	const idOption = { id: { [sort == "ASC" || sort == "asc" ? Op.gt : Op.lt]: id } };
	if (id == undefined) {
		delete idOption['id']
	}
	const list = await Hex40Map.findAll({where: idOption, order: [['id', sort]], limit, raw: true});

	const addr= list.map(bean=>{
		return {address: fmtAddr(`0x${bean.hex}`, StatApp.networkId), id: bean.id}
	})

	setBody(ctx, addr)
}

export async function resolveCoreSpaceAddress(ctx) {
	const {eSpaceAddress} = ctx.request.query;
	if (typeof eSpaceAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(eSpaceAddress)) {
		throw new Errors.ParameterError('Invalid eSpace address');
	}

	const normalizedHex = eSpaceAddress.slice(2).toLowerCase();
	const mapped = await ESpaceHex40Map.findOne({
		attributes: ['hexId'],
		where: {hex: normalizedHex},
		raw: true,
	});
	if (!mapped) {
		throw new Errors.ParameterError('Cross-space mapped address not found');
	}
	const coreAddress = await Hex40Map.findByPk(mapped.hexId, {attributes: ['hex'], raw: true});
	const coreHex = coreAddress?.hex?.toLowerCase();
	// A linked row is an original Core address only if it hashes to the requested mapping.
	if (!coreHex || !/^[018][0-9a-f]{39}$/.test(coreHex)
		|| keccak256(`0x${coreHex}`).slice(-40) !== normalizedHex) {
		throw new Errors.ParameterError('Cross-space mapped address not found');
	}

	setBody(ctx, {
		eSpaceAddress,
		coreSpaceAddress: fmtAddr(`0x${coreHex}`, StatApp.networkId),
	});
}
