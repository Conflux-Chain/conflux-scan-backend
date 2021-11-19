<template>
  <div>
    <el-form :inline="true" @submit.native.prevent>
      <el-form-item label="input">
        <el-input style="width: 500px" size="mini" v-model="input"></el-input>
        <el-button @click="fetchHexInfo" size="mini" type="primary">Find</el-button>
      </el-form-item>
    </el-form>
    <div style="">
      <pre class="pre">{{JSON.stringify(info, null, 4)}}</pre>
    </div>
  </div>
</template>

<script>
import {rpc} from "@/lib/lib";

export default {
  name: "HexId",
  data() {
    return {
      input:'',
      info: {},
    }
  },
  methods:{
    async fetchHexInfo() {
      const info = await rpc(`/stat/devops/hexId?hexId=${this.input}`)
      this.info = info;
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