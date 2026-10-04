/**
 * Domain suffix -> app name. Traffic is encrypted, so an app is recognised by
 * the hostname a device looked up before connecting. Order matters: the
 * first matching suffix wins, so specific services go before generic ones
 * (YouTube before Google).
 */
const CATALOG: Array<[app: string, suffixes: string[]]> = [
  ["YouTube", ["youtube.com", "googlevideo.com", "ytimg.com", "youtu.be", "youtube-nocookie.com", "youtubei.googleapis.com"]],
  ["WhatsApp", ["whatsapp.net", "whatsapp.com", "wa.me"]],
  ["TikTok", ["tiktok.com", "tiktokv.com", "tiktokcdn.com", "tiktokcdn-us.com", "byteoversea.com", "ibytedtos.com", "ibyteimg.com", "musical.ly", "tiktokw.us", "bytefcdn-oversea.com"]],
  ["Instagram", ["instagram.com", "cdninstagram.com", "ig.me"]],
  ["Facebook", ["facebook.com", "fbcdn.net", "fb.com", "fbsbx.com", "facebook.net", "messenger.com", "m.me"]],
  ["Snapchat", ["snapchat.com", "sc-cdn.net", "snap-dev.net", "snapkit.com", "sc-static.net"]],
  ["X (Twitter)", ["twitter.com", "twimg.com", "x.com", "t.co"]],
  ["Telegram", ["telegram.org", "telegram.me", "t.me", "telesco.pe", "tdesktop.com"]],
  ["Netflix", ["netflix.com", "nflxvideo.net", "nflximg.net", "nflxext.com", "nflxso.net"]],
  ["Showmax", ["showmax.com", "showmax.io"]],
  ["DStv", ["dstv.com", "dstvapps.com", "dstv.stream"]],
  ["Spotify", ["spotify.com", "scdn.co", "spotifycdn.com", "spotilocal.com"]],
  ["Boomplay", ["boomplay.com", "boomplaymusic.com", "boomplay.net"]],
  ["Audiomack", ["audiomack.com"]],
  ["Zoom", ["zoom.us", "zoom.com", "zoomgov.com"]],
  ["Microsoft Teams", ["teams.microsoft.com", "teams.live.com", "skype.com", "lync.com"]],
  ["Betting", ["sportybet.com", "betway.co.ug", "betway.com", "fortebet.ug", "betpawa.ug", "betpawa.com", "1xbet.com", "melbet.com", "premierbet.ug", "betlion.ug", "bet9ja.com"]],
  ["Games", ["roblox.com", "rbxcdn.com", "freefiremobile.com", "garena.com", "pubgmobile.com", "proximabeta.com", "supercell.com", "callofduty.com", "activision.com", "epicgames.com", "steampowered.com", "steamcontent.com", "playstation.net", "xboxlive.com", "minecraft.net"]],
  ["App & OS updates", ["play.googleapis.com", "android.clients.google.com", "gvt1.com", "gvt2.com", "gvt3.com", "windowsupdate.com", "update.microsoft.com", "delivery.mp.microsoft.com", "dl.delivery.mp.microsoft.com", "swcdn.apple.com", "mesu.apple.com", "updates.cdn-apple.com", "appldnld.apple.com", "xiaomi.net", "transsion-os.com", "shalltry.com"]],
  ["Speed test", ["speedtest.net", "ookla.com", "fast.com", "speed.cloudflare.com"]],
  ["Google", ["google.com", "googleapis.com", "gstatic.com", "googleusercontent.com", "google.co.ug", "gmail.com", "googletagmanager.com", "google-analytics.com", "doubleclick.net", "googlesyndication.com", "ggpht.com", "android.com"]],
  ["Apple / iCloud", ["apple.com", "icloud.com", "mzstatic.com", "aaplimg.com", "apple-cloudkit.com", "cdn-apple.com", "itunes.com"]],
  ["Microsoft", ["microsoft.com", "live.com", "office.com", "office.net", "msn.com", "bing.com", "outlook.com", "windows.net", "msftconnecttest.com", "sharepoint.com", "onedrive.com"]],
  ["Amazon", ["amazon.com", "amazonvideo.com", "primevideo.com", "media-amazon.com"]],
  ["Opera", ["opera.com", "opera-api.com", "operacdn.com", "opera-mini.net"]],
  ["News & sites", ["monitor.co.ug", "newvision.co.ug", "chimpreports.com", "nilepost.co.ug", "bbc.co.uk", "bbc.com", "aljazeera.com", "cnn.com", "wikipedia.org"]],
];

const SUFFIX_INDEX: Array<[string, string]> = CATALOG.flatMap(([app, suffixes]) =>
  suffixes.map((s) => [s, app] as [string, string]),
);

/** Returns the app a hostname belongs to, or undefined when it isn't a known service. */
export function classifyDomain(hostname: string): string | undefined {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  for (const [suffix, app] of SUFFIX_INDEX) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return app;
  }
  return undefined;
}

/** Traffic whose destination we never saw a DNS lookup for, labelled by protocol where that's telling. */
export function classifyUnknown(protocol: string, port: number): string {
  if (protocol === "udp" && (port === 3478 || port === 3479 || port === 19302 || (port >= 50000 && port <= 59999))) {
    return "Voice & video calls";
  }
  if (port === 443 || port === 80) return "Other websites";
  return "Other";
}
