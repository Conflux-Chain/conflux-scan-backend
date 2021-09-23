var fs = require("fs");
var CodeGen = require("swagger-typescript-codegen").CodeGen;

var file = "../../document/open-api.json";
var swagger = JSON.parse(fs.readFileSync(file, "UTF-8"));
console.log(`what ? ${swagger}`, swagger)
var tsSourceCode = CodeGen.getTypescriptCode({
    className: "Test",
    swagger: swagger,
    imports: ["../../typings/tsd.d.ts"]
});
console.log(tsSourceCode);