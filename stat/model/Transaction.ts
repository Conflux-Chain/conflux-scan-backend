import {DataTypes, Model} from "sequelize";
import {makeId as makeAddrId} from "./HexMap";

export interface Transaction{
    id?: number,
    epochHeight?: number,
    nonce?: number,
    hash?: string, //64
    from?: string, // 40
    fromId?:number
    to?: string, // 40
    toId?:number
    value?: number,
    gas?: number,
    gasPrice?: number;
    status?: number;
    txIndex?: number,
    blockTime?: Date,
}