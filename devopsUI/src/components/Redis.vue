<template>
  <div>
    <el-form :inline="true" @submit.native.prevent>
      <el-form-item label="">
        <el-button @click="fetchHexInfo" size="mini" type="primary">Refresh</el-button>
      </el-form-item>
    </el-form>
    <el-table :data="list">
      <el-table-column label="name" prop="q"></el-table-column>
      <el-table-column label="length" prop="len"></el-table-column>
    </el-table>
    <div style="">
<!--      <pre class="pre">{{JSON.stringify(info, null, 4)}}</pre>-->
    </div>
  </div>
</template>

<script>
import {rpc} from "@/lib/lib";

export default {
  name: "Redis",
  data() {
    return {
      input:'',
      info: {},
      list:[],
    }
  },
  methods:{
    async fetchHexInfo() {
      const info = await rpc(`/stat/devops/stream-queue-report`).then(res=>res.data)
      this.info = info;
      this.list = info.xLen
    }
  }
}
</script>

<style scoped>
.pre {
  width: 50%;
  margin: 8px;
  padding: 8px;
  text-align: left;
  /*border: #2c3e50 1px solid;*/
}
</style>