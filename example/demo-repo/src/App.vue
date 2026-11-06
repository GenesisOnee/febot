<script setup>
import { RouterLink, RouterView } from "vue-router";
</script>

<template>
  <header class="app-header">
    <strong>示例产品 A</strong>
    <nav>
      <RouterLink to="/">订单列表</RouterLink>
      <RouterLink to="/form">新建订单</RouterLink>
      <RouterLink to="/detail">订单详情</RouterLink>
    </nav>
  </header>
  <main class="app-main">
    <RouterView />
  </main>
</template>
