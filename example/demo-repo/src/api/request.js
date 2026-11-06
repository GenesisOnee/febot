// 示例仓不连真实后端，用内存数据模拟一次请求延迟。
const ORDERS = [
  { id: 1, title: "订单 A", status: "pending" },
  { id: 2, title: "订单 B", status: "done" },
  { id: 3, title: "订单 C", status: "pending" },
];

export function get(pathname) {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (pathname.startsWith("/api/orders/")) {
        const id = Number(pathname.split("/").pop());
        resolve(ORDERS.find((o) => o.id === id) ?? null);
        return;
      }
      resolve(ORDERS);
    }, 300);
  });
}
