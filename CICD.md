1. clone repo（编译服务器）
   git clone git@github.com:Conflux-Chain/conflux-scan-backend.git scan

2. 创建image（编译服务器）
   cd ./scan
   docker build --progress=plain -t scan:2.4.1 .

3. <optional>copy配置文件（scan后端服务器）
   mkdir /scan && cd /scan
   cp pathtofile/Prod.js ./stat/config
   cp pathtofile/local.js ./scan-api/config

4. copy docker-compose.ymal（scan后端服务器）
   cp pathtofile/docker-compose.yaml ./

5. 创建container（scan后端服务器）
   docker compose create api
   docker compose create open_api
   docker compose create compiler

6. 启动container（scan后端服务器）
   docker compose restart api && docker compose logs -n 50 -f api