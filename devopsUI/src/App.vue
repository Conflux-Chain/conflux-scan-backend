<template>
  <div id="app">
    <div>Host:
      {{host}}
    </div>
    <el-tabs :active-name="tb">
      <el-tab-pane label="ERC20" name="ERC20">
        <TokenList type="ERC20"></TokenList>
      </el-tab-pane>
      <el-tab-pane label="ERC721" name="ERC721">
        <TokenList type="ERC721"></TokenList>
      </el-tab-pane>
      <el-tab-pane label="ERC1155" name="ERC1155">
        <TokenList type="ERC1155"></TokenList>
      </el-tab-pane>
      <el-tab-pane label="PartitionList" name="PartitionList">
        <PartitionList></PartitionList>
      </el-tab-pane>
      <el-tab-pane label="PruneInfo" name="PruneInfo">
        <PruneInfo></PruneInfo>
      </el-tab-pane>
      <el-tab-pane label="HexId" name="HexId">
        <HexId></HexId>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script>
// import HelloWorld from './components/HelloWorld.vue'
import PartitionList from "@/components/PartitionList";
import TokenList from "@/components/TokenList";
import PruneInfo from "@/components/PruneInfo";
import HexId from "@/components/HexId";
import {host, setHost} from "@/lib/lib"

export default {
  name: 'app',
  data() {
    return {
      tb: 'token',
      host: host,
    }
  },
  components: {
    HexId,
    PruneInfo,
    TokenList,
    PartitionList,
    // HelloWorld
  },
  mounted() {
    //console.log(` env ${process.env}`, process.env)
    //setHost(process.env.VUE_APP_HOST)
  }
}
</script>

<style>
#app {
  font-family: 'Avenir', Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>
