import KoaRouter from "koa-router";

export function addKoaRouter(router: KoaRouter, method: string, path: string, ...fnArr: Function[]) {
	const composite = async function(ctx) {
		let input = ctx;
		for(const fn of fnArr) {
			input = await fn.call(ctx, input);
			console.log(`${__filename} got `, input);
		}
		ctx.body = input;
	}

	// router[`_original_${method}`](path, composite);
	router[method](path, composite);
}

export function router_get(router: KoaRouter, path: string, ...fnArr: Function[]) {
	addKoaRouter(router, 'get', path, ...fnArr)
}
