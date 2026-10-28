import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "https://deno.land/x/jose@v4.15.5/index.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const APNS_HOST = Deno.env.get("APNS_ENV") === "sandbox"
  ? "https://api.sandbox.push.apple.com"
  : "https://api.push.apple.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { title, body, audience, org_id, name } = await req.json().catch(() => ({}));
  const keyPem = Deno.env.get("APNS_KEY");
  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const bundleId = Deno.env.get("APNS_BUNDLE_ID") || "ca.shiftcentral.app";
  if (!keyPem || !keyId || !teamId) {
    return new Response(JSON.stringify({ ok: false, reason: "APNs secrets are not set" }), {
      status: 200, headers: { ...cors, "content-type": "application/json" }
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  let query = supabase.from("device_tokens").select("token, user_id, org_id");
  if (org_id) query = query.eq("org_id", org_id);
  const { data: tokens } = await query;
  let list = tokens || [];
  if (!org_id) {
    return new Response(JSON.stringify({ ok: false, reason: "Missing plant" }), {
      status: 200, headers: { ...cors, "content-type": "application/json" }
    });
  }
  if (audience === "leads") {
    const { data: members } = await supabase.from("org_members").select("user_id, role").eq("org_id", org_id);
    const leadIds = new Set((members || []).filter(m => ["owner", "admin", "supervisor"].includes(m.role)).map(m => m.user_id));
    list = list.filter(t => leadIds.has(t.user_id));
  }
  if (audience === "person" && name) {
    const { data: ops } = await supabase.from("operators").select("email").eq("org_id", org_id).ilike("name", name);
    const emails = (ops || []).map(o => (o.email || "").toLowerCase()).filter(Boolean);
    const { data: profiles } = await supabase.from("profiles").select("id, email");
    const ids = new Set((profiles || []).filter(p => emails.includes((p.email || "").toLowerCase())).map(p => p.id));
    list = list.filter(t => ids.has(t.user_id));
  }
  const deviceTokens = list.map(t => t.token).filter(Boolean);
  if (!deviceTokens.length) {
    return new Response(JSON.stringify({ ok: true, sent: 0, total: 0 }), {
      status: 200, headers: { ...cors, "content-type": "application/json" }
    });
  }

  const key = await importPKCS8(keyPem, "ES256");
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(key);

  let sent = 0;
  const errors = [];
  for (const token of deviceTokens) {
    const res = await fetch(`${APNS_HOST}/3/device/${token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10"
      },
      body: JSON.stringify({ aps: { alert: { title: title || "ShiftCentral", body: body || "" }, sound: "default" } })
    });
    if (res.ok) sent += 1;
    else errors.push(await res.text());
  }
  return new Response(JSON.stringify({ ok: true, sent, total: deviceTokens.length, errors }), {
    status: 200, headers: { ...cors, "content-type": "application/json" }
  });
});
