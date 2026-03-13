import "@supabase/functions-js/edge-runtime.d.ts"
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const { plugin_id, device_id, liked } = await req.json();

    if (typeof plugin_id !== "string" || !plugin_id.trim()) {
      return jsonResponse(400, { ok: false, error: "plugin_id is required" });
    }

    if (typeof device_id !== "string" || !uuidPattern.test(device_id)) {
      return jsonResponse(400, { ok: false, error: "device_id must be a UUID" });
    }

    if (typeof liked !== "boolean") {
      return jsonResponse(400, { ok: false, error: "liked must be a boolean" });
    }

    if (liked) {
      const { error } = await supabaseAdmin
        .from("plugin_likes")
        .upsert({ plugin_id: plugin_id.trim(), device_id }, {
          onConflict: "plugin_id,device_id",
        });

      if (error) {
        throw error;
      }
    } else {
      const { error } = await supabaseAdmin
        .from("plugin_likes")
        .delete()
        .eq("plugin_id", plugin_id.trim())
        .eq("device_id", device_id);

      if (error) {
        throw error;
      }
    }

    return jsonResponse(200, { ok: true, liked });
  } catch (error) {
    console.error("set-plugin-like failed", error);
    return jsonResponse(500, { ok: false, error: "Failed to update plugin like" });
  }
});
