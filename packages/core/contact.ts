/**
 * The agency's contact points, in one place so the site, and later the mobile
 * app, cannot drift apart. The phone line and the business WhatsApp are two
 * different numbers.
 */
export const PHONE_E164 = "+919804786498";
export const PHONE_DISPLAY = "+91 98047 86498";

/** Business WhatsApp, digits only as wa.me expects. */
export const WHATSAPP_NUMBER = "916290855027";
export const WHATSAPP_DISPLAY = "+91 62908 55027";

export function whatsappLink(text?: string): string {
  const base = `https://wa.me/${WHATSAPP_NUMBER}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
