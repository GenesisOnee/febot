<script setup>
import { ref } from "vue";

const order = ref({ title: "示例订单", desc: "加载中会先显示骨架屏。" });
</script>

<template>
  <article class="detail">
    <h1>{{ order.title }}</h1>
    <p>{{ order.desc }}</p>
  </article>
</template>
