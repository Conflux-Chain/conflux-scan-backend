export class StatBucket {
    private bizValue: bigint;
    private lowerBoundInclude: Date;
    private upperBoundExclude: Date;
    private minEpochNumber: number;
    private maxEpochNumber: number;

    public constructor(
    {
        lowerBoundInclude,
        upperBoundExclude,
        bizValue = BigInt(0),
        minEpochNumber = 0,
        maxEpochNumber = 0
    }: {
        lowerBoundInclude: Date,
        upperBoundExclude: Date,
        bizValue?: bigint,
        minEpochNumber?: number,
        maxEpochNumber?: number
    }) {
        this.lowerBoundInclude = lowerBoundInclude;
        this.upperBoundExclude = upperBoundExclude;
        this.bizValue = bizValue;
        this.minEpochNumber = minEpochNumber;
        this.maxEpochNumber = maxEpochNumber;
    }

    public contains({statTime = undefined, statEpoch = undefined}: { statTime: Date, statEpoch: number }) {
        if (statTime !== undefined) {
            return statTime.getTime() >= this.lowerBoundInclude.getTime() &&
                statTime.getTime() < this.upperBoundExclude.getTime();
        }
        if (statEpoch !== undefined) {
            return statEpoch >= this.minEpochNumber &&
                statEpoch <= this.maxEpochNumber;
        }
    }

    public increase({epochNumber, val}: { epochNumber: number, val: bigint }) {
        this.bizValue += val;
        this.minEpochNumber = this.minEpochNumber === 0 ? epochNumber : this.minEpochNumber;
        this.maxEpochNumber = epochNumber > this.maxEpochNumber ? epochNumber : this.maxEpochNumber;
    }

    public decrease({epochNumber, val}: { epochNumber: number, val: bigint }) {
        this.bizValue -= val;
        switch (epochNumber) {
            case this.minEpochNumber:
                this.minEpochNumber = 0;
                this.maxEpochNumber = 0;
                break;
            case this.maxEpochNumber:
                this.maxEpochNumber--;
                break;
            default:
                throw new Error(`StatHandler, reorg ${epochNumber} in (${this.minEpochNumber},${this.maxEpochNumber})`);
        }
    }

    public static newInstance({statTime}) {
        const time = new Date(statTime);
        time.setMinutes(0, 0, 0);
        const lowerBoundInclude = new Date(time);

        time.setHours(time.getHours() + 1);
        const upperBoundExclude = new Date(time);

        return new StatBucket({lowerBoundInclude, upperBoundExclude});
    }
}