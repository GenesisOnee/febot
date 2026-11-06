<script setup>
import { onMounted, ref } from "vue";
import { fetchOrders } from "../api/list";
import OrderTable from "../components/OrderTable.vue";
import EmptyState from "../components/EmptyState.vue";

const orders = ref([]);
const loading = ref(true);

onMounted(async () => {
  orders.value = await fetchOrders();
  loading.value = false;
});
</script>

<template>
  <div class="list">
    <h2>订单列表</h2>
    <div v-if="loading">加载中…</div>
    <OrderTable v-else-if="orders.length" :rows="orders" />
    <EmptyState v-else text="没有符合条件的订单" />
  </div>
</template>
