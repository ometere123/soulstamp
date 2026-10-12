import assert from "node:assert/strict";
import test from "node:test";
import worker from "../../backend/index.js";

const baseEnv = {
  DISCORD_CLIENT_ID: "client-id",
  DISCORD_CLIENT_SECRET: "client-secret",
  DISCORD_REDIRECT_URI: "https://worker.example/api/discord/callback",
  PUBLIC_BASE_URL: "https://worker.example",
  FRONTEND_ORIGIN: "https://frontend.example",
};

test("OAuth routes fail closed when the Worker signing secret is absent", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/api/discord/start?wallet=0x1111111111111111111111111111111111111111"),
    baseEnv,
  );
  assert.equal(response.status, 500);
  assert.match(await response.text(), /BACKEND_SESSION_SECRET/);
});

test("OAuth state is signed when a sufficiently strong secret is configured", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/api/discord/start?wallet=0x1111111111111111111111111111111111111111&return_to=https%3A%2F%2Ffrontend.example%2F"),
    { ...baseEnv, BACKEND_SESSION_SECRET: "s".repeat(32) },
  );
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /^https:\/\/discord\.com\/oauth2\/authorize/);
});
