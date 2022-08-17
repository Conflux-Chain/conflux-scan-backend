<template>
  <div>
    <el-button @click="fetList('pruned')" size="mini">Refresh</el-button>
    <el-table :data="list" v-loading="loading"
             @sort-change="sortChange" :default-sort="{ prop: 'pruned', order: 'descending' }">
      <el-table-column label="addressId" prop="addressId"></el-table-column>
      <el-table-column label="type" prop="type"></el-table-column>
      <el-table-column label="pruned" prop="pruned"
                       :sort-orders="['descending', null]" sortable="custom">
        <template slot-scope="d">{{d.row.pruned.toLocaleString()}}</template>
      </el-table-column>
      <el-table-column label="epoch" prop="epoch"></el-table-column>
      <el-table-column label="updatedAt" prop="updatedAt"
                       :sort-orders="['descending', null]" sortable="custom" ></el-table-column>
    </el-table>
  </div>
</template>

<script>
import {rpc} from "@/lib/lib";

export default {
  name: "PruneInfo"
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
    async fetList(orderBy = 'pruned') {
      this.loading = true;
      const list = await rpc(`/stat/devops/prune-info?orderBy=${orderBy}&limit=50`).then(res=>res.data)
      this.list = list.list
      this.loading = false;
    }
  }
}
</script>

<style scoped>

</style>