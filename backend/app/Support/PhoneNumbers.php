<?php

namespace App\Support;

// Shared number normalization so a phone number can be compared for
// equality regardless of how it was typed/dialed - used both by
// BusinessController::showByPhone (matching a dialed SIP number against
// phone_numbers.number) and, as a fast-follow noted in the routing plan,
// eventually at write time in PhoneNumberController to stop two
// differently-formatted-but-equivalent numbers from being stored as if
// they were different rows.
class PhoneNumbers
{
    public static function normalize(string $raw): string
    {
        $digits = preg_replace('/\D+/', '', $raw) ?? '';

        // Strip a NANP country-code "1" prefix (11 digits -> 10) so
        // "+15551234567", "15551234567" and "5551234567" all normalize to
        // the same value. Left alone below 11 digits so short LAN-POC
        // test numbers (setup-sip.ts's own example dials extension "100")
        // normalize to themselves rather than being mangled.
        if (strlen($digits) === 11 && $digits[0] === '1') {
            $digits = substr($digits, 1);
        }

        // UK numbers: national "01582437007", international "441582437007" /
        // "+441582437007" and IDD "00441582437007" all normalize to the same
        // national-format value, so it doesn't matter which form a carrier sends
        // in the dialed-number header or which form was typed into the dashboard.
        // (Matching normalizes both sides at compare time, so no stored data needs
        // migrating.)
        if (str_starts_with($digits, '0044') && strlen($digits) === 14) {
            $digits = '0' . substr($digits, 4);
        } elseif (str_starts_with($digits, '44') && strlen($digits) === 12) {
            $digits = '0' . substr($digits, 2);
        }

        return $digits;
    }
}
