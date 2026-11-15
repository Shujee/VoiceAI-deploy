<?php

namespace Database\Seeders;

use App\Models\Business;
use App\Models\PhoneNumber;
use Illuminate\Database\Seeder;

/**
 * AQ Garden Care - a REAL client (Luton garden-care / cleaning company),
 * not a demo business. Knowledge base summarised from their own website
 * (https://www.aqgardencare.co.uk/, crawled Oct 2026: home, the six service
 * pages, gallery, contact; the testimonials page is an empty form).
 *
 * Deployable and re-runnable - same command locally and on the GCP VM:
 *
 *   docker compose exec backend php artisan db:seed --class=AqGardenCareSeeder
 *
 * (Don't use a bare `db:seed`: DatabaseSeeder also creates the test user and
 * re-seeds the demo businesses.) ai-runtime fetches the business per call,
 * so no restart is needed after seeding or after editing the KB.
 *
 * NOTE: this uses updateOrCreate on the slug, so re-running OVERWRITES the
 * KB fields below with whatever is in this file - including any edits made
 * to this business in the dashboard since. Treat this file as the source of
 * truth, or stop re-running it once the client's details are final.
 *
 * Client-confirmed policy (updated 2026-10-08): no fixed opening hours - a
 * member of the team calls back; service area is Luton and surrounding
 * areas; ask what the quote is for, then postcode and address; technical
 * questions and quotations are left to the team's callback; never quote
 * prices; signboard-removal requests are passed to the team (2026-10-10). Generic
 * scenarios (appointments, no-shows, complaints, can't-answer questions) live
 * in ai-runtime's buildSystemPrompt.ts, not here; the landline/mobile/email listed on the website may be
 * given out. OAP discounts and the (undetailed) warranty come from the site.
 */
class AqGardenCareSeeder extends Seeder
{
    // Cartesia "Gemma" (British female) - the only Cartesia voice id that
    // has been call-tested. See backend/config/cartesia_voices.php.
    private const GEMMA_VOICE_ID = '62ae83ad-4f6a-430b-af41-a9bede9286ca';

    // The landline Lenonyx forwards to our SIP trunk. Stored in national
    // format; PhoneNumbers::normalize makes 01582437007 / 441582437007 /
    // +441582437007 all match it.
    private const DIALED_NUMBER = '01582437007';

    public function run(): void
    {
        $business = Business::updateOrCreate(
            ['slug' => 'aq-garden-care'],
            [
                'name' => 'AQ Garden Care',
                'voice_id' => self::GEMMA_VOICE_ID,
                'status' => 'active',
                // Switched to the compact principles-only prompt (2026-10-14,
                // see docs/decisions.md): general behaviour (no prices, no
                // promised times, honesty, one question at a time, urgent
                // calls, endings) now comes from the shared compact prompt, so
                // these fields hold only AQ's own facts and AQ-specific asks.
                'prompt_style' => 'compact',
                'services' => "Garden care and exterior cleaning for homes and businesses. Main services (mention only these when asked what we do): gardening and garden maintenance, lawn mowing, hedge and tree cutting, and jet washing of driveways and patios. Also offered if asked: garden cleaning, sealing and restoring block paving, stone, tarmac, concrete and decking, and rubbish removal.",
                'hours' => "No set hours - the team calls back as soon as they can.",
                'pricing' => "No prices over the phone, not even rough ones. Every job gets a free survey and no-obligation quotation. Rates are competitive and OAP discounts are available (mention it to pensioners or if asked about discounts).",
                'policies' => "Area: Luton and surrounding areas - LU postcodes (Luton, Dunstable, Houghton Regis, Leighton Buzzard) and Harpenden (AL5). Elsewhere in Bedfordshire or Hertfordshire (Flitwick, Hitchin, St Albans and similar): say we mainly work around Luton and Bedfordshire and the team can confirm whether we cover it, then take the details. Clearly far away (London, another city): outside our area. For quote requests, the closing should mention the team will be in touch to arrange a free no-obligation quotation. Based at Station House, Midland Road, Luton LU2 0HS; landline 01582 437 007, mobile 07723 183761, email aqgardencare@gmail.com (all fine to give out). Work comes with a warranty; the team explains the terms. If someone asks us to take away our advertising signboard, take their name, where the board is and a number, and say the team will collect it.",
                'products' => null,
                'faq' => null,
            ],
        );

        PhoneNumber::updateOrCreate(
            ['number' => self::DIALED_NUMBER],
            [
                'business_id' => $business->id,
                'label' => 'AQ Garden Care main line (Lenonyx SIP trunk)',
                'is_active' => true,
            ],
        );
    }
}
