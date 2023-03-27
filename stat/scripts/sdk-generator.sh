#npm install @openapitools/openapi-generator-cli -g
npx @openapitools/openapi-generator-cli generate \
-g typescript-node \
-i ./document/open-api.yaml \
-o ./document/ts-node-openapi-sdk \
-p apiDocs=true \
-p modelDocs=true \
-p apiTests=true \
-p modelTests=true \
-p supportsES6=true \
-p npmName='ts-node-openapi-sdk' \
-p npmVersion='1.0.0' \
-p npmRepository='https://registry.npmjs.org/' \
--skip-validate-spec

npx @openapitools/openapi-generator-cli generate \
-g typescript-node \
-i ./document/open-api.yaml \
-o ./document/ts-axios-openapi-sdk \
-p apiDocs=true \
-p modelDocs=true \
-p apiTests=true \
-p modelTests=true \
-p supportsES6=true \
-p npmName='ts-axios-openapi-sdk' \
-p npmVersion='1.0.0' \
-p npmRepository='https://registry.npmjs.org/' \
--skip-validate-spec

npx @openapitools/openapi-generator-cli generate \
-g javascript \
-i ./document/open-api.yaml \
-o ./document/js-openapi-sdk \
-p projectName='js-openapi-sdk' \
-p projectVersion='1.0.0' \
-p npmRepository='https://registry.npmjs.org/' \
--skip-validate-spec

#npm adduser --registry http://registry.npmjs.org
npm publish --access public