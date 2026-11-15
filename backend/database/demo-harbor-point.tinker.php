// One-off demo-data script, NOT a migration or seeder (so `artisan migrate`/
// `db:seed` never pick it up on their own) - piped into `artisan tinker` to
// quickly create the "Harbor Point Plumbing & Heating" demo business for
// the demo video, via Eloquent rather than hand-written SQL so the faq/
// products JSON columns (see Business::casts()) and timestamps are handled
// automatically instead of risking a hand-typed JSON/SQL mismatch.
//
// Run from the repo root (Windows PowerShell):
//   Get-Content backend\database\demo-harbor-point.tinker.php -Raw | docker compose exec -T backend php artisan tinker
//
// Safe to re-run: `updateOrCreate` on the slug means running it twice just
// updates the same business instead of erroring on the unique slug/number.
//
// Deliberately NO leading `<?php` tag: tinker's stdin REPL is already
// inside a PHP evaluation context, so a leading `<?php` itself gets fed to
// it as code and fails with "Syntax error, unexpected '<'" (hit this on
// the first version of this file) - just plain statements below.

$business = \App\Models\Business::updateOrCreate(
    ['slug' => 'harbor-point-plumbing'],
    [
        'name' => 'Harbor Point Plumbing & Heating',
        // Cartesia's "Gemma" voice id - same one every other demo-video
        // business sets explicitly (see BusinessSeeder::GEMMA_VOICE_ID:
        // oakley-driveways, mnc-paving, millers-roofing, trinity-drives,
        // county-fascias-guttering, sterling-construction). Functionally a
        // no-op today - CartesiaTTS.ts's DEFAULT_VOICE_ID a null/invalid
        // voice_id falls back to is this same id - but set explicitly
        // anyway so Harbor Point doesn't silently depend on that fallback
        // matching Gemma by coincidence, and so it reads consistently next
        // to the rest of the demo lineup.
        'voice_id' => '62ae83ad-4f6a-430b-af41-a9bede9286ca',
        'services' => 'Emergency plumbing repairs, boiler servicing and repair, blocked drains and toilets, leak detection and fixing, bathroom and kitchen plumbing installs, central heating system checks and power flushing.',
        'hours' => "Mon-Fri 7:30am-6pm, Sat 8am-1pm. 24/7 emergency call-out available for burst pipes, no heating, or major leaks - ask us and we'll flag it as urgent.",
        'pricing' => 'Standard call-out fee is £45, which is credited against the job if you go ahead. Most repairs are quoted on-site before any work starts. Emergency out-of-hours call-outs carry a £30 uplift. Boiler servicing starts at £90.',
        'policies' => 'We always give a fixed price before starting any work - no surprises on the invoice. For non-emergency jobs, the team will call back to arrange a time as soon as one is free. All work carries a 12-month workmanship guarantee. We ask for a rough description of the issue up front so the right engineer and parts are sent out the first time.',
        'faq' => [
            ['question' => 'Do you charge for quotes?', 'answer' => "The call-out itself is £45, but that's credited toward the job if you go ahead - there's no separate charge just to come look and quote."],
            ['question' => 'Can you come out today?', 'answer' => "For emergencies like burst pipes or no heating, yes - we prioritise those same-day. For routine jobs we'll get someone out as soon as we can and confirm a time with you."],
            ['question' => 'Do you work on boilers of all makes?', 'answer' => 'Yes, our engineers are Gas Safe registered and service and repair all major boiler brands.'],
            ['question' => 'Is there a guarantee on the work?', 'answer' => 'Every job comes with a 12-month workmanship guarantee.'],
            ['question' => 'Do you charge more for evenings or weekends?', 'answer' => 'Only for genuine emergency out-of-hours call-outs, which carry a £30 uplift over the standard fee - Saturday morning hours (8am-1pm) are billed at the normal rate.'],
        ],
        'products' => [
            ['name' => 'Standard call-out', 'price' => '£45', 'availability' => 'Available Mon-Sat during business hours'],
            ['name' => 'Emergency call-out', 'price' => '£75', 'availability' => 'Available 24/7 for burst pipes, no heating, major leaks'],
            ['name' => 'Boiler service', 'price' => 'from £90', 'availability' => 'Book ahead, usually within the week'],
        ],
    ]
);

\App\Models\PhoneNumber::updateOrCreate(
    ['number' => '+447700900123'],
    ['business_id' => $business->id, 'label' => 'Demo line', 'is_active' => true]
);

echo "Created/updated business #{$business->id} ({$business->slug})\n";
