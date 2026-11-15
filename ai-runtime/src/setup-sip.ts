import 'dotenv/config'
import { SipClient } from 'livekit-server-sdk'

// One-off / re-runnable setup script for LiveKit SIP. Creates exactly
// one inbound trunk and one dispatch rule.
//
// The dispatch rule is `type: 'individual'` (see the "Concurrent,
// multi-tenant call handling" plan this was changed under) - LiveKit
// creates a brand-new room per inbound call, named `<roomPrefix><caller
// number>-<random>`, instead of every call joining one fixed shared
// room. ai-runtime (test-token.ts) finds out about each new room via a
// LiveKit webhook (see infra/livekit/livekit.yaml's `webhook:` block and
// test-token.ts's runCallSession()), not by joining a room at boot -
// this is what actually makes more than one simultaneous call possible.
//
// Run with: pnpm exec tsx src/setup-sip.ts  (inside the ai-runtime
// container/environment, so LIVEKIT_URL/API_KEY/API_SECRET are set).
//
// Always deletes and recreates the trunk/dispatch rule by name rather
// than reusing a stale one - this script gets re-run as the SIP setup is
// tuned, and a partially-updated existing trunk (e.g. old allowedAddresses)
// silently not matching the current config has already cost real
// debugging time once this session; recreate-from-scratch avoids that
// class of bug at the cost of a few extra API calls per run.
//
// IMPORTANT topology note: calls now arrive at livekit-sip from the
// sip-registrar (Kamailio) container over the internal docker network,
// NOT directly from the phone - Linphone Android refuses to unlock its
// dialer without a successful REGISTER, and livekit-sip deliberately
// never implements REGISTER, so Kamailio sits in front to satisfy that
// and relays everything else to livekit-sip (see infra/kamailio/kamailio.cfg
// and docker-compose.yml). That means the inbound trunk's allowedAddresses
// must cover the docker bridge subnet the sip-registrar container is on,
// NOT the phone's LAN subnet - the phone's own IP is no longer what
// livekit-sip ever sees.

const apiKey = process.env.LIVEKIT_API_KEY
const apiSecret = process.env.LIVEKIT_API_SECRET

if (!apiKey || !apiSecret)
  throw new Error('LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not configured')

// SipClient talks to LiveKit server's HTTP API (same host:port as the
// WebSocket room URL, different scheme) to register trunk/dispatch config
// - it does NOT talk to the sip container directly. The sip container
// picks this config up from LiveKit via Redis on its own.
const wsUrl = process.env.LIVEKIT_URL ?? 'ws://livekit:7880'
const apiHost = wsUrl.replace(/^ws/, 'http')

const ROOM_PREFIX = process.env.LIVEKIT_ROOM_PREFIX ?? 'call-'
const TRUNK_NAME = 'poc-lan-inbound'
const DISPATCH_RULE_NAME = 'poc-individual-per-call'

// numbers: [] (accept a call to any dialed number) requires EITHER
// auth username/password OR allowedAddresses on the trunk. Docker's
// default bridge network subnet isn't fixed/known ahead of time, so
// rather than guess it, we allow the whole RFC1918 172.16.0.0/12 block
// Docker bridge networks are conventionally assigned from, PLUS this
// machine's own LAN /24 as a harmless leftover from before the registrar
// was added. This is permissive - acceptable only because this has so
// far only ever been a local dev/demo box, never exposed to the
// internet as-is.
//
// BEFORE GOING LIVE with a real SIP trunk provider (e.g. Telnyx, per
// docs/gcp-deployment.md): both of these need real values instead of
// this LAN/dev default.
//   - allowedAddresses should be the provider's published SIP signaling
//     IP ranges (check their current docs at setup time), not this
//     permissive RFC1918 block - Kamailio still blind-relays every
//     INVITE regardless (see kamailio.cfg), so this trunk's
//     allowedAddresses is the only thing actually gatekeeping who can
//     originate a call.
//   - the trunk's numbers array (see SIP_TRUNK_NUMBERS below, empty by
//     default = accept any dialed number) should list the client's
//     actual purchased DIDs, comma-separated, once known.
const lanIp = process.env.SIP_LAN_IP ?? '192.168.1.5'
const lanCidr = `${lanIp.split('.').slice(0, 3).join('.')}.0/24`
const dockerCidr = process.env.SIP_TRUNK_DOCKER_CIDR ?? '172.16.0.0/12'
// Lenonyx (UK SIP trunk provider) source IPs. 46.37.165.14 is the SIP/RTP IP they
// gave for the live trunk; 46.37.165.16 was their earlier "likely" answer - both
// allowed until they confirm which one calls really originate from. Always
// appended to the default list; set ALLOWED_SIP_CIDRS to override everything.
const providerCidrs = ['46.37.165.14/32', '46.37.165.16/32']
const allowedAddresses = (process.env.ALLOWED_SIP_CIDRS ?? [dockerCidr, lanCidr, ...providerCidrs].join(','))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
const trunkNumbers = (process.env.SIP_TRUNK_NUMBERS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

async function main() {
  const sip = new SipClient(apiHost, apiKey, apiSecret)

  const existingTrunks = await sip.listSipInboundTrunk()
  for (const t of existingTrunks) {
    if (t.name === TRUNK_NAME) {
      console.log(`[SIP setup] Deleting existing inbound trunk: ${t.sipTrunkId}`)
      await sip.deleteSipTrunk(t.sipTrunkId)
    }
  }

  const trunk = await sip.createSipInboundTrunk(TRUNK_NAME, trunkNumbers, {
    allowedAddresses,
  })
  console.log(
    `[SIP setup] Created inbound trunk: ${trunk.sipTrunkId} ` +
    `(calls allowed from: ${allowedAddresses.join(', ')})`,
  )

  const existingRules = await sip.listSipDispatchRule()
  for (const r of existingRules) {
    if (r.name === DISPATCH_RULE_NAME) {
      console.log(`[SIP setup] Deleting existing dispatch rule: ${r.sipDispatchRuleId}`)
      await sip.deleteSipDispatchRule(r.sipDispatchRuleId)
    }
  }

  const rule = await sip.createSipDispatchRule(
    {
      type: 'individual',
      roomPrefix: ROOM_PREFIX,
    },
    {
      name: DISPATCH_RULE_NAME,
      trunkIds: [trunk.sipTrunkId],
    },
  )
  console.log(
    `[SIP setup] Created dispatch rule: ${rule.sipDispatchRuleId} -> a new ` +
    `'${ROOM_PREFIX}*' room per call`,
  )

  console.log('')
  console.log('[SIP setup] Done. On Linphone (Android):')
  console.log(`  1. Add a manual SIP account - domain/server = ${lanIp}, transport UDP,`)
  console.log('     any username/password (sip-registrar accepts any REGISTER, no auth).')
  console.log('  2. Once it shows connected/registered, dial any number, e.g. 100.')
  console.log('If it still fails, check both:')
  console.log('    docker compose logs sip-registrar --tail 50')
  console.log('    docker compose logs sip --tail 50')
}

main().catch(error => {
  console.error('[SIP setup] Failed:', error)
  process.exit(1)
})
