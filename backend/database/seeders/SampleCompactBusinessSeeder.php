<?php

namespace Database\Seeders;

use App\Models\Business;
use App\Models\PhoneNumber;
use Illuminate\Database\Seeder;

/**
 * Kestrel Paving & Roofing - a FICTIONAL sample business (2026-10-14) for
 * trialling the compact, principles-only system prompt (prompt_style =
 * 'compact', see ai-runtime's buildCompactSystemPrompt) against the long
 * standard one. Deliberately a different trade from AQ Garden Care, and with
 * deliberately short business details, to check the principles carry over
 * without scenario-specific instructions.
 *
 * Reachable locally from MicroSIP by dialling extension 300 (like the ABC
 * Contractors demo on 200). Not a real company: the details below are made
 * up, so anything not listed here should get the "the team can help with
 * that" fallback.
 *
 *   docker compose exec backend php artisan db:seed --class=SampleCompactBusinessSeeder
 */
class SampleCompactBusinessSeeder extends Seeder
{
    // Cartesia "Gemma" - the call-tested default voice.
    private const GEMMA_VOICE_ID = '62ae83ad-4f6a-430b-af41-a9bede9286ca';

    private const EXTENSION = '300';

    public function run(): void
    {
        $business = Business::updateOrCreate(
            ['slug' => 'kestrel-paving-roofing'],
            [
                'name' => 'Kestrel Paving & Roofing',
                'voice_id' => self::GEMMA_VOICE_ID,
                'prompt_style' => 'compact',
                'status' => 'active',
                'services' => 'Driveways (block paving, resin and tarmac), patios, and roof repairs for homes. Free, no-obligation quotes after a visit.',
                'hours' => 'Office Monday to Friday, 8am to 5pm. Messages are passed to the team, who call back as soon as they can.',
                'pricing' => 'No prices over the phone, not even rough ones - every job is quoted after a free visit.',
                'policies' => 'Area: Milton Keynes and nearby towns - postcodes starting MK (Milton Keynes, Bedford, Newport Pagnell, Buckingham) or LU7 (Leighton Buzzard). Anywhere else is outside our area. Roof leaks are passed on as urgent.',
                'faq' => null,
                'products' => null,
            ],
        );

        PhoneNumber::updateOrCreate(
            ['number' => self::EXTENSION],
            [
                'business_id' => $business->id,
                'label' => 'Kestrel sample - MicroSIP extension (compact prompt trial)',
                'is_active' => true,
            ],
        );
    }
}
