<?php

namespace Database\Seeders;

use App\Models\Business;
use App\Models\PhoneNumber;
use Illuminate\Database\Seeder;

class BusinessSeeder extends Seeder
{
    // Demo business for the POC - matches the persona the LLM system prompt
    // used to hardcode ("XYZ"). Replace/add rows for real customers once
    // this moves past a single-agent demo.

    // Cartesia's "Gemma" voice - the only Cartesia voice id confirmed
    // working as of the 2026-09-02 switch from Rime (see
    // backend/config/cartesia_voices.php and ai-runtime/src/tts/
    // CartesiaTTS.ts's DEFAULT_VOICE_ID). Every business below uses this
    // same id for now, so they'll all sound identical until more
    // Cartesia voice ids (Archie/Benedict/Claire, or others from
    // https://play.cartesia.ai/voices) are collected and assigned
    // per-business the way the old Rime ids were.
    private const GEMMA_VOICE_ID = '62ae83ad-4f6a-430b-af41-a9bede9286ca';

    public function run(): void
    {

        // Second demo business - a general trades/home-services contractor
        // (driveways, paving, roofing). Modeled directly on real call
        // recordings a client shared of their own phone line: callers ask
        // for a free quote/estimate, follow up on jobs already booked or
        // completed, or ask for a specific person by name. Unlike 'xyz'
        // this has no products - trades quotes are priced on-site, not off
        // a catalog - which also exercises the KB rendering with that
        // field genuinely absent.
        Business::updateOrCreate(
            ['slug' => 'abc-contractors'],
            [
                'name' => 'ABC Contractors',
                'services' => 'Driveway installation and resurfacing, block paving, patio and pathway laying, and roof repairs (flat and pitched). Every job starts with a free, no-obligation site estimate.',
                'hours' => 'Monday to Friday, 8 AM to 5 PM. Closed weekends and public holidays. Site visits and call-backs are scheduled within these hours.',
                'pricing' => 'We don\'t give prices over the phone - driveway, paving, and roofing costs depend entirely on the size and condition of the job, so every quote starts with a free on-site estimate. Repairs to work we\'ve already completed are assessed case-by-case once we hear what\'s wrong.',
                'policies' => 'We cover the local area and surrounding towns. A same-day site visit is not guaranteed - our surveyors are often out on other jobs, and we call back to arrange a time as soon as one is free.',
                'products' => null,
                'faq' => [
                    ['question' => 'Do you offer free estimates?', 'answer' => 'Yes - every quote starts with a free, no-obligation site visit.'],
                    ['question' => 'How soon can someone come out to quote?', 'answer' => 'It depends on our surveyors\' schedules - we call to arrange a time as soon as one is free.'],
                    ['question' => 'Do you fix a job you\'ve already done for me if something goes wrong?', 'answer' => 'Yes - let us know what the issue is and we\'ll arrange for someone to come take a look.'],
                    ['question' => 'What areas do you cover?', 'answer' => 'The local area and surrounding towns - ask and we can confirm for a specific postcode.'],
                ],
            ],
        );
        Business::updateOrCreate(
            ['slug' => 'xyz'],
            [
                'name' => 'XYZ Computer Services',
                'services' => 'PC upgrades and repairs, virus and malware removal, home network setup, data backup and recovery, hardware component sales, and custom-built PCs.',
                'hours' => 'Monday to Friday, 9 AM to 6 PM. Closed on weekends and public holidays.',
                'pricing' => 'Diagnostics are free. Standard repairs start at $49; upgrades are quoted after diagnostics based on parts. See the product list for component pricing, and the FAQ for custom PC build pricing.',
                'policies' => 'We work on customer-owned hardware, and we also sell hardware components and custom-built PCs directly. A same-day appointment is not guaranteed - we schedule based on availability. Custom PC quotes given over the phone are estimates - final price is confirmed once the exact build is chosen.',
                'products' => [
                    ['name' => 'AMD Ryzen 7 7800X3D (CPU)', 'price' => '$359', 'availability' => 'In stock'],
                    ['name' => 'Intel Core i5-14600K (CPU)', 'price' => '$299', 'availability' => 'In stock'],
                    ['name' => 'NVIDIA GeForce RTX 4070 (GPU)', 'price' => '$549', 'availability' => 'In stock'],
                    ['name' => 'NVIDIA GeForce RTX 4060 (GPU)', 'price' => '$299', 'availability' => 'In stock'],
                    ['name' => 'Samsung 990 Pro 2TB NVMe SSD', 'price' => '$149', 'availability' => 'In stock'],
                    ['name' => 'Corsair Vengeance 32GB DDR5 RAM (kit)', 'price' => '$99', 'availability' => 'In stock'],
                    ['name' => 'Custom-built PC - Budget tier', 'price' => 'Starting at $899', 'availability' => 'Built to order, ~3-5 business days'],
                    ['name' => 'Custom-built PC - Mid tier (gaming/creator)', 'price' => 'Starting at $1,499', 'availability' => 'Built to order, ~3-5 business days'],
                    ['name' => 'Custom-built PC - High-end tier', 'price' => 'Starting at $2,499', 'availability' => 'Built to order, ~5-7 business days'],
                ],
                'faq' => [
                    ['question' => 'Do you offer pickup?', 'answer' => 'Not currently - customers bring devices in or we visit for network setups.'],
                    ['question' => 'Do you fix Mac computers?', 'answer' => 'Yes, we service both Windows and Mac hardware.'],
                    ['question' => 'Do you sell hardware, not just repair it?', 'answer' => 'Yes - individual components (CPUs, GPUs, memory, storage) and full custom-built PCs.'],
                    ['question' => 'How much does a custom PC cost?', 'answer' => 'Starting around $899 for a budget build, $1,499 for a mid-tier gaming/creator build, and $2,499 for a high-end build - the exact price depends on the components chosen, so we confirm a final quote once we know what you want.'],
                ],
            ],
        );

        // --- Demo businesses added for customer walkthrough videos, themed
        // directly on the real anonymized sample calls the client sent
        // (see ai-runtime/call-samples/*.txt) - same trades-callback style
        // as 'abc-contractors' above: take name + postcode/address +
        // callback number, promise a call back, never quote a price on the
        // call itself. New slugs only - 'abc-contractors' and 'xyz' above
        // are left untouched since they've since been edited live via the
        // dashboard.
        Business::updateOrCreate(
            ['slug' => 'oakley-driveways'],
            [
                'name' => 'Oakley Driveways',
                'voice_id' => self::GEMMA_VOICE_ID,
                'services' => 'Driveway installation, resurfacing and repair, block paving, and garden landscaping and patio work. Every enquiry starts with a free, no-obligation site visit.',
                'hours' => 'Monday to Saturday, 8 AM to 5 PM. Closed Sundays and public holidays.',
                'pricing' => 'We don\'t quote driveway or garden work over the phone - every job depends on the size and condition of the site, so we arrange a free site visit first and quote from there.',
                'policies' => 'We cover the local area and nearby villages. We take your details and a callback number, and the owner calls back to arrange a site visit as soon as they\'re free.',
                'products' => null,
                'faq' => [
                    ['question' => 'Do you do gardens as well as driveways?', 'answer' => 'Yes - garden landscaping and patio work alongside driveways and block paving.'],
                    ['question' => 'Can I get a price over the phone?', 'answer' => 'No, every quote starts with a free site visit so we can see the job properly first.'],
                    ['question' => 'How soon will someone call me back?', 'answer' => 'The owner calls back to arrange a site visit as soon as they\'re free.'],
                ],
            ],
        );
        PhoneNumber::updateOrCreate(
            ['number' => '101'],
            ['business_id' => Business::where('slug', 'oakley-driveways')->value('id'), 'label' => 'Oakley Driveways demo line', 'is_active' => true],
        );

        Business::updateOrCreate(
            ['slug' => 'mnc-paving'],
            [
                'name' => 'MNC Paving',
                'voice_id' => self::GEMMA_VOICE_ID,
                'services' => 'Block paving, resurfacing, and driveway and patio installation for domestic and light commercial jobs.',
                'hours' => 'Monday to Friday, 8 AM to 5 PM. Saturday mornings by appointment.',
                'pricing' => 'Paving work is quoted per job after a free site visit - we don\'t give estimates over the phone.',
                'policies' => 'We take a name, postcode or address, and a callback number for every enquiry, including if you just need to change or cancel a booked visit. Someone calls back to arrange or confirm.',
                'products' => null,
                'faq' => [
                    ['question' => 'Can I cancel or change a booked visit by phone?', 'answer' => 'Yes - leave your name, postcode and callback number and we\'ll confirm the change.'],
                    ['question' => 'Do you do commercial jobs?', 'answer' => 'Yes, light commercial paving alongside domestic driveways and patios.'],
                    ['question' => 'How much does block paving cost?', 'answer' => 'It depends on the size and condition of the area, so every job is quoted after a free site visit.'],
                ],
            ],
        );
        PhoneNumber::updateOrCreate(
            ['number' => '102'],
            ['business_id' => Business::where('slug', 'mnc-paving')->value('id'), 'label' => 'MNC Paving demo line', 'is_active' => true],
        );

        Business::updateOrCreate(
            ['slug' => 'millers-roofing'],
            [
                'name' => "Miller's Roofing",
                'voice_id' => self::GEMMA_VOICE_ID,
                'services' => 'Flat and pitched roof repairs, re-roofing, and roof leak call-outs.',
                'hours' => 'Monday to Friday, 8 AM to 6 PM. Leak call-outs by arrangement outside these hours.',
                'pricing' => 'We don\'t price roof repairs over the phone - the boss arranges a free estimate once he\'s seen the roof.',
                'policies' => 'We take your name, postcode, and house/door number for the job along with a callback number, and arrange a free estimate as soon as the boss is free - we prioritise urgent leaks where we can.',
                'products' => null,
                'faq' => [
                    ['question' => 'Do you do flat roofs?', 'answer' => 'Yes - flat and pitched roof repairs and re-roofing.'],
                    ['question' => 'Is the estimate free?', 'answer' => 'Yes, every job gets a free estimate before any work is agreed.'],
                    ['question' => 'How quickly can someone come out for a leak?', 'answer' => 'We prioritise leak call-outs where we can, as soon as the boss\'s schedule allows.'],
                ],
            ],
        );
        PhoneNumber::updateOrCreate(
            ['number' => '103'],
            ['business_id' => Business::where('slug', 'millers-roofing')->value('id'), 'label' => "Miller's Roofing demo line", 'is_active' => true],
        );

        Business::updateOrCreate(
            ['slug' => 'trinity-drives'],
            [
                'name' => 'Trinity Drives',
                'voice_id' => self::GEMMA_VOICE_ID,
                'services' => 'Resin-bound and tarmac driveways, plus drainage and soakaway installation.',
                'hours' => 'Monday to Friday, 8 AM to 5 PM. Closed weekends.',
                'pricing' => 'Resin and tarmac driveway costs vary a lot by size and ground condition, so we always quote after a free site visit rather than over the phone.',
                'policies' => 'We cover a wider regional area than most local firms. We take your details and a callback number, and arrange a site visit as soon as we can get someone out to you, given how far our patch stretches.',
                'products' => null,
                'faq' => [
                    ['question' => 'Do you do resin driveways?', 'answer' => 'Yes - resin-bound and tarmac driveways, plus drainage work.'],
                    ['question' => 'How far do you travel for jobs?', 'answer' => 'We cover a wide regional area - let us know your postcode and we can confirm.'],
                    ['question' => 'How long until someone visits for a quote?', 'answer' => 'It varies since we cover a larger area than most local firms, but we\'ll get someone out to you as soon as we can.'],
                ],
            ],
        );
        PhoneNumber::updateOrCreate(
            ['number' => '104'],
            ['business_id' => Business::where('slug', 'trinity-drives')->value('id'), 'label' => 'Trinity Drives demo line', 'is_active' => true],
        );

        Business::updateOrCreate(
            ['slug' => 'county-fascias-guttering'],
            [
                'name' => 'County Fascias & Guttering',
                'voice_id' => self::GEMMA_VOICE_ID,
                'services' => 'Fascia and soffit replacement, guttering repair and replacement, and gutter clearing.',
                'hours' => 'Monday to Friday, 8 AM to 5 PM. Closed weekends and public holidays.',
                'pricing' => 'Fascia and guttering replacement is quoted after a free site visit. Gutter clearing has a flat call-out rate, confirmed when we book you in.',
                'policies' => 'We cover a wide rural catchment, including outlying villages, so response times for a site visit vary. Mobile numbers are fine even if you can\'t always answer - leave a message and we\'ll get back to you.',
                'products' => null,
                'faq' => [
                    ['question' => 'Do you just do guttering, or fascias too?', 'answer' => 'Both - fascia and soffit replacement as well as guttering repair, replacement, and clearing.'],
                    ['question' => 'How much does gutter clearing cost?', 'answer' => 'There\'s a flat call-out rate for clearing, confirmed when we book the visit in.'],
                    ['question' => 'Do you cover villages outside town?', 'answer' => 'Yes, we cover a wide rural catchment - tell us your postcode and we\'ll confirm.'],
                ],
            ],
        );
        PhoneNumber::updateOrCreate(
            ['number' => '105'],
            ['business_id' => Business::where('slug', 'county-fascias-guttering')->value('id'), 'label' => 'County Fascias & Guttering demo line', 'is_active' => true],
        );

        // Client feedback (Sep 2026): wanted a general construction demo
        // instead of driveways/paving or computer sales, with a British
        // voice - same take-details-and-call-back style as the trades
        // businesses above (quotes are always given on-site, never over
        // the phone), just for general building work rather than one
        // narrow trade.
        Business::updateOrCreate(
            ['slug' => 'sterling-construction'],
            [
                'name' => 'Sterling Construction',
                'voice_id' => self::GEMMA_VOICE_ID,
                'services' => 'General building and construction work - house extensions, loft conversions, renovations, groundworks, and new-build projects. Every enquiry starts with a free, no-obligation site visit and quote.',
                'hours' => 'Monday to Friday, 8 AM to 5 PM. Closed weekends and public holidays.',
                'pricing' => 'We don\'t give prices over the phone - every job depends on its scope and the site itself, so we always start with a free site visit before quoting.',
                'policies' => 'We cover the local area and surrounding towns. We take your details and a callback number, and an estimator calls back to arrange a site visit as soon as they\'re free.',
                'products' => null,
                'faq' => [
                    ['question' => 'Do you do extensions and loft conversions?', 'answer' => 'Yes - alongside renovations, groundworks, and new-build projects.'],
                    ['question' => 'Can I get a rough price over the phone?', 'answer' => 'No, every job starts with a free site visit so we can quote accurately.'],
                    ['question' => 'How soon can someone come out to quote?', 'answer' => 'It depends on our estimator\'s schedule - we\'ll call back to arrange a time as soon as one is free.'],
                    ['question' => 'What areas do you cover?', 'answer' => 'The local area and surrounding towns - let us know your postcode and we can confirm.'],
                ],
            ],
        );
        PhoneNumber::updateOrCreate(
            ['number' => '106'],
            ['business_id' => Business::where('slug', 'sterling-construction')->value('id'), 'label' => 'Sterling Construction demo line', 'is_active' => true],
        );
    }
}
