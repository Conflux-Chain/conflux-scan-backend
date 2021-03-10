import {Context} from "koa";
import {ADDR_INFO_STATE_OK, Address, AddressInfo, Hex40Map} from "../model/HexMap";

export async function setAddressInfo(ctx: Context) {
    let hex: string = ctx.request.query.hex || ''
    hex = hex.replace('0x', '')
    const {name, remark, state} = ctx.request.query
    if (hex === undefined || hex === '') {
        ctx.body = {code: 404, message: 'missing param hex'}
        return;
    }
    const hexBean = await Address.findOne({where: {hex40: hex}})
    if (hexBean === null) {
        ctx.body = {code: 404, message: `hex not found: ${hex}`}
        return;
    }
    let info = await AddressInfo.findByPk(hexBean.id)
    if (info === null) {
        const dt = new Date()
        const newOne = {name, remark, state: state || ADDR_INFO_STATE_OK, createAt:dt, updateAt: dt, id: hexBean.id}
        info = await AddressInfo.create(newOne)
        ctx.body = {code: 0, message: 'created', info}
    } else {
        info.updateAt = new Date()
        info.name = name || info.name
        info.remark = remark || info.remark
        info.state = state || info.state
        info = await info.save({})
        ctx.body =  {code: 0, message: 'updated', info}
    }
}