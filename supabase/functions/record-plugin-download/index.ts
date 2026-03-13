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
    const { plugin_id, version, device_id } = await req.json();

    if (typeof plugin_id !== "string" || !plugin_id.trim()) {
      return jsonResponse(400, { ok: false, error: "plugin_id is required" });
    }

    if (typeof version !== "string" || !version.trim()) {
      return jsonResponse(400, { ok: false, error: "version is required" });
    }

    if (typeof device_id !== "string" || !uuidPattern.test(device_id)) {
      return jsonResponse(400, { ok: false, error: "device_id must be a UUID" });
    }

    const normalizedPluginId = plugin_id.trim();
    const normalizedVersion = version.trim();

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("plugin_downloads")
      .select("plugin_id")
      .eq("plugin_id", normalizedPluginId)
      .eq("plugin_version", normalizedVersion)
      .eq("device_id", device_id)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      return jsonResponse(200, { ok: true, counted: false });
    }

    const { error } = await supabaseAdmin.from("plugin_downloads").insert({
      plugin_id: normalizedPluginId,
      plugin_version: normalizedVersion,
      device_id,
    });

    if (error) {
      throw error;
    }

    return jsonResponse(200, { ok: true, counted: true });
  } catch (error) {
    console.error("record-plugin-download failed", error);
    return jsonResponse(500, { ok: false, error: "Failed to record plugin download" });
  }
});
