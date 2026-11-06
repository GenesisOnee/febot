<script setup>
import { reactive } from "vue";

const form = reactive({ name: "", email: "", reason: "" });
</script>

<template>
  <form @submit.prevent>
    <input v-model="form.name" placeholder="姓名" />
    <input v-model="form.email" placeholder="邮箱" />
    <button>提交</button>
  </form>
</template>
