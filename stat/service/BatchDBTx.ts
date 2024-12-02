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
	posRegArr: IPosRegister[]

	batchSize: number

	enable: boolean
	safeCatchupGap: number
	initialTaskCount: number
	saveAtSize: number

	constructor() {
		this.safeCatchupGap = 600;
		this.initialTaskCount = 300;
		this.saveAtSize = 100;
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
		this.posRegArr = []

		this.batchSize = 0
	}

	//
}
