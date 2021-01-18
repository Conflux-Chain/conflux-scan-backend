# Typescript, how to
## install dependencies
`npm install`
OR
`cnpm install` if you have GFW issues.
## Compile *.ts
Under the root folder of this repository, run
`npx tsc -p stat`
# Run the miner tool
`node ./stat/template.js`

# MySQL in Docker if needed
docker pull mysql:5.7.32
docker run -p 3306:3306 --name scan-mysql -e MYSQL_ROOT_PASSWORD=Scan@9527# -d mysql:5.7.32
docker exec -it scan-mysql bash