import KoaRouter from "koa-router";

export function addKoaRouter(router: KoaRouter, method: string, path: string, ...fnArr: Function[]) {
	const composite = async function(ctx) {
		let input = ctx;
		for(const fn of fnArr) {
			input = await fn.call(ctx, input);
			// console.log(`${__filename} got `, input);
		}
		ctx.body = input;
	}

	const errorCatcher = async function(ctx) {
		try {
			await composite(ctx);
		} catch (e) {
			ctx.methodFlowError = e;
			if (e.name == 'ParameterError') {
				console.log(`${__filename} catches param error \n url: ${ctx.originalUrl} \n`, e.message)
			} else {
				console.log(`${__filename} catches unknown error \n url: ${ctx.originalUrl} \n`, e)
			}
		}
	}

	// router[`_original_${method}`](path, composite);
	router[method](path, errorCatcher);
}

export function router_get(router: KoaRouter, path: string, ...fnArr: Function[]) {
	addKoaRouter(router, 'get', path, ...fnArr)
}

export function router_post(router: KoaRouter, path: string, ...fnArr: Function[]) {
	addKoaRouter(router, 'post', path, ...fnArr)
}
