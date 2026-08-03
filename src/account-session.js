import { readAuthSession } from "./auth.js";

export const ACCOUNT_STATE_HEADER = "X-Stabilize-Account-State";

function accountMemoryStub(env, accountKey) {
  if (!accountKey) return null;
  if (!env?.SESSIONS || typeof env.SESSIONS.getByName !== "function") {
    return null;
  }
  return env.SESSIONS.getByName("google:" + accountKey);
}

export async function accountSessionAllowed(env, authSession) {
  if (!authSession) return false;
  const stub = accountMemoryStub(env, authSession.accountKey);
  if (!stub || typeof stub.validateSession !== "function") return true;

  const result = await stub.validateSession(authSession.issuedAtMs);
  if (typeof result?.allowed !== "boolean") {
    throw new Error("InvalidSessionValidationResult");
  }
  return result.allowed;
}

export async function readAuthorizedAuthSession(request, env) {
  const authSession = await readAuthSession(request, env);
  if (!authSession) return null;
  return (await accountSessionAllowed(env, authSession))
    ? authSession
    : null;
}
