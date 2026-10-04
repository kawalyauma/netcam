import { describe, expect, it } from "vitest";
import { parseConntrack, splitAcrossApps } from "../usage";
import { appForDestination, parseDnsLogLine } from "../dns-log";
import { classifyDomain, classifyUnknown } from "../app-catalog";

describe("classifyDomain", () => {
  it("matches subdomains of known services, specific before generic", () => {
    expect(classifyDomain("rr3---sn-hgn7yn7z.googlevideo.com")).toBe("YouTube");
    expect(classifyDomain("www.google.com")).toBe("Google");
    expect(classifyDomain("mmg.whatsapp.net.")).toBe("WhatsApp");
    expect(classifyDomain("notwhatsapp.net")).toBeUndefined();
  });

  it("labels unknown destinations by protocol", () => {
    expect(classifyUnknown("udp", 3478)).toBe("Voice & video calls");
    expect(classifyUnknown("tcp", 443)).toBe("Other websites");
  });
});

describe("parseConntrack", () => {
  it("reads both directions' byte counters from accounted entries", () => {
    const text =
      "ipv4     2 tcp      6 431999 ESTABLISHED src=10.50.10.66 dst=142.250.1.1 sport=51234 dport=443 packets=10 bytes=1200 " +
      "src=142.250.1.1 dst=192.168.10.157 sport=443 dport=51234 packets=12 bytes=34000 [ASSURED] mark=0 zone=0 use=2\n" +
      "ipv4     2 udp      17 29 src=192.168.10.157 dst=1.1.1.1 sport=1 dport=53 src=1.1.1.1 dst=192.168.10.157 sport=53 dport=1 mark=0 zone=0 use=2\n";
    const flows = parseConntrack(text);
    expect(flows).toHaveLength(1); // the unaccounted entry is skipped
    expect(flows[0]).toEqual(
      expect.objectContaining({ proto: "tcp", src: "10.50.10.66", dst: "142.250.1.1", dport: 443, orig: 1200, reply: 34000 }),
    );
  });
});

describe("splitAcrossApps", () => {
  it("puts bytes conntrack didn't see under Other so apps add up to the billed total", () => {
    const result = splitAcrossApps({ down: 1000, up: 100 }, new Map([["YouTube", { down: 600, up: 40 }]]));
    expect(result.get("YouTube")).toEqual({ down: 600, up: 40 });
    expect(result.get("Other")).toEqual({ down: 400, up: 60 });
  });

  it("scales down when conntrack saw more than was billed", () => {
    const result = splitAcrossApps(
      { down: 500, up: 0 },
      new Map([
        ["YouTube", { down: 600, up: 0 }],
        ["WhatsApp", { down: 400, up: 0 }],
      ]),
    );
    expect(result.get("YouTube")?.down).toBe(300);
    expect(result.get("WhatsApp")?.down).toBe(200);
    expect(result.has("Other")).toBe(false);
  });
});

describe("DNS log attribution", () => {
  it("attributes the final IP of a CNAME chain to the name the device asked for", () => {
    parseDnsLogLine("Oct  4 12:30:01 dnsmasq[1]: 812 10.50.10.66/40112 query[A] www.youtube.com from 10.50.10.66");
    parseDnsLogLine("Oct  4 12:30:01 dnsmasq[1]: 812 10.50.10.66/40112 forwarded www.youtube.com to 192.168.10.1");
    parseDnsLogLine("Oct  4 12:30:01 dnsmasq[1]: 812 10.50.10.66/40112 reply www.youtube.com is <CNAME>");
    parseDnsLogLine("Oct  4 12:30:01 dnsmasq[1]: 812 10.50.10.66/40112 reply youtube-ui.l.google.com is 142.250.185.78");
    expect(appForDestination("10.50.10.66", "142.250.185.78")).toBe("YouTube");
  });

  it("keeps per-client answers apart when two apps share an IP", () => {
    parseDnsLogLine("dnsmasq[1]: 900 10.50.10.70/1 query[A] www.google.com from 10.50.10.70");
    parseDnsLogLine("dnsmasq[1]: 900 10.50.10.70/1 reply www.google.com is 142.250.200.4");
    parseDnsLogLine("dnsmasq[1]: 901 10.50.10.71/1 query[A] i.ytimg.com from 10.50.10.71");
    parseDnsLogLine("dnsmasq[1]: 901 10.50.10.71/1 reply i.ytimg.com is 142.250.200.4");
    expect(appForDestination("10.50.10.70", "142.250.200.4")).toBe("Google");
    expect(appForDestination("10.50.10.71", "142.250.200.4")).toBe("YouTube");
  });
});
