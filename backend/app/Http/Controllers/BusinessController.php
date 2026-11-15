<?php

namespace App\Http\Controllers;

use App\Models\Business;
use App\Models\PhoneNumber;
use App\Support\PhoneNumbers;
use Illuminate\Http\Request;

class BusinessController extends Controller
{
    // Admin-only list, used by the dashboard's Businesses page. Includes
    // phone_numbers so the list can show assigned numbers at a glance.
    public function index()
    {
        return Business::with('phoneNumbers')->orderBy('name')->get();
    }

    // Shared by show() and showByPhone() below so both public,
    // ai-runtime-facing endpoints return provably identical payloads -
    // ai-runtime's BusinessKnowledgeBase type/parsing doesn't need to
    // know which route it came from.
    private function kbPayload(Business $business): array
    {
        return [
            'name' => $business->name,
            'slug' => $business->slug,
            'voice_id' => $business->voice_id,
            'prompt_style' => $business->prompt_style,
            // 'active'/'inactive' - reflects AnswerPoint's own client
            // status once synced (see AnswerPointClientSync). ai-runtime's
            // beginCall() checks this and drops the call without ever
            // greeting the caller when inactive - see its own comment for
            // why this is the deliberately risk-free version of that
            // behavior (a real SIP-level pre-answer rejection would need
            // a separate, bigger change - not done here, demo is imminent).
            'status' => $business->status,
            'services' => $business->services,
            'hours' => $business->hours,
            'pricing' => $business->pricing,
            'policies' => $business->policies,
            'faq' => $business->faq,
            'products' => $business->products,
        ];
    }

    // Public - returns one business's raw KB fields as-is; ai-runtime
    // formats them into the LLM system prompt itself (see
    // ai-runtime/src/knowledge-base/buildSystemPrompt.ts) so prompt wording
    // can be iterated without a backend deploy. This is ai-runtime's
    // fallback lookup (BUSINESS_SLUG env var) when phone-based routing
    // below doesn't apply or fails - see showByPhone.
    public function show(string $slug)
    {
        $business = Business::where('slug', $slug)->firstOrFail();

        return response()->json($this->kbPayload($business));
    }

    // Public - ai-runtime's per-call routing lookup (see
    // ai-runtime/src/services/LaravelClient.ts:getBusinessByPhone and
    // test-token.ts:beginCall). $number is whatever the SIP participant's
    // sip.trunkPhoneNumber attribute carries - normalized before matching
    // so "+15551234567" / "15551234567" / "5551234567" all hit the same
    // row (see PhoneNumbers::normalize). Only matches active numbers, so
    // deactivating a number in the dashboard makes it fall back to
    // ai-runtime's BUSINESS_SLUG default instead of routing calls to a
    // business that no longer wants them on that line.
    public function showByPhone(string $number)
    {
        $normalized = PhoneNumbers::normalize($number);

        $match = PhoneNumber::query()
            ->where('is_active', true)
            ->with('business')
            ->get()
            ->first(fn(PhoneNumber $candidate) => PhoneNumbers::normalize($candidate->number) === $normalized);

        abort_if(!$match, 404);

        return response()->json($this->kbPayload($match->business));
    }

    // Admin-only, by numeric id (see routes/api.php for why this has to
    // stay registered ahead of the public GET /businesses/{slug} route).
    // Used by the dashboard's edit page, which also needs phoneNumbers
    // for the inline phone-number list on that page - unlike show()
    // above this isn't a public wire-format contract ai-runtime depends
    // on, so returning the model as-is (like store/update do) is simpler
    // and won't quietly drop a field the frontend already reads, the way
    // the previous hand-picked-fields version did.
    public function showById(Business $business)
    {
        return response()->json($business->load('phoneNumbers'));
    }

    // Re-enabled 2026-10-14 (disabled 2026-09-17 in favour of AnswerPoint
    // sync, which is still blocked on AnswerPoint's side): the client needs
    // to set up businesses himself from the dashboard, alongside the sync.
    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'slug' => ['required', 'string', 'max:255', 'unique:businesses,slug'],
            'voice_id' => ['nullable', 'string'],
            'prompt_style' => ['sometimes', 'in:standard,compact'],
            'answerpoint_push_enabled' => ['sometimes', 'boolean'],
            'services' => ['nullable', 'string'],
            'hours' => ['nullable', 'string'],
            'pricing' => ['nullable', 'string'],
            'policies' => ['nullable', 'string'],
            'faq' => ['nullable', 'array'],
            'products' => ['nullable', 'array'],
        ]);

        return response()->json(Business::create($data + ['status' => 'active']), 201);
    }

    public function update(Request $request, Business $business)
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'slug' => ['sometimes', 'string', 'max:255', 'unique:businesses,slug,' . $business->id],
            'voice_id' => ['nullable', 'string'],
            'prompt_style' => ['sometimes', 'in:standard,compact'],
            // Per-business AnswerPoint push opt-in (2026-09-24) - see
            // PushCallLogToAnswerPoint::shouldPush(). Editable regardless
            // of whether answerpoint_client_id is set yet, since there's
            // no harm in pre-flipping it on for a business before
            // AnswerPoint hands over its client id (the client-id check
            // still gates the actual push either way).
            'answerpoint_push_enabled' => ['sometimes', 'boolean'],
            'services' => ['nullable', 'string'],
            'hours' => ['nullable', 'string'],
            'pricing' => ['nullable', 'string'],
            'policies' => ['nullable', 'string'],
            'faq' => ['nullable', 'array'],
            'products' => ['nullable', 'array'],
        ]);

        $business->update($data);

        return response()->json($business->fresh());
    }

    public function destroy(Business $business)
    {
        $business->delete();

        return response()->json(['ok' => true]);
    }
}
