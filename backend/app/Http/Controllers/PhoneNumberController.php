<?php

namespace App\Http\Controllers;

use App\Models\PhoneNumber;
use Illuminate\Http\Request;

// Admin-only CRUD for assigning phone numbers to businesses. Note: this is
// data-model/dashboard plumbing only - actually routing an inbound SIP call
// to the right business by the dialed number is a separate, not-yet-done
// piece of work in ai-runtime/Kamailio (see voiceai_runtime_status.md).
// Today's live demo call still uses the single hardcoded BUSINESS_SLUG.
class PhoneNumberController extends Controller
{
    public function index(Request $request)
    {
        $query = PhoneNumber::with('business')->orderBy('number');

        if ($request->filled('business_id'))
            $query->where('business_id', $request->input('business_id'));

        return $query->get();
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'business_id' => ['required', 'exists:businesses,id'],
            'number' => ['required', 'string', 'max:32', 'unique:phone_numbers,number'],
            'label' => ['nullable', 'string', 'max:255'],
            'is_active' => ['boolean'],
        ]);

        return response()->json(PhoneNumber::create($data)->load('business'), 201);
    }

    public function update(Request $request, PhoneNumber $phoneNumber)
    {
        $data = $request->validate([
            'business_id' => ['sometimes', 'exists:businesses,id'],
            'number' => ['sometimes', 'string', 'max:32', 'unique:phone_numbers,number,' . $phoneNumber->id],
            'label' => ['nullable', 'string', 'max:255'],
            'is_active' => ['boolean'],
        ]);

        $phoneNumber->update($data);

        return response()->json($phoneNumber->fresh('business'));
    }

    public function destroy(PhoneNumber $phoneNumber)
    {
        $phoneNumber->delete();

        return response()->json(['ok' => true]);
    }
}
