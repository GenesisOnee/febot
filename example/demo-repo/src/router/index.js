import { createRouter, createWebHistory } from "vue-router";
import ListView from "../views/ListView.vue";
import FormView from "../views/FormView.vue";
import DetailView from "../views/DetailView.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: ListView },
    { path: "/form", component: FormView },
    { path: "/detail", component: DetailView },
  ],
});
