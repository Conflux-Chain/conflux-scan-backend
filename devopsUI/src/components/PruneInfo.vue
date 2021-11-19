<template>
  <div>
    <el-button @click="fetList" size="mini">Refresh</el-button>
    <el-table :data="list">
      <el-table-column label="addressId" prop="addressId"></el-table-column>
      <el-table-column label="type" prop="type"></el-table-column>
      <el-table-column label="pruned" prop="pruned"></el-table-column>
      <el-table-column label="epoch" prop="epoch"></el-table-column>
      <el-table-column label="updatedAt" prop="updatedAt"></el-table-column>
    </el-table>
  </div>
</template>

<script>
import {rpc} from "@/lib/lib";

export default {
  name: "PruneInfo"
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
      const list = await rpc(`/stat/devops/prune-info`)
      this.list = list.list
    }
  }
}
</script>

<style scoped>

</style>