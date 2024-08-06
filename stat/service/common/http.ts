import * as http from "http";
import {RequestOptions} from "http";

// superagent doesn't expose an interface to intercept response,
// use this one to access the original text.
export async function post({hostname, port, protocol, headers}: RequestOptions, data: any) : Promise<string> {
	const postData = JSON.stringify(data);
	const forkOpt = {method: 'POST', hostname, port, protocol, headers: {...headers}}
	forkOpt.headers['Content-Length'] = Buffer.byteLength(postData);

	return new Promise((resolve, reject) => {

		const req = http.request(forkOpt, (res) => {
			// console.log(`STATUS: ${res.statusCode}`);
			// console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
			if (res.statusCode != 200) {
				reject(`chain rpc returns ${res.statusCode}`)
				return
			}
			let buff = "";
			res.setEncoding('utf8');
			res.on('data', (chunk) => {
				// console.log(`BODY: ${chunk}`);
				buff += chunk;
			});
			res.on('end', () => {
				resolve(buff)
			});
		});

		req.on('error', (e) => {
			reject(e)
		});

		// Write data to request body
		req.write(postData);
		req.end();
	})
}
