export class EventBus{
    private static emptySet = new Set<string>()
    private static addressSet = new Set<string>()
    static processTxAddress(hex: string) {
        this.addressSet.add(hex)
    }

    static swapAddressSet() {
        if (this.addressSet.size === 0) {
            return this.emptySet
        }
        const ret = this.addressSet;
        this.addressSet = new Set<string>()
        return ret;
    }
}