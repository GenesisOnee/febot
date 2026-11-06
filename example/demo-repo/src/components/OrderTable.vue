<script setup>
import { ORDER_STATUS_LABEL } from "../constants/order";

defineProps({
  rows: { type: Array, default: () => [] },
});
</script>

<template>
  <table class="order-table">
    <thead>
      <tr>
        <th>ID</th>
        <th>标题</th>
        <th>状态</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="row.id">
        <td>{{ row.id }}</td>
        <td>{{ row.title }}</td>
        <td>{{ ORDER_STATUS_LABEL[row.status] ?? row.status }}</td>
      </tr>
    </tbody>
  </table>
</template>
