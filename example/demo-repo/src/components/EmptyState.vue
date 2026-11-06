<script setup>
defineProps({
  text: { type: String, default: "暂无数据" },
});
</script>

<template>
  <p class="empty">{{ text }}</p>
</template>
