<template>
  <div>
    <el-form :inline="true">
      <el-form-item label="input" @submit.prevent.native="()=>{}">
        <el-input style="width: 300px" size="mini" v-model="input" @keypress.enter="fetchHexInfo"></el-input>
      </el-form-item>
    </el-form>
    <div>
      <pre>
        {{JSON.stringify(info, null, 4)}}
      </pre>
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
    async fetchHexInfo(e) {
      e.preventDefault()
      const info = await rpc(`/stat/devops/hexId?hexId=${this.input}`)
      this.info = info;
    }
  }
}
</script>

<style scoped>

</style>