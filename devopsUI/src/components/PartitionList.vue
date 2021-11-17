<template>
  <div>
    <el-button size="mini" @click="fetchList">Refresh</el-button>
    <el-tabs :active-name="tb">
      <el-tab-pane v-for="item of tbs" :key="item" :label="item">
        <el-table :data="list[item]">
          <el-table-column label="name" prop="TABLE_NAME"></el-table-column>
          <el-table-column label="P" prop="PARTITION_NAME"></el-table-column>
          <el-table-column label="DESC" prop="PARTITION_DESCRIPTION"></el-table-column>
          <el-table-column label="ROWS" prop="TABLE_ROWS"></el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script>
import {rpc} from "@/lib/lib";

export default {
  name: "PartitionList",
  data() {
    return {
      list: {'epoch':[]},
      tbs: [],
      tb: 'epoch',
      rangeParts: [],
    }
  },
  mounted() {
    this.fetchList();
  },
  methods: {
    async fetchList() {
      const res = await rpc('/stat/devops/db-partition')
      // console.log(`res is:`, res)
      const listAll = res.list.filter(t=>t.PARTITION_METHOD !== 'HASH')
      this.rangeParts = listAll;
      Object.keys(this.list).forEach(k=>this.list[k].length = 0)
      listAll.forEach(r=>{
        const arr = this.list[r.TABLE_NAME] || [];
        arr.push(r)
        this.list[r.TABLE_NAME] = arr
        console.log(`  ${r.TABLE_NAME} ${r.PARTITION_METHOD} => ${this.list[r.TABLE_NAME].length}`)
      })
      this.tbs = [...new Set(listAll.map(t=>t.TABLE_NAME))]
      this.tb = this.tbs[0]
      this.$forceUpdate();
    }
  }
}
</script>

<style scoped>

</style>