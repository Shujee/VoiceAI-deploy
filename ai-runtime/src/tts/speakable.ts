// Rewrites text just before it's sent to TTS so it is spoken the way a
// person would say it on the phone. The original text is what gets logged,
// kept in the LLM history and saved to the call log - only the audio changes.

// UK postcode: outward (letter(s) + digit + optional letter/digit) + inward
// (digit + two letters), with or without the space.
const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s?(\d[A-Z]{2})\b/g

function spellOut(chars: string): string {
  return chars.split('').join(' ')
}

// 2026-10-14: a test caller said "MK 401 ZM" (four-oh-one); the bot wrote the
// correct "MK40 1ZM", but Cartesia read "MK40" as "MK forty" followed by
// "one Z M", which sounds like "MK41 ZM". The caller kept correcting a
// postcode the bot actually had right. Spelling each character out
// ("M K 4 0, 1 Z M") is how receptionists read postcodes back anyway.
export function toSpeakable(text: string): string {
  return text.replace(UK_POSTCODE, (_match, outward: string, inward: string) =>
    `${spellOut(outward)}, ${spellOut(inward)}`)
}
