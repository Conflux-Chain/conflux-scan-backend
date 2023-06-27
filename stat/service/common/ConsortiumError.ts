class ConsortiumError extends Error {
    public code: number;

    public constructor(code, msg) {
        super();
        this.code = code;
        this.message = msg;
    }
}