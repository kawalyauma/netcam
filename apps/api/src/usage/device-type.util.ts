/** Best-effort device family from the browser user agent (seen at login) or the DHCP hostname. */
export function deviceType(userAgent?: string | null, hostname?: string | null): string {
  const ua = (userAgent ?? "").toLowerCase();
  const host = (hostname ?? "").toLowerCase();

  if (/iphone|ipad|ipod/.test(ua) || /iphone|ipad/.test(host)) return "iPhone / iPad";
  if (
    /android/.test(ua) ||
    /^android|galaxy|samsung|tecno|infinix|itel|redmi|xiaomi|oppo|vivo|huawei|honor|nokia|pixel|realme|oneplus|motorola|moto-|hmd/.test(host)
  ) {
    return "Android";
  }
  if (/windows/.test(ua) || /^desktop-|^laptop-|^win-/.test(host)) return "Windows PC";
  if (/macintosh|mac os x/.test(ua) || /macbook|imac|mac-?mini/.test(host)) return "Mac";
  if (/cros|linux/.test(ua)) return "Linux / ChromeOS";
  return "Unknown";
}
