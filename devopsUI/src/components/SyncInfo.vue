<template>
  <div>
    <el-button @click="fetList()" size="mini">Refresh</el-button>
    <el-table :data="list" v-loading="loading"
             >
      <el-table-column label="name" prop="name"></el-table-column>
      <el-table-column label="type" prop="type"></el-table-column>
      <el-table-column label="epoch" prop="epoch">
        <template slot-scope="d">{{d.row.pruned.toLocaleString()}}</template>
      </el-table-column>
      <el-table-column label="time">
        <template slot-scope="d">{{ (d.row.createdAt || d.row.timestamp).toISOString()}}</template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script>
import {rpc} from "@/lib/lib";

export default {
  name: "SyncInfo"
  ,data() {
    return {
      list: [],
      loading: false,
    }
  },
  props: {
    type: {}
  },
  mounted() {
  }
  ,methods: {
    sortChange({ /*column, */prop/*, order*/ }) {
      this.fetList(prop)
    },
    async fetList() {
      this.loading = true;
      const result = await rpc(`/stat/devops/sync-max-epoch`)
      this.list = result.list
      this.loading = false;
    }
  }
}
</script>

<style scoped>

</style>