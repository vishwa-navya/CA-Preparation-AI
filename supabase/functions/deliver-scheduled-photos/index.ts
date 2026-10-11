import { createClient } from "npm:@supabase/supabase-js@2.51.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const firebaseApiKey = "AIzaSyCJB10ot9q_6KpI_borDB987gZWuidX40I";
const fireStoreUrl = "https://firestore.googleapis.com/v1/projects/vishwanavya-72a92/databases/(default)/documents/privateMessages";
const notificationUrl = "https://notification-1-7zzu.onrender.com/send";

type ScheduledPhoto = { id: string; sender_nickname: string; recipient_nickname: string; photo_url: string; file_name: string; attempts: number };
const value = (stringValue: string) => ({ stringValue });

async function deliver(row: ScheduledPhoto): Promise<void> {
  const documentName = `scheduled_${row.id}`;
  const response = await fetch(`${fireStoreUrl}/${documentName}?key=${firebaseApiKey}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: {
      by: value(row.sender_nickname), type: value("image"), ts: { timestampValue: new Date().toISOString() }, to: value("all"),
      imageUrl: value(row.photo_url), fileName: value(row.file_name), text: value(""), clientTimestamp: value(new Date().toISOString()),
      replyTo: { nullValue: "NULL_VALUE" }, moodMetadata: { nullValue: "NULL_VALUE" }, seenBy: { arrayValue: { values: [] } }, deletedFor: { arrayValue: { values: [] } },
    } }),
  });
  if (!response.ok) throw new Error(`Firestore delivery failed (${response.status})`);

  await admin.from("scheduled_photo_messages").update({ status: "delivered", delivered_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null }).eq("id", row.id).eq("status", "processing");
  try {
    await fetch(notificationUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: `📷 Scheduled photo delivered from ${row.sender_nickname} to ${row.recipient_nickname}` }) });
    await admin.from("scheduled_photo_messages").update({ notification_sent_at: new Date().toISOString() }).eq("id", row.id);
  } catch (error) {
    console.error("scheduled photo notification failed", error);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const { data: rows, error } = await admin.rpc("claim_due_scheduled_photos", { p_limit: 20 });
    if (error) throw error;
    const results = { claimed: rows?.length ?? 0, delivered: 0, retried: 0 };
    for (const row of (rows ?? []) as ScheduledPhoto[]) {
      try {
        await deliver(row);
        results.delivered += 1;
      } catch (error) {
        const attempts = row.attempts ?? 1;
        const failed = attempts >= 10;
        await admin.from("scheduled_photo_messages").update({ status: failed ? "failed" : "pending", next_attempt_at: new Date(Date.now() + Math.min(60 * 60 * 1000, 2 ** attempts * 60 * 1000)).toISOString(), last_error: "Temporary delivery failure", updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "processing");
        console.error("scheduled photo delivery failed", error);
        results.retried += 1;
      }
    }
    return new Response(JSON.stringify(results), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("deliver-scheduled-photos failed", error);
    return new Response(JSON.stringify({ error: "Delivery worker failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
