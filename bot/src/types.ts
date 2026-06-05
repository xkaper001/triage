export interface BotEnv {
  DISCORD_BOT_TOKEN: string;
  KESTRA_CLOUD_URL: string;
  KESTRA_NAMESPACE: string;
  KESTRA_TRIAGE_WEBHOOK_KEY: string;
  KESTRA_ALERT_WEBHOOK_KEY: string;
  KESTRA_CONFIG_WEBHOOK_KEY: string;
}

export function loadEnv(): BotEnv {
  const required = [
    "DISCORD_BOT_TOKEN",
    "KESTRA_CLOUD_URL",
    "KESTRA_NAMESPACE",
    "KESTRA_TRIAGE_WEBHOOK_KEY",
    "KESTRA_ALERT_WEBHOOK_KEY",
    "KESTRA_CONFIG_WEBHOOK_KEY",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);

  return {
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN!,
    KESTRA_CLOUD_URL: process.env.KESTRA_CLOUD_URL!,
    KESTRA_NAMESPACE: process.env.KESTRA_NAMESPACE!,
    KESTRA_TRIAGE_WEBHOOK_KEY: process.env.KESTRA_TRIAGE_WEBHOOK_KEY!,
    KESTRA_ALERT_WEBHOOK_KEY: process.env.KESTRA_ALERT_WEBHOOK_KEY!,
    KESTRA_CONFIG_WEBHOOK_KEY: process.env.KESTRA_CONFIG_WEBHOOK_KEY!,
  };
}

type FlowId = "triage" | "alert" | "config";

const FLOW_MAP: Record<FlowId, { key: keyof BotEnv; flowId: string }> = {
  triage: { key: "KESTRA_TRIAGE_WEBHOOK_KEY", flowId: "discord_triage" },
  alert:  { key: "KESTRA_ALERT_WEBHOOK_KEY",  flowId: "triage_draft_alert" },
  config: { key: "KESTRA_CONFIG_WEBHOOK_KEY", flowId: "update_config" },
};

export function webhookUrl(env: BotEnv, flow: FlowId): string {
  const { key, flowId } = FLOW_MAP[flow];
  return `${env.KESTRA_CLOUD_URL}/api/v1/main/executions/webhook/${env.KESTRA_NAMESPACE}/${flowId}/${env[key]}`;
}
