<template>
  <div>
    <el-button @click="fetList" size="mini">Refresh</el-button>
    <el-table :data="list">
      <el-table-column label="hex40id" prop="hex40id"></el-table-column>
      <el-table-column label="name" prop="name"></el-table-column>
      <el-table-column label="symbol" prop="symbol"></el-table-column>
      <el-table-column label="address" prop="address"></el-table-column>
      <el-table-column label="transfer" prop="transferCount"></el-table-column>
    </el-table>
  </div>
</template>

<script>
import {rpc} from "@/lib/lib";

export default {
  name: "TokenList"
  ,data() {
    return {
      list: []
    }
  },
  props: {
    type: {}
  },
  mounted() {
  }
  ,methods: {
    async fetList() {
      const list = await rpc(`/stat/tokens/list?orderBy=transferCount&reverse=true&transferType=${this.type}&limit=100`)
      this.list = list.list
    }
  }
}
</script>

<style scoped>

</style>