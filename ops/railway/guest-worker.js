import guest from "../../src/index.js";
export { OpenAITokenBudget } from "../../src/openai-token-budget.js";

export default {
  fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") return new Response("ok");
    if (path !== "/api/chat") return new Response("Not found", { status: 404 });
    // Staging accepts anonymous chat only. Never forward account cookies.
    const headers = new Headers(request.headers);
    headers.delete("Cookie");
    headers.delete("Authorization");
    return guest.fetch(new Request(request, { headers }), env, ctx);
  },
};
