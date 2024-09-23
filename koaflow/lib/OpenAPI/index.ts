import {pickParameter} from "./Flow";
export class OpenAPI {
  static flow({input}) {
    return pickParameter(input);
  }

  static schema(o) {
    return o
  }
}

