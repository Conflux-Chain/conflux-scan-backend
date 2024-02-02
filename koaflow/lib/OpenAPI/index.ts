const lodash = require('lodash');
const {Router} = require('../../src/router');
const {Flow} = require('./Flow');
const {Schema} = require('./Schema');

function formatPath(path) {
  // "/user/:id" => "/user/{id}"
  return path.replace(/:([^/]+)/g, (_, param) => `{${param}}`);
}

function composeFlow(array = []) {
  const flowArray = array.filter(f => f instanceof Flow);
  const object = lodash.merge(...flowArray.map(v => v.object));
  return lodash.isEmpty(object) ? undefined : object;
}

function composePath({ all, ...methodTable } = {} as any) {
  const object = lodash.defaults(
    composeFlow(all),
    lodash.mapValues(methodTable, method => composeFlow(method)),
  );
  return lodash.pickBy(object, Boolean);
}

export class OpenAPI {
  private object: any;
  static flow(...args) {
    return new Flow(...args);
  }

  static schema(...args) {
    return new Schema(...args);
  }

  constructor(object) {
    this.object = lodash.defaults(object, {
      openapi: '3.0.0',
      info: {},
      servers: [],
      paths: {},
    });
  }

  loadRouter(router, root = '') {
    lodash.forEach(router.pathTable, ({ sub, ...methodTable }, name) => {
      const path = formatPath(`${root}${name}`);
      const object = composePath(methodTable);
      this.object.paths[path] = lodash.isEmpty(object) ? undefined : object;

      if (sub instanceof Router) {
        this.loadRouter(sub, path);
      }
    });
  }

  toObject() {
    return lodash.pick(this.object, ['openapi', 'info', 'servers', 'paths']);
  }
}

// module.exports = OpenAPI;
