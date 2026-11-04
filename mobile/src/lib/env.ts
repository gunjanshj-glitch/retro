import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; whatsapp?: string };

export const API_URL = extra.apiUrl ?? "https://retroholidays.in/api/v1";
export const SITE_URL = new URL(API_URL).origin;
export const WHATSAPP = extra.whatsapp ?? "916290855027";
export const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";
