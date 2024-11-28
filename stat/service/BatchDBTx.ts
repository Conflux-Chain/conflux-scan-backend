import {
	AddressTransactionIndex,
	FullBlock,
	FullBlockExt,
	FullTransaction,
	IFailedTx
} from "../model/FullBlock";
import {IPosRegister} from "../model/PoS";

export class BatchBlockTx {
	failedTX: IFailedTx[]
	fullBlock: FullBlock[]
	fullTransaction: FullTransaction[]
	addressTransactionIndex: AddressTransactionIndex[]
	fullBlockExt: FullBlockExt[]
	blockCount: number
	txCount: number
	posRegArr: IPosRegister[]

	batchSize: number

	constructor() {
		this.reset();
	}
	//
	reset() {
		// https://stackoverflow.com/questions/1232040/how-do-i-empty-an-array-in-javascript
		this.failedTX = []
		this.fullBlock = []
		this.fullTransaction = []
		this.addressTransactionIndex = []
		this.fullBlockExt = []
		this.blockCount = 0
		this.txCount = 0
		this.posRegArr = []

		this.batchSize = 0
	}

	//
}
