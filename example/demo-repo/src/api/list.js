import { get } from "./request";

export function fetchOrders() {
  return get("/api/orders");
}
