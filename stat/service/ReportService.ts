import {Errors} from "./common/LogicError";

const superagent = require('superagent');

export class ReportService {
    protected app;

    constructor(app) {
        this.app = app;
    }

    // see https://developers.google.com/recaptcha/docs/verify
    // response is: {
    //     "success": true|false,
    //     "challenge_ts": timestamp,  // timestamp of the challenge load (ISO format yyyy-MM-dd'T'HH:mm:ssZZ)
    //     "hostname": string,         // the hostname of the site where the reCAPTCHA was solved
    //     "error-codes": [...]        // optional
    // }
    public async verify(token, address, typeArray, description, txn_hash): Promise<object>{
        const {
            app: { config },
        } = this;

        console.info(`report request, token:${token}, address:${address}, type:${typeArray}, 
            description:${description}, txn_hash:${txn_hash}`);
        const response = await superagent.post(`${config.recaptchaUrl}`)
            .set('Content-Type','application/x-www-form-urlencoded')
            .send({ secret: config.recaptchaToken, response: token })
            .timeout(60 * 1000);
        const responseText = JSON.parse(response?.text);
        if (response.status !== 200 || !responseText?.success) {
            console.error(`report fail, token:${token}, siteVerifyResponse:${response?.text}`);
            /*return {code: 9999, msg: responseText['error-codes'] || 'bad-http-status'};*/
            throw new Errors.BizError(responseText['error-codes'] || 'bad-http-status');
        }

        const type = typeArray.join();
        const reportResponse = await superagent.post(`${config.reportUrl}`)
            .send({ address, type, description, txn_hash })
            .timeout(60 * 1000);
        const reportResponseText = JSON.parse(reportResponse?.text);
        if (reportResponse.status !== 200 || reportResponseText?.code !== 0) {
            console.error(`report fail, token:${token}, reportResponse:${reportResponse?.text}`);
            /*return {code: 9999, msg: `${reportResponseText?.message}[${reportResponseText?.code}]` || 'bad-http-status.'};*/
            throw new Errors.BizError(`${reportResponseText?.message}[${reportResponseText?.code}]` || 'bad-http-status.');
        }

        console.info(`report response, token:${token}, siteVerifyResponse:${response?.text}
            , reportResponse:${reportResponse?.text}`);
        return {report: 'ok'};
    }

}


