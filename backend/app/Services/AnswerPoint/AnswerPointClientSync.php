<?php

namespace App\Services\AnswerPoint;

use App\Models\Business;
use App\Models\PhoneNumber;
use App\Support\PhoneNumbers;
use Illuminate\Support\Str;

// Pulls AnswerPoint's own client list (their existing manual call-center
// setup) and reconciles it into our businesses/phone_numbers tables, so
// the dashboard shows the client's REAL businesses instead of the demo
// seed data (see BusinessSeeder) - this is what lets the client see our
// AI platform is actually integrated with their existing setup, rather
// than looking at placeholder rows.
//
// Deliberately manual-trigger only for now (the "Sync now" button on
// businesses/index.vue, via AnswerPointSyncController) - not a scheduled
// job. Revisit once the real client-list endpoint is confirmed and this
// has been run successfully at least once against real data.
class AnswerPointClientSync
{
    public function __construct(private AnswerPointClient $client)
    {
    }

    /**
     * @return array{created:int,updated:int,phones_added:int,phones_removed:int}
     */
    public function sync(): array
    {
        $clients = $this->client->fetchClients();

        $stats = ['created' => 0, 'updated' => 0, 'phones_added' => 0, 'phones_removed' => 0];

        foreach ($clients as $raw) {
            $normalized = $this->normalizeClient($raw);

            $business = Business::where('answerpoint_client_id', $normalized['id'])->first();

            if ($business) {
                $business->update([
                    'name' => $normalized['name'],
                    'status' => $normalized['status'],
                ]);
                $stats['updated']++;
            } else {
                $business = Business::create([
                    'name' => $normalized['name'],
                    'slug' => $this->uniqueSlug($normalized['name']),
                    'answerpoint_client_id' => $normalized['id'],
                    'status' => $normalized['status'],
                ]);
                $stats['created']++;
            }

            $phoneStats = $this->reconcilePhoneNumbers($business, $normalized['phone_numbers']);
            $stats['phones_added'] += $phoneStats['added'];
            $stats['phones_removed'] += $phoneStats['removed'];
        }

        return $stats;
    }

    // TODO: field names guessed (id/name/phone_numbers/status) - the exact
    // response shape from AnswerPoint's client-list endpoint was still
    // pending as of 2026-09-17 (requested, not yet received). This is the
    // one place to update once it's confirmed; everything else in this
    // class works off the normalized shape returned here.
    private function normalizeClient(array $raw): array
    {
        return [
            'id' => (int) ($raw['id'] ?? $raw['clientId'] ?? $raw['client_id'] ?? 0),
            'name' => (string) ($raw['name'] ?? $raw['company'] ?? ''),
            'status' => (($raw['status'] ?? $raw['active'] ?? true) ? 'active' : 'inactive'),
            // Accepts a single string or an array under a few likely key
            // names - narrow this once the real shape is known.
            'phone_numbers' => array_values(array_filter(array_map(
                'strval',
                (array) ($raw['phone_numbers'] ?? $raw['phoneNumbers'] ?? $raw['numbers'] ?? [])
            ))),
        ];
    }

    // AnswerPoint is authoritative for phone numbers on sync (per the
    // user's call) - anything they list gets added/reactivated on this
    // business; anything currently on this business that they no longer
    // list gets DEACTIVATED, not deleted (phone_numbers rows aren't
    // referenced by call_logs directly, so there's no cascade-delete risk
    // either way, but deactivating preserves the row/label/history and
    // matches how PhoneNumberController already treats is_active - see
    // BusinessController::showByPhone, which only routes to active
    // numbers).
    private function reconcilePhoneNumbers(Business $business, array $answerPointNumbers): array
    {
        $added = 0;
        $removed = 0;

        $normalizedIncoming = collect($answerPointNumbers)
            ->mapWithKeys(fn ($n) => [PhoneNumbers::normalize($n) => $n]);

        $existing = PhoneNumber::where('business_id', $business->id)->get()
            ->keyBy(fn (PhoneNumber $p) => PhoneNumbers::normalize($p->number));

        foreach ($normalizedIncoming as $normalized => $raw) {
            $row = $existing->get($normalized);

            if ($row) {
                if (! $row->is_active) {
                    $row->update(['is_active' => true]);
                }

                continue;
            }

            // The same number might already exist under a DIFFERENT
            // business (reassigned on AnswerPoint's side since our last
            // sync, or collides with demo-seed data) - phone_numbers.number
            // is unique account-wide (see its migration), so reassign the
            // existing row rather than inserting a duplicate and hitting
            // that constraint.
            $elsewhere = PhoneNumber::where('number', $raw)->first();

            if ($elsewhere) {
                $elsewhere->update(['business_id' => $business->id, 'is_active' => true]);
            } else {
                PhoneNumber::create([
                    'business_id' => $business->id,
                    'number' => $raw,
                    'label' => 'Synced from AnswerPoint',
                    'is_active' => true,
                ]);
            }

            $added++;
        }

        foreach ($existing as $normalized => $row) {
            if (! $normalizedIncoming->has($normalized) && $row->is_active) {
                $row->update(['is_active' => false]);
                $removed++;
            }
        }

        return ['added' => $added, 'removed' => $removed];
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name) ?: 'client';
        $slug = $base;
        $suffix = 2;

        while (Business::where('slug', $slug)->exists()) {
            $slug = "{$base}-{$suffix}";
            $suffix++;
        }

        return $slug;
    }
}
